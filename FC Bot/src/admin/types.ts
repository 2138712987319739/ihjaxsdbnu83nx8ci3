import type { RuntimeConfig } from '../config';

export type AdminActionType =
  | 'acknowledge_error'
  | 'apply_config'
  | 'block_xuid'
  | 'clear_invite_cooldown'
  | 'clear_stale_actions'
  | 'disable_lockdown'
  | 'enable_lockdown'
  | 'reconnect_portal'
  | 'reload_config'
  | 'republish_session'
  | 'retry_failed_invites'
  | 'run_diagnostics'
  | 'run_security_diagnostics'
  | 'unblock_xuid';

export type AdminActionStatus = 'queued' | 'running' | 'completed' | 'failed';

export type AdminActionRow = {
  id: string;
  bot_id: string;
  action_type: string;
  payload: unknown;
  status: AdminActionStatus;
  created_by: string | null;
  created_at: string;
};

export type AdminActionResult = {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
};

export type ServiceEventType =
  | 'friend_added'
  | 'friend_removed'
  | 'friend_rejected'
  | 'invite_failed'
  | 'invite_sent'
  | 'player_join'
  | 'player_leave'
  | 'session_created'
  | 'session_updated'
  | 'startup'
  | 'shutdown';

export type ServiceEvent = {
  type: ServiceEventType;
  message: string;
  gamertag?: string;
  xuid?: string;
  payload?: Record<string, unknown>;
};

export type ServiceStatusSnapshot = {
  botId: string;
  online: boolean;
  currentPlayers: number;
  totalJoins: number;
  targetHost: string;
  targetPort: number;
  sessionDisplay: string;
  joinability: RuntimeConfig['joinability'];
  friendPolicy: RuntimeConfig['friendPolicy'];
  lockdownMode: boolean;
  startedAt: string | null;
  updatedAt: string;
};

export type AdminServiceController = {
  getStatusSnapshot(botId: string): ServiceStatusSnapshot;
  performAdminAction(action: AdminActionType, payload: unknown): Promise<AdminActionResult>;
};

export type AdminEventSink = {
  recordEvent(event: ServiceEvent): void;
};
