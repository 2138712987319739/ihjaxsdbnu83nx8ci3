export const UNSUPPORTED_ACTION_MESSAGE = 'Please contact Clovic for further support.';

export const MAX_LIST_ENTRIES = 500;

export const SHUTDOWN_TIMEOUT_MS = 30000;

export const DEFAULT_STALE_ACTION_THRESHOLD_MS = 10 * 60 * 1000;

export const ACTION_RATE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  apply_config: { windowMs: 60000, max: 6 },
  block_xuid: { windowMs: 60000, max: 12 },
  clear_invite_cooldown: { windowMs: 60000, max: 10 },
  clear_stale_actions: { windowMs: 60000, max: 8 },
  disable_lockdown: { windowMs: 60000, max: 4 },
  enable_lockdown: { windowMs: 60000, max: 4 },
  invite_admin_user: { windowMs: 60000, max: 4 },
  reconnect_portal: { windowMs: 60000, max: 3 },
  republish_session: { windowMs: 60000, max: 8 },
  run_diagnostics: { windowMs: 60000, max: 12 },
  run_security_diagnostics: { windowMs: 60000, max: 12 },
  unblock_xuid: { windowMs: 60000, max: 12 },
};
