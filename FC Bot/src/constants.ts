/**
 * Application-wide constants
 */

/**
 * Default message shown when an unsupported admin action is requested
 */
export const UNSUPPORTED_ACTION_MESSAGE = 'Please contact Clovic for further support.';

/**
 * Maximum number of entries allowed in allowlists/blocklists
 * This limit prevents excessive memory usage and ensures reasonable performance
 * for list operations (filtering, validation, etc.)
 */
export const MAX_LIST_ENTRIES = 500;

/**
 * Default timeout for graceful shutdown in milliseconds
 * If shutdown takes longer than this, the process will force exit
 */
export const SHUTDOWN_TIMEOUT_MS = 30000;

/**
 * Default stale action threshold in milliseconds
 * Actions older than this without completion are considered stale
 */
export const DEFAULT_STALE_ACTION_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Minecraft formatting color codes
 * These are used for branding in Bedrock session displays
 */
export const MINECRAFT_COLORS = {
  /** Blue color code (\u00A79) - used for "Fracture" */
  BLUE: '\u00A79',
  /** Red color code (\u00A7c) - used for "MC" */
  RED: '\u00A7c',
  /** Reset formatting code (\u00A7r) - resets all formatting */
  RESET: '\u00A7r',
} as const;

/**
 * Rate limit configurations for admin actions
 * Each action type can have a sliding window rate limit
 */
export const ACTION_RATE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  apply_config: { windowMs: 60000, max: 6 },
  block_xuid: { windowMs: 60000, max: 12 },
  clear_invite_cooldown: { windowMs: 60000, max: 10 },
  clear_stale_actions: { windowMs: 60000, max: 8 },
  disable_lockdown: { windowMs: 60000, max: 4 },
  enable_lockdown: { windowMs: 60000, max: 4 },
  reconnect_portal: { windowMs: 60000, max: 3 },
  republish_session: { windowMs: 60000, max: 8 },
  run_diagnostics: { windowMs: 60000, max: 12 },
  run_security_diagnostics: { windowMs: 60000, max: 12 },
  unblock_xuid: { windowMs: 60000, max: 12 },
};

// Made with Bob
