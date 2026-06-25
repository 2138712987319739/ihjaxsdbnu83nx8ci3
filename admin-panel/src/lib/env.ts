export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  botId: string;
  basePath: string;
};

export function getPublicEnv(): PublicEnv {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    botId: process.env.NEXT_PUBLIC_FRIENDCONNECT_BOT_ID || 'fracture-main',
    basePath: normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? ''),
  };
}

export function hasSupabaseEnv(env = getPublicEnv()): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}
