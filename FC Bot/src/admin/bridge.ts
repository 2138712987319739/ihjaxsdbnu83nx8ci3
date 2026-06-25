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
      // Add to retry queue
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

    return this.controller.performAdminAction(action.action_type, action.payload);
  }

  /**
   * Check if an action can run based on rate limits
   * Uses a sliding window counter for efficient rate limiting
   */
  private canRunAction(actionType: AdminActionType): boolean {
    const limit = ACTION_RATE_LIMITS[actionType];
    if (!limit) {
      return true;
    }

    const now = Date.now();
    const lastRun = this.recentActionRuns.get(actionType) ?? 0;

    // Simple sliding window: check if enough time has passed since last run
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

function readPayloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
