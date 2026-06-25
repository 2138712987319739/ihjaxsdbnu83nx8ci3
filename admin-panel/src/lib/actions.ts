import type { AdminPermission, AdminRole, BotConfig } from '@/types/admin';
import { configSchema } from '@/lib/config-schema';
import { getPublicEnv } from '@/lib/env';
import { getSupabaseClient } from '@/lib/supabase';

export type BotActionType =
  | 'acknowledge_error'
  | 'apply_config'
  | 'block_xuid'
  | 'clear_invite_cooldown'
  | 'clear_stale_actions'
  | 'create_admin_account'
  | 'disable_lockdown'
  | 'enable_lockdown'
  | 'invite_admin_user'
  | 'reconnect_portal'
  | 'reload_config'
  | 'republish_session'
  | 'retry_failed_invites'
  | 'run_diagnostics'
  | 'run_security_diagnostics'
  | 'unblock_xuid';

export async function queueBotAction(actionType: BotActionType, payload: Record<string, unknown> = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Sign in before queueing actions.');
  }

  const { error } = await supabase.from('bot_actions').insert({
    bot_id: getPublicEnv().botId,
    action_type: actionType,
    payload,
    status: 'queued',
    created_by: user.id,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function inviteAdminUser(input: {
  email: string;
  role: AdminRole;
  permissions: AdminPermission[];
  redirectTo: string;
}) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }

  await queueBotAction('invite_admin_user', {
    email,
    role: input.role,
    permissions: input.permissions,
    redirectTo: input.redirectTo,
  });
}

export async function createAdminAccount(input: {
  email: string;
  credential: string;
  role: AdminRole;
  permissions: AdminPermission[];
}) {
  const email = input.email.trim().toLowerCase();
  const credential = input.credential.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }

  if (credential.length < 12) {
    throw new Error('Use a password with at least 12 characters.');
  }

  await queueBotAction('create_admin_account', {
    email,
    credential,
    role: input.role,
    permissions: input.permissions,
  });
}

export async function saveBotConfig(config: BotConfig) {
  const validatedConfig = configSchema.parse(config);
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Sign in before saving settings.');
  }

  const { error } = await supabase.from('bot_config').upsert({
    bot_id: getPublicEnv().botId,
    config: validatedConfig,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'bot_id' });

  if (error) {
    throw new Error(error.message);
  }

  await queueBotAction('apply_config', { patch: configToPatch(validatedConfig), panel: validatedConfig });
}

export function configToPatch(config: BotConfig) {
  return {
    bedrockHost: config.targetHost,
    bedrockPort: config.targetPort,
    botUsername: config.displayName,
    joinability: config.joinability,
    useBrandColors: false,
    worldHostName: config.displayName,
    worldName: config.sessionCardText,
    worldVersion: config.worldVersion,
    updatePresence: config.updatePresence,
    inviteCooldownMs: config.inviteCooldownMs,
    worldMaxPlayers: config.worldMaxPlayers,
    autoFriendAcceptEnabled: config.autoFriendAcceptEnabled,
    autoFriendAddEnabled: config.autoFriendAddEnabled,
    autoInviteOnFriendAdded: config.autoInviteOnFriendAdded,
    friendPolicy: config.friendPolicy,
    allowlistXuids: config.allowlistXuids,
    allowlistGamertags: config.allowlistGamertags,
    blocklistXuids: config.blocklistXuids,
    blocklistGamertags: config.blocklistGamertags,
    lockdownMode: config.lockdownMode,
    friendCheckIntervalMs: config.friendCheckIntervalMs,
    friendAddIntervalMs: config.friendAddIntervalMs,
    friendRemoveIntervalMs: config.friendRemoveIntervalMs,
  };
}
