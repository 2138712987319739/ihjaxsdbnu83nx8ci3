import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AdminBridgeConfig } from '../config';
import type { Logger } from '../logger';
import type {
  AdminActionResult,
  AdminActionRow,
  AdminActionType,
  AdminEventSink,
  AdminServiceController,
  ServiceEvent,
} from './types';

import { getErrorMessage } from '../logger';
import { RetryQueue } from '../retry-queue';
import { ACTION_RATE_LIMITS, DEFAULT_STALE_ACTION_THRESHOLD_MS, UNSUPPORTED_ACTION_MESSAGE } from '../constants';
import { sendAdminInviteEmail } from './mailer';

type ActionUpdate = {
  status: 'running' | 'completed' | 'failed';
  completed_at?: string;
  result?: AdminActionResult;
};

const supportedActions = new Set<AdminActionType>([
  'acknowledge_error',
  'apply_config',
  'block_xuid',
  'clear_invite_cooldown',
  'clear_stale_actions',
  'disable_lockdown',
  'enable_lockdown',
  'invite_admin_user',
  'reconnect_portal',
  'reload_config',
  'republish_session',
  'retry_failed_invites',
  'run_diagnostics',
  'run_security_diagnostics',
  'unblock_xuid',
]);

export class AdminBridge implements AdminEventSink {
  private readonly client: SupabaseClient;
  private readonly recentActionRuns = new Map<AdminActionType, number>();
  private readonly eventRetryQueue: RetryQueue<ServiceEvent>;
  private pollTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: AdminBridgeConfig,
    private readonly controller: AdminServiceController,
    private readonly logger: Logger,
  ) {
    if (!config.supabaseUrl || !config.serviceRoleKey) {
      throw new Error('Admin bridge is missing Supabase credentials');
    }

    this.client = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    this.eventRetryQueue = new RetryQueue<ServiceEvent>(
      {
        maxRetries: 3,
        initialDelayMs: 5000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
      },
      (event) => this.persistEvent(event),
      logger,
    );
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.eventRetryQueue.start();
    this.logger.info('Admin bridge enabled', { botId: this.config.botId });
    this.pollTimer = setInterval(() => void this.pollActions(), this.config.pollIntervalMs);
    this.statusTimer = setInterval(() => void this.publishStatus(), this.config.statusIntervalMs);
    void this.publishStatus();
    void this.pollActions();
  }

  stop(): void {
    this.running = false;
    this.eventRetryQueue.stop();

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  recordEvent(event: ServiceEvent): void {
    if (!this.running) {
      return;
    }

    void this.persistEvent(event).catch((error: unknown) => {
      this.logger.warn('Admin event persist failed, queuing for retry', {
        error: getErrorMessage(error),
        eventType: event.type,
      });
      this.eventRetryQueue.enqueue(`${event.type}-${Date.now()}`, event);
    });
  }

  private async persistEvent(event: ServiceEvent): Promise<void> {
    await this.client.from('bot_events').insert({
      bot_id: this.config.botId,
      event_type: event.type,
      message: event.message,
      xuid: event.xuid ?? null,
      gamertag: event.gamertag ?? null,
      payload: event.payload ?? {},
    });

    if (event.type === 'player_join' && event.xuid) {
      await this.client.from('player_sessions').insert({
        bot_id: this.config.botId,
        xuid: event.xuid,
        gamertag: event.gamertag ?? 'unknown',
      });
    }

    if (event.type === 'player_leave' && event.xuid) {
      const { data } = await this.client
        .from('player_sessions')
        .select('id')
        .eq('bot_id', this.config.botId)
        .eq('xuid', event.xuid)
        .is('left_at', null)
        .order('joined_at', { ascending: false })
        .limit(1);

      const latest = (data as Array<{ id: string }> | null)?.[0];
      if (latest) {
        await this.client
          .from('player_sessions')
          .update({ left_at: new Date().toISOString() })
          .eq('id', latest.id);
      }
    }

    if (event.type === 'invite_failed') {
      await this.client.from('bot_errors').insert({
        bot_id: this.config.botId,
        code: 'invite_failed',
        message: event.message,
        severity: 'warning',
        fix_action: 'retry_failed_invites',
        payload: event.payload ?? {},
      });
    }

    if (event.type === 'friend_rejected') {
      await this.persistSecurityEvent('warning', 'friend_policy', event.message, {
        xuid: event.xuid ?? null,
        gamertag: event.gamertag ?? null,
        ...event.payload,
      });
    }
  }

  private async publishStatus(): Promise<void> {
    const snapshot = this.controller.getStatusSnapshot(this.config.botId);
    const { error } = await this.client.from('bot_status').upsert({
      bot_id: this.config.botId,
      online: snapshot.online,
      current_players: snapshot.currentPlayers,
      total_joins: snapshot.totalJoins,
      target_host: snapshot.targetHost,
      target_port: snapshot.targetPort,
      session_display: snapshot.sessionDisplay,
      joinability: snapshot.joinability,
      friend_policy: snapshot.friendPolicy,
      lockdown_mode: snapshot.lockdownMode,
      started_at: snapshot.startedAt,
      last_heartbeat: snapshot.updatedAt,
      updated_at: snapshot.updatedAt,
    }, { onConflict: 'bot_id' });

    if (error) {
      this.logger.warn('Admin status publish failed', { error: error.message });
    }
  }

  private async pollActions(): Promise<void> {
    if (!this.running) {
      return;
    }

    const { data, error } = await this.client
      .from('bot_actions')
      .select('id, bot_id, action_type, payload, status, created_by, created_at')
      .eq('bot_id', this.config.botId)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(5);

    if (error) {
      this.logger.warn('Admin action poll failed', { error: error.message });
      return;
    }

    for (const action of (data ?? []) as AdminActionRow[]) {
      await this.processAction(action);
    }
  }

  private async processAction(action: AdminActionRow): Promise<void> {
    await this.updateAction(action.id, { status: 'running' });

    const result = await this.executeAction(action)
      .catch((error: unknown): AdminActionResult => ({
        ok: false,
        message: getErrorMessage(error),
      }));

    await this.updateAction(action.id, {
      status: result.ok ? 'completed' : 'failed',
      completed_at: new Date().toISOString(),
      result,
    });

    await this.logFixAttempt(action, result);
  }

  private async executeAction(action: AdminActionRow): Promise<AdminActionResult> {
    if (!isSupportedAction(action.action_type)) {
      return {
        ok: false,
        message: UNSUPPORTED_ACTION_MESSAGE,
      };
    }

    if (!this.canRunAction(action.action_type)) {
      await this.persistSecurityEvent('warning', 'action_rate_limit', 'Admin action rate limit reached.', {
        actionType: action.action_type,
        createdBy: action.created_by,
      });
      return {
        ok: false,
        message: 'Action rate limit reached. Wait before retrying.',
      };
    }

    if (action.action_type === 'clear_stale_actions') {
      return this.clearStaleActions();
    }

    if (action.action_type === 'acknowledge_error') {
      return this.acknowledgeError(action.payload);
    }

    if (action.action_type === 'invite_admin_user') {
      return this.inviteAdminUser(action);
    }

    return this.controller.performAdminAction(action.action_type, action.payload);
  }
  private canRunAction(actionType: AdminActionType): boolean {
    const limit = ACTION_RATE_LIMITS[actionType];
    if (!limit) {
      return true;
    }

    const now = Date.now();
    const lastRun = this.recentActionRuns.get(actionType) ?? 0;
    if (now - lastRun < limit.windowMs / limit.max) {
      return false;
    }

    this.recentActionRuns.set(actionType, now);
    return true;
  }

  private async clearStaleActions(): Promise<AdminActionResult> {
    const staleBefore = new Date(Date.now() - DEFAULT_STALE_ACTION_THRESHOLD_MS).toISOString();
    const { data, error } = await this.client
      .from('bot_actions')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        result: { ok: false, message: 'Cleared after becoming stale.' },
      })
      .eq('bot_id', this.config.botId)
      .in('status', ['queued', 'running'])
      .lt('created_at', staleBefore)
      .select('id');

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: `Cleared ${data?.length ?? 0} stale action(s).` };
  }

  private async acknowledgeError(payload: unknown): Promise<AdminActionResult> {
    const errorId = readPayloadString(payload, 'errorId');
    if (!errorId) {
      return { ok: false, message: 'Missing error id.' };
    }

    const { error } = await this.client
      .from('bot_errors')
      .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
      .eq('id', errorId)
      .eq('bot_id', this.config.botId);

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: 'Error acknowledged.' };
  }

  private async inviteAdminUser(action: AdminActionRow): Promise<AdminActionResult> {
    if (!action.created_by) {
      return { ok: false, message: 'Missing operator identity.' };
    }

    const permitted = await this.operatorCanManageUsers(action.created_by);
    if (!permitted) {
      await this.persistSecurityEvent('warning', 'admin_invite_denied', 'Admin invite denied by permission check.', {
        createdBy: action.created_by,
      });
      return { ok: false, message: 'Admin users permission is required.' };
    }

    const email = readPayloadString(action.payload, 'email')?.toLowerCase();
    const role = readAdminRole(action.payload);
    const permissions = readPermissionList(action.payload, role);
    const redirectTo = readPayloadString(action.payload, 'redirectTo');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, message: 'Invalid admin email.' };
    }

    if (!redirectTo || !/^https?:\/\/[^\s"')]+$/i.test(redirectTo)) {
      return { ok: false, message: 'Invalid invite redirect URL.' };
    }

    const { data, error } = await this.client.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        panel: 'friendconnect',
        botId: this.config.botId,
        role,
      },
    });

    if (error || !data.user?.id) {
      const failureMessage = formatInviteFailureMessage(error?.message ?? 'Invite did not return a user id.');
      if (shouldGenerateManualInviteLink(failureMessage)) {
        return this.generateManualAdminInviteLink(action, email, role, permissions, redirectTo, failureMessage);
      }

      await this.persistSecurityEvent('warning', 'admin_invite_failed', 'Admin invite failed.', {
        email,
        reason: failureMessage,
      });
      return { ok: false, message: failureMessage };
    }

    const { error: profileError } = await this.client.from('admin_users').upsert({
      user_id: data.user.id,
      email,
      role,
      permissions,
      invited_by: action.created_by,
      invited_at: new Date().toISOString(),
      accepted_at: null,
      password_set_at: null,
      disabled_at: null,
    }, { onConflict: 'user_id' });

    if (profileError) {
      return { ok: false, message: profileError.message };
    }

    await this.persistSecurityEvent('info', 'admin_invite_sent', 'Admin invite sent.', {
      email,
      role,
      createdBy: action.created_by,
    });

    return { ok: true, message: `Invite sent to ${email}.`, data: { role, permissions } };
  }

  private async generateManualAdminInviteLink(
    action: AdminActionRow,
    email: string,
    role: 'admin' | 'operator' | 'viewer',
    permissions: string[],
    redirectTo: string,
    reason: string,
  ): Promise<AdminActionResult> {
    const { data, error } = await this.client.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo,
        data: {
          panel: 'friendconnect',
          botId: this.config.botId,
          role,
        },
      },
    });

    const manualInviteLink = data?.properties?.action_link;
    if (error || !data.user?.id || !manualInviteLink) {
      const message = error?.message ?? 'Manual invite link generation failed.';
      await this.persistSecurityEvent('warning', 'admin_invite_failed', 'Admin invite failed.', {
        email,
        reason: message,
      });
      return { ok: false, message };
    }

    const { error: profileError } = await this.client.from('admin_users').upsert({
      user_id: data.user.id,
      email,
      role,
      permissions,
      invited_by: action.created_by,
      invited_at: new Date().toISOString(),
      accepted_at: null,
      password_set_at: null,
      disabled_at: null,
    }, { onConflict: 'user_id' });

    if (profileError) {
      return { ok: false, message: profileError.message };
    }

    if (this.config.inviteMailer.enabled) {
      try {
        await sendAdminInviteEmail(this.config.inviteMailer, email, manualInviteLink);
        await this.persistSecurityEvent('info', 'admin_invite_sent', 'Admin invite sent through configured SMTP provider.', {
          email,
          role,
          createdBy: action.created_by,
        });

        return {
          ok: true,
          message: `Invite email sent to ${email} through the configured mail provider.`,
          data: { role, permissions },
        };
      } catch (error: unknown) {
        this.logger.warn('Admin invite SMTP delivery failed', {
          email,
          error: getErrorMessage(error),
        });
        await this.persistSecurityEvent('warning', 'admin_invite_mailer_failed', 'Admin invite SMTP delivery failed.', {
          email,
          role,
          reason: 'SMTP delivery failed.',
          createdBy: action.created_by,
        });

        return {
          ok: true,
          message: 'SMTP invite delivery failed. Copy and send the generated link manually.',
          data: { role, permissions, manualInviteLink },
        };
      }
    }

    await this.persistSecurityEvent('warning', 'admin_invite_manual_link', 'Admin invite email unavailable; manual link generated.', {
      email,
      role,
      reason,
      createdBy: action.created_by,
    });

    return {
      ok: true,
      message: 'Invite link generated. Supabase email quota is currently blocked, so send the generated link manually.',
      data: { role, permissions, manualInviteLink },
    };
  }

  private async operatorCanManageUsers(userId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('admin_users')
      .select('role, permissions, disabled_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data || data.disabled_at) {
      return false;
    }

    const row = data as { role?: unknown; permissions?: unknown };
    if (row.role === 'owner') {
      return true;
    }

    return Array.isArray(row.permissions) && row.permissions.includes('users:write');
  }

  private async updateAction(id: string, update: ActionUpdate): Promise<void> {
    const { error } = await this.client.from('bot_actions').update(update).eq('id', id);

    if (error) {
      this.logger.warn('Admin action update failed', { actionId: id, error: error.message });
    }
  }

  private async logFixAttempt(action: AdminActionRow, result: AdminActionResult): Promise<void> {
    const { error } = await this.client.from('fix_logs').insert({
      bot_id: this.config.botId,
      action_id: action.id,
      action_type: action.action_type,
      status: result.ok ? 'completed' : 'failed',
      message: result.message,
      created_by: action.created_by,
      result,
    });

    if (error) {
      this.logger.warn('Fix log insert failed', { error: error.message });
    }
  }

  private async persistSecurityEvent(
    severity: 'info' | 'warning' | 'critical',
    category: string,
    message: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client.from('security_events').insert({
      bot_id: this.config.botId,
      severity,
      category,
      message,
      source: 'bot_bridge',
      payload,
    });

    if (error) {
      this.logger.warn('Security event insert failed', { error: error.message });
    }
  }
}

function isSupportedAction(value: string): value is AdminActionType {
  return supportedActions.has(value as AdminActionType);
}

function formatInviteFailureMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('email rate')) {
    return 'Supabase email rate limit reached. Wait for the quota window to reset or configure custom SMTP in Supabase Auth.';
  }

  if (lower.includes('smtp') || lower.includes('mail') || lower.includes('email')) {
    return `Supabase could not send the invite email: ${message}`;
  }

  return message;
}

function shouldGenerateManualInviteLink(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('rate limit') || lower.includes('email quota') || lower.includes('email rate');
}

function readPayloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readAdminRole(payload: unknown): 'admin' | 'operator' | 'viewer' {
  const role = readPayloadString(payload, 'role');
  if (role === 'admin' || role === 'operator' || role === 'viewer') {
    return role;
  }

  return 'operator';
}

function readPermissionList(payload: unknown, role: 'admin' | 'operator' | 'viewer'): string[] {
  if (role === 'viewer') {
    return [];
  }

  const defaultPermissions = role === 'admin'
    ? ['config:write', 'actions:write', 'users:write', 'security:write']
    : ['actions:write'];

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return defaultPermissions;
  }

  const value = (payload as Record<string, unknown>).permissions;
  if (!Array.isArray(value)) {
    return defaultPermissions;
  }

  const allowed = new Set(['config:write', 'actions:write', 'users:write', 'security:write']);
  const sanitized = value.filter((entry): entry is string => typeof entry === 'string' && allowed.has(entry));
  return [...new Set(sanitized)];
}
