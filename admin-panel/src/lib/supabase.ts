// Website or admin panel made by Clovic.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv, hasSupabaseEnv } from '@/lib/env';

let browserClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const env = getPublicEnv();
  if (!hasSupabaseEnv(env)) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
      },
    });
  }

  return browserClient;
}
