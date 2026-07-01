'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AdminUser } from '@/types/admin';
import { getSupabaseClient } from '@/lib/supabase';

type SessionState = {
  user: User | null;
  profile: AdminUser | null;
  firstAdminAvailable: boolean;
  loading: boolean;
};

export function useSession() {
  const [state, setState] = useState<SessionState>({
    user: null,
    profile: null,
    firstAdminAvailable: false,
    loading: true,
  });
  const supabase = getSupabaseClient();

  useEffect(() => {
    const maybeClient = supabase as SupabaseClient | null;
    if (!maybeClient) {
      setState((current) => ({ ...current, loading: false }));
      return;
    }
    const client: SupabaseClient = maybeClient;

    let active = true;

    void refreshSessionState();

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      void refreshSessionState(session?.user ?? null);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
    
    async function refreshSessionState(knownUser?: User | null) {
      const user = typeof knownUser === 'undefined'
        ? (await client.auth.getUser()).data.user ?? null
        : knownUser;

      const [profile, count] = await Promise.all([
        user ? fetchAdminProfile(user.id, user.email ?? '') : Promise.resolve(null),
        fetchAdminCount(),
      ]);

      if (active) {
        setState({
          user,
          profile,
          firstAdminAvailable: count === 0,
          loading: false,
        });
      }
    }

    async function fetchAdminProfile(userId: string, email: string): Promise<AdminUser | null> {
      const { data } = await client
        .from('admin_users')
        .select('*')
        .eq('user_id', userId)
        .is('disabled_at', null)
        .maybeSingle();

      if (!data || typeof data !== 'object') {
        return null;
      }

      const row = data as Record<string, unknown>;
      return {
        id: stringValue(row.user_id, userId),
        email: stringValue(row.email, email),
        role: roleValue(row.role),
        permissions: permissionListValue(row.permissions),
        invitedAt: nullableString(row.invited_at),
        acceptedAt: nullableString(row.accepted_at),
        passwordSetAt: Object.hasOwn(row, 'password_set_at') ? nullableString(row.password_set_at) : stringValue(row.created_at, new Date().toISOString()),
        lastSeenAt: nullableString(row.last_seen_at),
        disabledAt: nullableString(row.disabled_at),
      };
    }

    async function fetchAdminCount(): Promise<number> {
      const { data, error } = await client.rpc('friendconnect_admin_count');
      if (!error && typeof data === 'number' && Number.isFinite(data)) {
        return data;
      }

      const fallback = await client
        .from('admin_users')
        .select('user_id', { count: 'exact', head: true });
      return fallback.count ?? 0;
    }
  }, [supabase]);

  return { ...state, supabase };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function roleValue(value: unknown): AdminUser['role'] {
  if (value === 'owner' || value === 'admin' || value === 'operator' || value === 'viewer') {
    return value;
  }

  return 'viewer';
}

function permissionListValue(value: unknown): AdminUser['permissions'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is AdminUser['permissions'][number] => (
    entry === 'config:write'
    || entry === 'actions:write'
    || entry === 'users:write'
    || entry === 'security:write'
  ));
}
