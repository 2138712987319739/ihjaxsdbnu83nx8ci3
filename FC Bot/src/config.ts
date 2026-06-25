import { existsSync } from 'node:fs';
import { isAbsolute, resolve, normalize } from 'node:path';
import { config as loadDotenv } from 'dotenv';

import { MAX_LIST_ENTRIES } from './constants';

export type JoinabilityMode = 'inviteOnly' | 'friendsOnly' | 'friendsOfFriends';
export type FriendPolicy = 'open' | 'allowlist' | 'blocklist';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type RuntimeConfig = {
  bedrockHost: string;
  bedrockPort: number;
  botUsername: string;
  authCacheDir: string;
  joinability: JoinabilityMode;
  useBrandColors: boolean;
  worldHostName: string;
  worldName: string;
  worldVersion: string;
  updatePresence: boolean;
  worldMaxPlayers: number;
  autoFriendAcceptEnabled: boolean;
  autoFriendAddEnabled: boolean;
  autoInviteOnFriendAdded: boolean;
  friendPolicy: FriendPolicy;
  allowlistXuids: string[];
  allowlistGamertags: string[];
  blocklistXuids: string[];
  blocklistGamertags: string[];
  lockdownMode: boolean;
  friendCheckIntervalMs: number;
  friendAddIntervalMs: number;
  friendRemoveIntervalMs: number;
  inviteCooldownMs: number;
  logLevel: LogLevel;
  admin: AdminBridgeConfig;
};

export type AdminBridgeConfig = {
  enabled: boolean;
  supabaseUrl: string | null;
  serviceRoleKey: string | null;
  botId: string;
  pollIntervalMs: number;
  statusIntervalMs: number;
};

export type RemoteConfigPatch = Partial<Omit<RuntimeConfig, 'admin' | 'authCacheDir' | 'logLevel'>>;

const defaults = {
  bedrockHost: 'play.fracturemc.com',
  bedrockPort: '19132',
  botUsername: 'FractureMC',
  authCacheDir: '.runtime/auth',
  joinability: 'friendsOnly',
  useBrandColors: 'false',
  worldHostName: 'FractureMC',
  worldName: 'FractureMC',
  worldVersion: 'Crossplay Portal',
  updatePresence: 'true',
  worldMaxPlayers: '100',
  autoFriendAcceptEnabled: 'true',
  autoFriendAddEnabled: 'true',
  autoInviteOnFriendAdded: 'true',
  friendPolicy: 'open',
  allowlistXuids: '',
  allowlistGamertags: '',
  blocklistXuids: '',
  blocklistGamertags: '',
  lockdownMode: 'false',
  friendCheckIntervalMs: '5000',
  friendAddIntervalMs: '5000',
  friendRemoveIntervalMs: '2500',
  inviteCooldownMs: '90000',
  logLevel: 'info',
  adminEnabled: '',
  adminSupabaseUrl: '',
  adminServiceRoleKey: '',
  adminBotId: 'fracture-main',
  adminPollIntervalMs: '5000',
  adminStatusIntervalMs: '10000',
} as const;

export function loadEnvFile(path = resolve(process.cwd(), '.env')): void {
  if (!existsSync(path)) {
    return;
  }

  loadDotenv({ path, override: false });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const bedrockHost = validateHost(readEnv(env, 'FRACTURE_BEDROCK_HOST', defaults.bedrockHost), 'FRACTURE_BEDROCK_HOST');

  const admin = readAdminConfig(env);

  return {
    bedrockHost,
    bedrockPort: readPort(env, 'FRACTURE_BEDROCK_PORT', defaults.bedrockPort),
    botUsername: readNonEmpty(env, 'FRACTURE_BOT_USERNAME', defaults.botUsername),
    authCacheDir: readPath(env, 'FRACTURE_AUTH_CACHE_DIR', defaults.authCacheDir),
    joinability: readJoinability(env, 'FRACTURE_JOINABILITY', defaults.joinability),
    useBrandColors: readBoolean(env, 'FRACTURE_USE_BRAND_COLORS', defaults.useBrandColors),
    worldHostName: readDisplayText(env, 'FRACTURE_WORLD_HOST_NAME', defaults.worldHostName, 80),
    worldName: readDisplayText(env, 'FRACTURE_WORLD_NAME', defaults.worldName, 120),
    worldVersion: readDisplayText(env, 'FRACTURE_WORLD_VERSION', defaults.worldVersion, 40),
    updatePresence: readBoolean(env, 'FRACTURE_UPDATE_PRESENCE', defaults.updatePresence),
    worldMaxPlayers: readInteger(env, 'FRACTURE_WORLD_MAX_PLAYERS', defaults.worldMaxPlayers, 1, 1000),
    autoFriendAcceptEnabled: readBoolean(env, 'FRACTURE_AUTO_FRIEND_ACCEPT_ENABLED', defaults.autoFriendAcceptEnabled),
    autoFriendAddEnabled: readBoolean(env, 'FRACTURE_AUTO_FRIEND_ADD_ENABLED', defaults.autoFriendAddEnabled),
    autoInviteOnFriendAdded: readBoolean(env, 'FRACTURE_AUTO_INVITE_ON_FRIEND_ADDED', defaults.autoInviteOnFriendAdded),
    friendPolicy: readFriendPolicy(env, 'FRACTURE_FRIEND_POLICY', defaults.friendPolicy),
    allowlistXuids: readList(env, 'FRACTURE_ALLOWLIST_XUIDS', defaults.allowlistXuids, validateXuid),
    allowlistGamertags: readList(env, 'FRACTURE_ALLOWLIST_GAMERTAGS', defaults.allowlistGamertags, validateGamertag),
    blocklistXuids: readList(env, 'FRACTURE_BLOCKLIST_XUIDS', defaults.blocklistXuids, validateXuid),
    blocklistGamertags: readList(env, 'FRACTURE_BLOCKLIST_GAMERTAGS', defaults.blocklistGamertags, validateGamertag),
    lockdownMode: readBoolean(env, 'FRACTURE_LOCKDOWN_MODE', defaults.lockdownMode),
    friendCheckIntervalMs: readInteger(env, 'FRACTURE_FRIEND_CHECK_INTERVAL_MS', defaults.friendCheckIntervalMs, 5000, 3600000),
    friendAddIntervalMs: readInteger(env, 'FRACTURE_FRIEND_ADD_INTERVAL_MS', defaults.friendAddIntervalMs, 1000, 600000),
    friendRemoveIntervalMs: readInteger(env, 'FRACTURE_FRIEND_REMOVE_INTERVAL_MS', defaults.friendRemoveIntervalMs, 1000, 600000),
    inviteCooldownMs: readInteger(env, 'FRACTURE_INVITE_COOLDOWN_MS', defaults.inviteCooldownMs, 10000, 3600000),
    logLevel: readLogLevel(env, 'LOG_LEVEL', defaults.logLevel),
    admin,
  };
}

export function normalizeRemoteConfigPatch(input: unknown): RemoteConfigPatch {
  if (!isRecord(input)) {
    throw new Error('Remote config payload must be an object');
  }

  const patch: RemoteConfigPatch = {};

  if ('bedrockHost' in input) {
    patch.bedrockHost = validateHost(readStringValue(input.bedrockHost, 'bedrockHost'), 'bedrockHost');
  }

  if ('bedrockPort' in input) {
    patch.bedrockPort = readIntegerValue(input.bedrockPort, 'bedrockPort', 1, 65535);
  }

  if ('botUsername' in input) {
    patch.botUsername = readStringValue(input.botUsername, 'botUsername');
  }

  if ('joinability' in input) {
    patch.joinability = readJoinabilityValue(input.joinability, 'joinability');
  }

  if ('useBrandColors' in input) {
    patch.useBrandColors = readBooleanValue(input.useBrandColors, 'useBrandColors');
  }

  if ('worldHostName' in input) {
    patch.worldHostName = validateDisplayText(readStringValue(input.worldHostName, 'worldHostName'), 'worldHostName', 80);
  }

  if ('worldName' in input) {
    patch.worldName = validateDisplayText(readStringValue(input.worldName, 'worldName'), 'worldName', 120);
  }

  if ('worldVersion' in input) {
    patch.worldVersion = validateDisplayText(readStringValue(input.worldVersion, 'worldVersion'), 'worldVersion', 40);
  }

  if ('updatePresence' in input) {
    patch.updatePresence = readBooleanValue(input.updatePresence, 'updatePresence');
  }

  if ('worldMaxPlayers' in input) {
    patch.worldMaxPlayers = readIntegerValue(input.worldMaxPlayers, 'worldMaxPlayers', 1, 1000);
  }

  if ('autoFriendAcceptEnabled' in input) {
    patch.autoFriendAcceptEnabled = readBooleanValue(input.autoFriendAcceptEnabled, 'autoFriendAcceptEnabled');
  }

  if ('autoFriendAddEnabled' in input) {
    patch.autoFriendAddEnabled = readBooleanValue(input.autoFriendAddEnabled, 'autoFriendAddEnabled');
  }

  if ('autoInviteOnFriendAdded' in input) {
    patch.autoInviteOnFriendAdded = readBooleanValue(input.autoInviteOnFriendAdded, 'autoInviteOnFriendAdded');
  }

  if ('friendPolicy' in input) {
    patch.friendPolicy = readFriendPolicyValue(input.friendPolicy, 'friendPolicy');
  }

  if ('allowlistXuids' in input) {
    patch.allowlistXuids = readListValue(input.allowlistXuids, 'allowlistXuids', validateXuid);
  }

  if ('allowlistGamertags' in input) {
    patch.allowlistGamertags = readListValue(input.allowlistGamertags, 'allowlistGamertags', validateGamertag);
  }

  if ('blocklistXuids' in input) {
    patch.blocklistXuids = readListValue(input.blocklistXuids, 'blocklistXuids', validateXuid);
  }

  if ('blocklistGamertags' in input) {
    patch.blocklistGamertags = readListValue(input.blocklistGamertags, 'blocklistGamertags', validateGamertag);
  }

  if ('lockdownMode' in input) {
    patch.lockdownMode = readBooleanValue(input.lockdownMode, 'lockdownMode');
  }

  if ('friendCheckIntervalMs' in input) {
    patch.friendCheckIntervalMs = readIntegerValue(input.friendCheckIntervalMs, 'friendCheckIntervalMs', 5000, 3600000);
  }

  if ('friendAddIntervalMs' in input) {
    patch.friendAddIntervalMs = readIntegerValue(input.friendAddIntervalMs, 'friendAddIntervalMs', 1000, 600000);
  }

  if ('friendRemoveIntervalMs' in input) {
    patch.friendRemoveIntervalMs = readIntegerValue(input.friendRemoveIntervalMs, 'friendRemoveIntervalMs', 1000, 600000);
  }

  if ('inviteCooldownMs' in input) {
    patch.inviteCooldownMs = readIntegerValue(input.inviteCooldownMs, 'inviteCooldownMs', 10000, 3600000);
  }

  return patch;
}

function readEnv(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  return env[key]?.trim() || fallback;
}

function readNonEmpty(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = readEnv(env, key, fallback);
  if (!value) {
    throw new Error(`${key} cannot be empty`);
  }
  return value;
}

function readPath(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = readNonEmpty(env, key, fallback);

  if (value.includes('\0')) {
    throw new Error(`${key} contains an invalid path character`);
  }

  const resolvedPath = isAbsolute(value) ? normalize(value) : resolve(process.cwd(), value);

  if (!isAbsolute(value)) {
    const cwd = process.cwd();
    if (!resolvedPath.startsWith(cwd)) {
      throw new Error(`${key} attempts to traverse outside the working directory`);
    }
  }
  
  return resolvedPath;
}

function readPort(env: NodeJS.ProcessEnv, key: string, fallback: string): number {
  return readInteger(env, key, fallback, 1, 65535);
}

function readDisplayText(env: NodeJS.ProcessEnv, key: string, fallback: string, maxLength: number): string {
  return validateDisplayText(readNonEmpty(env, key, fallback), key, maxLength);
}

function readInteger(env: NodeJS.ProcessEnv, key: string, fallback: string, min: number, max: number): number {
  const raw = readEnv(env, key, fallback);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${key} must be a whole number`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}`);
  }

  return value;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string, fallback: string): boolean {
  const raw = readEnv(env, key, fallback).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }
  throw new Error(`${key} must be true or false`);
}

function readJoinability(env: NodeJS.ProcessEnv, key: string, fallback: string): JoinabilityMode {
  const value = readEnv(env, key, fallback);
  if (value === 'inviteOnly' || value === 'friendsOnly' || value === 'friendsOfFriends') {
    return value;
  }
  throw new Error(`${key} must be inviteOnly, friendsOnly, or friendsOfFriends`);
}

function readFriendPolicy(env: NodeJS.ProcessEnv, key: string, fallback: string): FriendPolicy {
  const value = readEnv(env, key, fallback);
  if (value === 'open' || value === 'allowlist' || value === 'blocklist') {
    return value;
  }
  throw new Error(`${key} must be open, allowlist, or blocklist`);
}

function readLogLevel(env: NodeJS.ProcessEnv, key: string, fallback: string): LogLevel {
  const value = readEnv(env, key, fallback);
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  throw new Error(`${key} must be debug, info, warn, or error`);
}

function readAdminConfig(env: NodeJS.ProcessEnv): AdminBridgeConfig {
  const supabaseUrl = readOptional(env, 'FRIENDCONNECT_ADMIN_SUPABASE_URL', defaults.adminSupabaseUrl);
  const serviceRoleKey = readOptional(env, 'FRIENDCONNECT_ADMIN_SUPABASE_SERVICE_ROLE_KEY', defaults.adminServiceRoleKey);
  const inferredEnabled = supabaseUrl && serviceRoleKey ? 'true' : 'false';
  const enabled = readBoolean(env, 'FRIENDCONNECT_ADMIN_ENABLED', defaults.adminEnabled || inferredEnabled);

  if (enabled && (!supabaseUrl || !serviceRoleKey)) {
    throw new Error('Admin bridge requires FRIENDCONNECT_ADMIN_SUPABASE_URL and FRIENDCONNECT_ADMIN_SUPABASE_SERVICE_ROLE_KEY');
  }

  return {
    enabled,
    supabaseUrl,
    serviceRoleKey,
    botId: readNonEmpty(env, 'FRIENDCONNECT_ADMIN_BOT_ID', defaults.adminBotId),
    pollIntervalMs: readInteger(env, 'FRIENDCONNECT_ADMIN_POLL_INTERVAL_MS', defaults.adminPollIntervalMs, 1000, 600000),
    statusIntervalMs: readInteger(env, 'FRIENDCONNECT_ADMIN_STATUS_INTERVAL_MS', defaults.adminStatusIntervalMs, 1000, 600000),
  };
}

function readOptional(env: NodeJS.ProcessEnv, key: string, fallback: string): string | null {
  const value = readEnv(env, key, fallback);
  return value ? value : null;
}

function readStringValue(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return value.trim();
}

function readList(env: NodeJS.ProcessEnv, key: string, fallback: string, validator: (value: string, key: string) => string): string[] {
  return normalizeList(readEnv(env, key, fallback), key, validator);
}

function readListValue(value: unknown, key: string, validator: (value: string, key: string) => string): string[] {
  if (Array.isArray(value)) {
    return normalizeList(value, key, validator);
  }

  if (typeof value === 'string') {
    return normalizeList(value, key, validator);
  }

  throw new Error(`${key} must be a list of strings`);
}

function readIntegerValue(value: unknown, key: string, min: number, max: number): number {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= min && value <= max) {
      return value;
    }
    throw new Error(`${key} must be between ${min} and ${max}`);
  }

  if (typeof value === 'string') {
    return readInteger({ [key]: value }, key, String(min), min, max);
  }

  throw new Error(`${key} must be a whole number`);
}

function readBooleanValue(value: unknown, key: string): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return readBoolean({ [key]: value }, key, 'false');
  }

  throw new Error(`${key} must be true or false`);
}

function readJoinabilityValue(value: unknown, key: string): JoinabilityMode {
  if (typeof value !== 'string') {
    throw new Error(`${key} must be inviteOnly, friendsOnly, or friendsOfFriends`);
  }

  return readJoinability({ [key]: value }, key, 'friendsOnly');
}

function readFriendPolicyValue(value: unknown, key: string): FriendPolicy {
  if (typeof value !== 'string') {
    throw new Error(`${key} must be open, allowlist, or blocklist`);
  }

  return readFriendPolicy({ [key]: value }, key, 'open');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeList(
  value: string | unknown[],
  key: string,
  validator: (entry: string, key: string) => string,
): string[] {
  const rawEntries = Array.isArray(value) ? value : value.split(',');
  const normalized = new Set<string>();

  for (const rawEntry of rawEntries) {
    if (typeof rawEntry !== 'string') {
      throw new Error(`${key} entries must be strings`);
    }

    const entry = rawEntry.trim();
    if (!entry) {
      continue;
    }

    normalized.add(validator(entry, key));
  }

  if (normalized.size > MAX_LIST_ENTRIES) {
    throw new Error(`${key} cannot contain more than ${MAX_LIST_ENTRIES} entries`);
  }

  return [...normalized];
}

function validateDisplayText(value: string, key: string, maxLength: number): string {
  if (value.length > maxLength) {
    throw new Error(`${key} must be ${maxLength} characters or fewer`);
  }

  if (hasControlCharacter(value)) {
    throw new Error(`${key} contains a control character`);
  }

  if (/\u00a7[0-9A-FK-OR]/i.test(value)) {
    throw new Error(`${key} cannot contain Minecraft formatting codes`);
  }

  return value;
}

function validateXuid(value: string, key: string): string {
  if (!/^\d{1,20}$/.test(value)) {
    throw new Error(`${key} entries must be numeric XUID values`);
  }

  return value;
}

function validateGamertag(value: string, key: string): string {
  if (value.length > 32 || hasControlCharacter(value)) {
    throw new Error(`${key} entries must be valid gamertag text`);
  }

  return value.toLowerCase();
}

function validateHost(value: string, key: string): string {
  if (value.includes('://') || value.includes('/') || /\s/.test(value)) {
    throw new Error(`${key} must be a host name or IP address without protocol, path, or spaces`);
  }

  if (value.length < 1 || value.length > 253) {
    throw new Error(`${key} length is invalid`);
  }

  if (value === 'localhost') {
    return value;
  }

  const label = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';
  const domain = new RegExp(`^(?:${label}\\.)+${label}$`);
  const ipv4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

  if (!domain.test(value) && !ipv4.test(value)) {
    throw new Error(`${key} must be a valid domain name or IPv4 address`);
  }

  return value;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      return true;
    }
  }

  return false;
}
