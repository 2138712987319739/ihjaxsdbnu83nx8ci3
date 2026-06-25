// Website or admin panel made by Clovic.
export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  botId: string;
};

export function getPublicEnv(): PublicEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    botId: process.env.NEXT_PUBLIC_FRIENDCONNECT_BOT_ID || 'fracture-main',
  };
}

export function hasSupabaseEnv(env = getPublicEnv()): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
