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
  'keepalive_ping',
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
      'Admin event retry queue',
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
    const displayResult = describeActionResult(action.action_type, result);

    await this.updateAction(action.id, {
      status: displayResult.ok ? 'completed' : 'failed',
      completed_at: new Date().toISOString(),
      result: displayResult,
    });

    await this.logFixAttempt(action, displayResult);
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

function describeActionResult(actionType: string, result: AdminActionResult): AdminActionResult {
  const label = actionLabel(actionType);
  const botMessage = (result.message || '').trim() || 'The bot successfully processed the command.';
  const steps = actionSteps(actionType, result.ok);
  
  // Create a more descriptive summary for the fix logs
  const summary = result.ok
    ? `${label} was successful. ${actionOutcome(actionType)}`
    : `${label} failed. ${botMessage}`;

  return {
    ...result,
    message: summary,
    data: {
      ...(result.data ?? {}),
      botMessage,
      steps,
      // Include a 'consoleText' field that combines everything for a log-like feel
      consoleText: result.ok 
        ? [`[SUCCESS] ${label}`, ...steps.map(s => ` > ${s}`), `[RESULT] ${botMessage}`].join('\n')
        : [`[FAILED] ${label}`, `[ERROR] ${botMessage}`, 'Review the fix steps and try again.'].join('\n')
    },
  };
}

function actionLabel(actionType: string): string {
  const labels: Record<string, string> = {
    acknowledge_error: 'Acknowledge error',
    apply_config: 'Apply saved settings',
    block_xuid: 'Block player XUID',
    clear_invite_cooldown: 'Clear invite cooldown',
    clear_stale_actions: 'Clear stuck commands',
    disable_lockdown: 'Disable lockdown',
    enable_lockdown: 'Enable lockdown',
    keepalive: 'Ping bot session',
    reconnect_portal: 'Reconnect portal',
    reload_config: 'Reload runtime settings',
    republish_session: 'Republish session',
    retry_failed_invites: 'Retry failed invites',
    run_diagnostics: 'Run diagnostics',
    run_security_diagnostics: 'Run security diagnostics',
    unblock_xuid: 'Unblock player XUID',
  };

  return labels[actionType] ?? actionType.replaceAll('_', ' ');
}

function actionOutcome(actionType: string): string {
  const outcomes: Record<string, string> = {
    acknowledge_error: 'The selected error was marked as acknowledged.',
    apply_config: 'The bot validated the saved settings and applied any real changes.',
    block_xuid: 'The player XUID was added to the blocklist and the policy was reloaded.',
    clear_invite_cooldown: 'Saved invite cooldown entries were cleared so invites can be sent again.',
    clear_stale_actions: 'Old queued or running commands were closed so new commands can move forward.',
    disable_lockdown: 'Lockdown mode was turned off and normal friend policy is active again.',
    enable_lockdown: 'Lockdown mode was turned on so only allowlisted players can pass policy checks.',
    keepalive: 'The bot refreshed the Xbox session heartbeat and visible player count.',
    reconnect_portal: 'The bot closed the old portal session and opened a fresh Xbox session.',
    reload_config: 'The bridge refreshed the current runtime config snapshot.',
    republish_session: 'The Minecraft session card and visible player count were refreshed.',
    retry_failed_invites: 'The bot checked the failed-invite retry queue.',
    run_diagnostics: 'The bot checked status, target server, friend policy, and session timer.',
    run_security_diagnostics: 'The bot checked lockdown, friend policy, lists, and admin safety controls.',
    unblock_xuid: 'The player XUID was removed from the blocklist and the policy was reloaded.',
  };

  return outcomes[actionType] ?? 'The command was processed by the bot bridge.';
}

function actionSteps(actionType: string, ok: boolean): string[] {
  if (!ok) {
    return [
      'The bridge accepted the command and handed it to the bot.',
      'The bot reported a problem before the command completed.',
      'Review the message shown with this log entry before running another fix.',
    ];
  }

  const steps: Record<string, string[]> = {
    keepalive: [
      'The bridge sent a lightweight ping command to the bot.',
      'The bot refreshed the Xbox session member count.',
      'The bot refreshed the public session activity handle.',
    ],
    reconnect_portal: [
      'The bot stopped the current portal cleanly.',
      'The bot opened a new Xbox session reservation.',
      'The bot resumed friend and invite automation.',
    ],
    republish_session: [
      'The bot checked the current portal player count.',
      'The bot kept the visible count at one or higher so Xbox accepts the session.',
      'The bot refreshed the session card shown in Minecraft.',
    ],
    clear_invite_cooldown: [
      'The bot cleared saved invite cooldown entries.',
      'The next valid friend event can send a fresh invite.',
    ],
    retry_failed_invites: [
      'The bot checked how many failed invites are waiting.',
      'Queued invite retries will continue on their normal retry schedule.',
    ],
    clear_stale_actions: [
      'The bridge found old queued or running commands.',
      'The bridge marked stale commands as failed so the queue is readable.',
    ],
    run_diagnostics: [
      'The bot checked whether the portal is online.',
      'The bot reported player counts, target server, policy, and keepalive timing.',
    ],
    run_security_diagnostics: [
      'The bot checked lockdown mode, friend policy, and access-list counts.',
      'The bot confirmed admin actions are allowlisted and no shell access is exposed.',
    ],
  };

  return steps[actionType] ?? [
    'The bridge accepted the command and handed it to the bot.',
    'The bot completed the requested fix.',
  ];
}
