'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DashboardData } from '@/types/admin';
import { getPublicEnv } from '@/lib/env';
import { getSupabaseClient } from '@/lib/supabase';
import { defaultConfig, sampleDashboardData } from '@/lib/sample-data';

type SupabaseRecord = Record<string, unknown>;

const HEARTBEAT_FRESH_MS = 90000;

export function useDashboardData(enabled: boolean) {
  const queryClient = useQueryClient();
  const supabase = getSupabaseClient();
  const botId = getPublicEnv().botId;

  useEffect(() => {
    if (!enabled || !supabase) {
      return;
    }

    const channel = supabase
      .channel(`friendconnect-admin-${botId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_status', filter: `bot_id=eq.${botId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard', botId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_events', filter: `bot_id=eq.${botId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard', botId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_errors', filter: `bot_id=eq.${botId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard', botId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fix_logs', filter: `bot_id=eq.${botId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard', botId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'security_events', filter: `bot_id=eq.${botId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard', botId] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [botId, enabled, queryClient, supabase]);

  return useQuery({
    queryKey: ['dashboard', botId],
    queryFn: () => fetchDashboardData(botId),
    enabled,
    refetchInterval: enabled ? 10000 : false,
    initialData: sampleDashboardData,
  });
}

async function fetchDashboardData(botId: string): Promise<DashboardData> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return sampleDashboardData;
  }

  const [status, config, adminUsers, events, errors, actions, fixLogs, players, securityEvents] = await Promise.all([
    supabase.from('bot_status').select('*').eq('bot_id', botId).maybeSingle(),
    supabase.from('bot_config').select('*').eq('bot_id', botId).maybeSingle(),
    supabase.from('admin_users').select('*').order('created_at', { ascending: true }).limit(50),
    supabase.from('bot_events').select('*').eq('bot_id', botId).order('created_at', { ascending: false }).limit(40),
    supabase.from('bot_errors').select('*').eq('bot_id', botId).order('created_at', { ascending: false }).limit(30),
    supabase.from('bot_actions').select('*').eq('bot_id', botId).order('created_at', { ascending: false }).limit(30),
    supabase.from('fix_logs').select('*').eq('bot_id', botId).order('created_at', { ascending: false }).limit(30),
    supabase.from('player_sessions').select('*').eq('bot_id', botId).order('joined_at', { ascending: false }).limit(50),
    supabase.from('security_events').select('*').eq('bot_id', botId).order('created_at', { ascending: false }).limit(40),
  ]);

  const statusRow = status.data as SupabaseRecord | null;
  const configRow = config.data as SupabaseRecord | null;
  const lastHeartbeat = stringValue(statusRow?.last_heartbeat, '');
  const heartbeatFresh = isFreshHeartbeat(lastHeartbeat);
  const online = Boolean(statusRow?.online) && heartbeatFresh;

  return {
    config: mapConfig(configRow),
    status: {
      online,
      heartbeatFresh,
      currentPlayers: numberValue(statusRow?.current_players),
      totalJoins: numberValue(statusRow?.total_joins),
      targetHost: stringValue(statusRow?.target_host, defaultConfig.targetHost),
      targetPort: numberValue(statusRow?.target_port, defaultConfig.targetPort),
      sessionDisplay: stringValue(statusRow?.session_display, defaultConfig.displayName),
      joinability: stringValue(statusRow?.joinability, defaultConfig.joinability) as DashboardData['status']['joinability'],
      friendPolicy: stringValue(statusRow?.friend_policy, defaultConfig.friendPolicy) as DashboardData['status']['friendPolicy'],
      lockdownMode: booleanValue(statusRow?.lockdown_mode, defaultConfig.lockdownMode),
      lastHeartbeat,
    },
    adminUsers: ((adminUsers.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: stringValue(row.user_id, crypto.randomUUID()),
      email: stringValue(row.email, 'unknown'),
      role: roleValue(row.role),
      permissions: permissionListValue(row.permissions),
      invitedAt: nullableString(row.invited_at),
      acceptedAt: nullableString(row.accepted_at),
      passwordSetAt: Object.hasOwn(row, 'password_set_at') ? nullableString(row.password_set_at) : stringValue(row.created_at, new Date().toISOString()),
      lastSeenAt: nullableString(row.last_seen_at),
      disabledAt: nullableString(row.disabled_at),
    })),
    events: ((events.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: stringValue(row.id, crypto.randomUUID()),
      type: stringValue(row.event_type, 'event'),
      message: stringValue(row.message, 'Event received.'),
      gamertag: nullableString(row.gamertag),
      createdAt: stringValue(row.created_at, new Date().toISOString()),
    })),
    errors: ((errors.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: stringValue(row.id, crypto.randomUUID()),
      code: stringValue(row.code, 'unknown'),
      message: stringValue(row.message, 'Unknown error.'),
      severity: stringValue(row.severity, 'warning') as DashboardData['errors'][number]['severity'],
      status: stringValue(row.status, 'open') as DashboardData['errors'][number]['status'],
      fixAction: nullableString(row.fix_action),
      createdAt: stringValue(row.created_at, new Date().toISOString()),
    })),
    actions: ((actions.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: stringValue(row.id, crypto.randomUUID()),
      actionType: stringValue(row.action_type, 'unknown'),
      status: stringValue(row.status, 'queued') as DashboardData['actions'][number]['status'],
      message: resultMessage(row.result),
      createdAt: stringValue(row.created_at, new Date().toISOString()),
    })),
    fixLogs: ((fixLogs.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: stringValue(row.id, crypto.randomUUID()),
      actionType: stringValue(row.action_type, 'unknown'),
      status: stringValue(row.status, 'failed') as DashboardData['fixLogs'][number]['status'],
      message: stringValue(row.message, 'No message.'),
      createdAt: stringValue(row.created_at, new Date().toISOString()),
    })),
    players: ((players.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: stringValue(row.id, crypto.randomUUID()),
      gamertag: stringValue(row.gamertag, 'Unknown'),
      xuid: stringValue(row.xuid, 'unknown'),
      joinedAt: stringValue(row.joined_at, new Date().toISOString()),
      leftAt: nullableString(row.left_at),
    })),
    securityEvents: ((securityEvents.data ?? []) as SupabaseRecord[]).map((row) => ({
      id: stringValue(row.id, crypto.randomUUID()),
      severity: stringValue(row.severity, 'info') as DashboardData['securityEvents'][number]['severity'],
      category: stringValue(row.category, 'runtime'),
      message: stringValue(row.message, 'Security event.'),
      source: stringValue(row.source, 'bot_bridge'),
      createdAt: stringValue(row.created_at, new Date().toISOString()),
    })),
  };
}

function roleValue(value: unknown): DashboardData['adminUsers'][number]['role'] {
  if (value === 'owner' || value === 'admin' || value === 'operator' || value === 'viewer') {
    return value;
  }

  return 'viewer';
}

function permissionListValue(value: unknown): DashboardData['adminUsers'][number]['permissions'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is DashboardData['adminUsers'][number]['permissions'][number] => (
    entry === 'config:write'
    || entry === 'actions:write'
    || entry === 'users:write'
    || entry === 'security:write'
  ));
}

function mapConfig(row: SupabaseRecord | null): DashboardData['config'] {
  const value = row?.config;
  const config = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as SupabaseRecord
    : {};

  return {
    ...defaultConfig,
    displayName: stringValue(config.displayName, defaultConfig.displayName),
    targetHost: stringValue(config.targetHost, defaultConfig.targetHost),
    targetPort: numberValue(config.targetPort, defaultConfig.targetPort),
    primaryColor: stringValue(config.primaryColor, defaultConfig.primaryColor),
    secondaryColor: stringValue(config.secondaryColor, defaultConfig.secondaryColor),
    panelFont: panelFontValue(config.panelFont),
    brandingAssetUrl: stringValue(config.brandingAssetUrl, defaultConfig.brandingAssetUrl),
    joinability: stringValue(config.joinability, defaultConfig.joinability) as DashboardData['config']['joinability'],
    useBrandColors: booleanValue(config.useBrandColors, defaultConfig.useBrandColors),
    worldVersion: stringValue(config.worldVersion, defaultConfig.worldVersion),
    updatePresence: booleanValue(config.updatePresence, defaultConfig.updatePresence),
    inviteCooldownMs: numberValue(config.inviteCooldownMs, defaultConfig.inviteCooldownMs),
    worldMaxPlayers: numberValue(config.worldMaxPlayers, defaultConfig.worldMaxPlayers),
    sessionCardText: stringValue(config.sessionCardText, defaultConfig.sessionCardText),
    autoFriendAcceptEnabled: booleanValue(config.autoFriendAcceptEnabled, defaultConfig.autoFriendAcceptEnabled),
    autoFriendAddEnabled: booleanValue(config.autoFriendAddEnabled, defaultConfig.autoFriendAddEnabled),
    autoInviteOnFriendAdded: booleanValue(config.autoInviteOnFriendAdded, defaultConfig.autoInviteOnFriendAdded),
    friendPolicy: stringValue(config.friendPolicy, defaultConfig.friendPolicy) as DashboardData['config']['friendPolicy'],
    allowlistXuids: stringListValue(config.allowlistXuids, defaultConfig.allowlistXuids),
    allowlistGamertags: stringListValue(config.allowlistGamertags, defaultConfig.allowlistGamertags),
    blocklistXuids: stringListValue(config.blocklistXuids, defaultConfig.blocklistXuids),
    blocklistGamertags: stringListValue(config.blocklistGamertags, defaultConfig.blocklistGamertags),
    lockdownMode: booleanValue(config.lockdownMode, defaultConfig.lockdownMode),
    friendCheckIntervalMs: numberValue(config.friendCheckIntervalMs, defaultConfig.friendCheckIntervalMs),
    friendAddIntervalMs: numberValue(config.friendAddIntervalMs, defaultConfig.friendAddIntervalMs),
    friendRemoveIntervalMs: numberValue(config.friendRemoveIntervalMs, defaultConfig.friendRemoveIntervalMs),
  };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function isFreshHeartbeat(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Date.now() - timestamp <= HEARTBEAT_FRESH_MS;
}

function panelFontValue(value: unknown): DashboardData['config']['panelFont'] {
  if (value === 'Geist' || value === 'Inter' || value === 'System' || value === 'IBM Plex Sans' || value === 'Space Grotesk') {
    return value;
  }

  return defaultConfig.panelFont;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringListValue(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function resultMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const message = (value as SupabaseRecord).message;
  return typeof message === 'string' ? message : null;
}
