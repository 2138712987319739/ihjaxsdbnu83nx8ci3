import { z } from 'zod';

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const safeText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !hasControlCharacter(value) && !hasMinecraftFormatting(value));
const hostLabel = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';
const domain = new RegExp(`^(?:${hostLabel}\\.)+${hostLabel}$`);
const ipv4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const xuidSchema = z.string().trim().regex(/^\d{1,20}$/);
const gamertagSchema = z.string().trim().min(1).max(32).refine((value) => !hasControlCharacter(value));

export const configSchema = z.object({
  displayName: safeText(80),
  targetHost: z.string().trim().min(1).max(253).refine((value) => {
    return !value.includes('://') && !value.includes('/') && !/\s/.test(value) && (value === 'localhost' || domain.test(value) || ipv4.test(value));
  }),
  targetPort: z.number().int().min(1).max(65535),
  primaryColor: colorSchema,
  secondaryColor: colorSchema,
  panelFont: z.enum(['Geist', 'Inter', 'System', 'IBM Plex Sans', 'Space Grotesk']),
  brandingAssetUrl: z.string().trim().max(500).refine((value) => !value || /^https:\/\/[^\s]+$/i.test(value)),
  joinability: z.enum(['inviteOnly', 'friendsOnly', 'friendsOfFriends']),
  useBrandColors: z.boolean(),
  worldVersion: safeText(40),
  updatePresence: z.boolean(),
  inviteCooldownMs: z.number().int().min(10000).max(3600000),
  worldMaxPlayers: z.number().int().min(1).max(1000),
  sessionCardText: safeText(120),
  autoFriendAcceptEnabled: z.boolean(),
  autoFriendAddEnabled: z.boolean(),
  autoInviteOnFriendAdded: z.boolean(),
  friendPolicy: z.enum(['open', 'allowlist', 'blocklist']),
  allowlistXuids: z.array(xuidSchema).max(500),
  allowlistGamertags: z.array(gamertagSchema).max(500),
  blocklistXuids: z.array(xuidSchema).max(500),
  blocklistGamertags: z.array(gamertagSchema).max(500),
  lockdownMode: z.boolean(),
  friendCheckIntervalMs: z.number().int().min(5000).max(3600000),
  friendAddIntervalMs: z.number().int().min(1000).max(600000),
  friendRemoveIntervalMs: z.number().int().min(1000).max(600000),
  keepaliveIntervalMs: z.number().int().min(120000).max(300000),
});

export function parseListText(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean))];
}

export function listToText(value: string[]): string {
  return value.join('\n');
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

function hasMinecraftFormatting(value: string): boolean {
  return /\u00a7[0-9A-FK-OR]/i.test(value);
}
