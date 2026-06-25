/**
 * Shared type definitions for player data structures
 */

/**
 * Player profile information from Xbox/Bedrock services
 * Made compatible with bedrock-portal's Person type
 */
export type PlayerProfile = {
  xuid?: string;
  gamertag?: string;
  displayName?: string;
  modernGamertag?: string;
  uniqueModernGamertag?: string;
};

/**
 * Player data from portal events
 * Compatible with bedrock-portal's Player type
 */
export type PortalPlayer = {
  profile?: PlayerProfile;
};

/**
 * Player data from social/friend APIs
 * Can have profile nested or properties at top level
 */
export type SocialPlayer = PortalPlayer & {
  xuid?: string;
  gamertag?: string;
  displayName?: string;
  modernGamertag?: string;
  uniqueModernGamertag?: string;
};

/**
 * Normalized player identity extracted from various player data formats
 */
export type PlayerIdentity = {
  xuid: string | null;
  gamertag: string | null;
};

/**
 * Supabase database row types for type-safe queries
 */
export type SupabaseRow<T extends string> = T extends 'player_sessions'
  ? { id: string; bot_id: string; xuid: string; gamertag: string; joined_at: string; left_at: string | null }
  : T extends 'bot_errors'
  ? { id: string; bot_id: string; code: string; message: string; severity: string; status: string }
  : Record<string, unknown>;

/**
 * Generic Supabase query response
 */
export type SupabaseResponse<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

// Made with Bob
