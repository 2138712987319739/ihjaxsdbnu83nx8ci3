
export type PlayerProfile = {
  xuid?: string;
  gamertag?: string;
  displayName?: string;
  modernGamertag?: string;
  uniqueModernGamertag?: string;
};

export type PortalPlayer = {
  profile?: PlayerProfile;
};

export type SocialPlayer = PortalPlayer & {
  xuid?: string;
  gamertag?: string;
  displayName?: string;
  modernGamertag?: string;
  uniqueModernGamertag?: string;
};

export type PlayerIdentity = {
  xuid: string | null;
  gamertag: string | null;
};

export type SupabaseRow<T extends string> = T extends 'player_sessions'
  ? { id: string; bot_id: string; xuid: string; gamertag: string; joined_at: string; left_at: string | null }
  : T extends 'bot_errors'
  ? { id: string; bot_id: string; code: string; message: string; severity: string; status: string }
  : Record<string, unknown>;

export type SupabaseResponse<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

