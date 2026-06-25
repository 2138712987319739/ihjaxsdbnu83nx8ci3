import { mkdirSync } from 'node:fs';

import { BedrockPortal, Joinability, Modules } from 'bedrock-portal';
import { Titles } from 'prismarine-auth';

import type { RemoteConfigPatch, RuntimeConfig } from './config';
import type { Logger } from './logger';
import type { AdminActionResult, AdminActionType, AdminEventSink, AdminServiceController, ServiceStatusSnapshot } from './admin/types';
import type { PortalPlayer, SocialPlayer, PlayerIdentity } from './types';

import { getSessionText } from './brand';
import { InviteCache } from './invite-cache';
import { getErrorMessage } from './logger';
import { normalizeRemoteConfigPatch } from './config';
import { RetryQueue } from './retry-queue';
import { UNSUPPORTED_ACTION_MESSAGE } from './constants';

type InviteRetryData = {
  xuid: string;
  gamertag: string;
};

const joinabilityMap: Record<RuntimeConfig['joinability'], Joinability> = {
  inviteOnly: Joinability.InviteOnly,
  friendsOnly: Joinability.FriendsOnly,
  friendsOfFriends: Joinability.FriendsOfFriends,
};

export class FriendConnectService implements AdminServiceController {
  private portal: BedrockPortal | null = null;
  private inviteCache: InviteCache;
  private inviteRetryQueue: RetryQueue<InviteRetryData>;
  private eventSink: AdminEventSink | null = null;
  private startedAt: string | null = null;
  private totalJoins = 0;

  constructor(
    private config: RuntimeConfig,
    private readonly logger: Logger,
  ) {
    this.inviteCache = new InviteCache(config.inviteCooldownMs);
    this.inviteRetryQueue = new RetryQueue<InviteRetryData>(
      {
        maxRetries: 3,
        initialDelayMs: 5000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
      },
      (data) => this.retryInvite(data),
      logger,
    );
  }

  setEventSink(eventSink: AdminEventSink): void {
    this.eventSink = eventSink;
  }

  async start(): Promise<void> {
    mkdirSync(this.config.authCacheDir, { recursive: true, mode: 0o700 });

    const portal = this.createPortal();
    this.bindPortalEvents(portal);

    this.logger.info('Starting friend connect service', {
      target: `${this.config.bedrockHost}:${this.config.bedrockPort}`,
      joinability: this.config.joinability,
      worldMaxPlayers: this.config.worldMaxPlayers,
    });

    this.portal = portal;

    try {
      await portal.start();
      this.inviteRetryQueue.start();
      this.startedAt = new Date().toISOString();
      this.recordEvent({
        type: 'startup',
        message: 'Friend connect service started.',
        payload: { target: `${this.config.bedrockHost}:${this.config.bedrockPort}` },
      });
    } catch (error) {
      this.portal = null;
      this.inviteRetryQueue.stop();
      await portal.end().catch((shutdownError: unknown) => {
        this.logger.warn('Portal cleanup after startup failure failed', {
          error: getErrorMessage(shutdownError),
        });
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    const portal = this.portal;
    this.portal = null;

    if (!portal) {
      return;
    }

    this.logger.info('Stopping friend connect service');
    this.inviteRetryQueue.stop();
    await portal.end().catch((error: unknown) => {
      this.logger.error('Portal shutdown failed', { error: getErrorMessage(error) });
    });
    this.startedAt = null;
    this.recordEvent({ type: 'shutdown', message: 'Friend connect service stopped.' });
  }

  getStatusSnapshot(botId: string): ServiceStatusSnapshot {
    return {
      botId,
      online: this.portal !== null,
      currentPlayers: this.portal?.getSessionMembers().size ?? 0,
      totalJoins: this.totalJoins,
      targetHost: this.config.bedrockHost,
      targetPort: this.config.bedrockPort,
      sessionDisplay: this.config.worldHostName,
      joinability: this.config.joinability,
      friendPolicy: this.config.friendPolicy,
      lockdownMode: this.config.lockdownMode,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
    };
  }

  async performAdminAction(action: AdminActionType, payload: unknown): Promise<AdminActionResult> {
    switch (action) {
      case 'apply_config':
        return this.applyRemoteConfig(payload);
      case 'block_xuid':
        return this.updateBlockedXuid(payload, true);
      case 'clear_invite_cooldown':
        this.inviteCache.clear();
        return { ok: true, message: 'Invite cooldown cache cleared.' };
      case 'disable_lockdown':
        return this.applyRemoteConfig({ lockdownMode: false });
      case 'enable_lockdown':
        return this.applyRemoteConfig({ lockdownMode: true });
      case 'reconnect_portal':
        await this.restartPortal();
        return { ok: true, message: 'Portal reconnected.' };
      case 'reload_config':
        return { ok: true, message: 'Runtime config snapshot refreshed.' };
      case 'republish_session':
        await this.republishSession();
        return { ok: true, message: 'Session republished.' };
      case 'retry_failed_invites':
        return {
          ok: true,
          message: `Retry queue has ${this.inviteRetryQueue.size()} pending invite(s).`,
          data: { queueSize: this.inviteRetryQueue.size() },
        };
      case 'run_diagnostics':
        return {
          ok: true,
          message: 'Diagnostics completed.',
          data: this.getStatusSnapshot(this.config.admin.botId),
        };
      case 'run_security_diagnostics':
        return {
          ok: true,
          message: 'Security diagnostics completed.',
          data: this.getSecurityDiagnostics(),
        };
      case 'unblock_xuid':
        return this.updateBlockedXuid(payload, false);
      case 'acknowledge_error':
      case 'clear_stale_actions':
        return { ok: true, message: 'Action handled by admin bridge.' };
      default:
        return { ok: false, message: UNSUPPORTED_ACTION_MESSAGE };
    }
  }

  private createPortal(): BedrockPortal {
    const portal = new BedrockPortal({
      ip: this.config.bedrockHost,
      port: this.config.bedrockPort,
      joinability: joinabilityMap[this.config.joinability],
      host: {
        username: this.config.botUsername,
        cache: this.config.authCacheDir,
        options: {
          authTitle: Titles.MinecraftIOS,
          flow: 'sisu',
          deviceType: 'iOS',
        },
        onMsaCode: (response) => {
          this.logger.info('Complete Microsoft device login', { message: response.message });
        },
      },
      world: {
        hostName: getSessionText(this.config.worldHostName, this.config.useBrandColors),
        name: getSessionText(this.config.worldName, this.config.useBrandColors),
        version: this.config.worldVersion,
        memberCount: 1,
        maxMemberCount: this.config.worldMaxPlayers,
      },
      updatePresence: this.config.updatePresence,
    });

    if (this.config.autoFriendAcceptEnabled) {
      portal.use(Modules.AutoFriendAccept, {
        inviteOnAdd: false,
        conditionToMeet: (player) => this.isPlayerAllowed(player),
      });
    }

    if (this.config.autoFriendAddEnabled) {
      portal.use(Modules.AutoFriendAdd, {
        inviteOnAdd: false,
        conditionToMeet: (player) => this.isPlayerAllowed(player),
        checkInterval: this.config.friendCheckIntervalMs,
        addInterval: this.config.friendAddIntervalMs,
        removeInterval: this.config.friendRemoveIntervalMs,
      });
    }

    return portal;
  }

  private bindPortalEvents(portal: BedrockPortal): void {
    portal.on('sessionCreated', () => {
      this.logger.info('Bedrock session published', {
        display: getSessionText(this.config.worldHostName, false),
        target: `${this.config.bedrockHost}:${this.config.bedrockPort}`,
      });
      this.recordEvent({
        type: 'session_created',
        message: 'Bedrock session published.',
        payload: {
          target: `${this.config.bedrockHost}:${this.config.bedrockPort}`,
          friendPolicy: this.config.friendPolicy,
          lockdownMode: this.config.lockdownMode,
        },
      });
    });

    portal.on('sessionUpdated', () => {
      this.logger.debug('Bedrock session updated');
      this.recordEvent({ type: 'session_updated', message: 'Bedrock session updated.' });
    });

    portal.on('friendAdded', (player: PortalPlayer) => {
      this.logger.info('Friend added', {
        gamertag: player.profile?.gamertag ?? 'unknown',
        xuid: player.profile?.xuid ?? 'unknown',
      });
      this.recordEvent({
        type: 'friend_added',
        message: 'Friend added.',
        gamertag: player.profile?.gamertag ?? 'unknown',
        xuid: player.profile?.xuid ?? 'unknown',
      });

      if (!this.isPlayerAllowed(player)) {
        this.recordEvent({
          type: 'friend_rejected',
          message: 'Friend did not match the configured policy.',
          gamertag: player.profile?.gamertag ?? 'unknown',
          xuid: player.profile?.xuid ?? 'unknown',
          payload: { friendPolicy: this.config.friendPolicy, lockdownMode: this.config.lockdownMode },
        });
        return;
      }

      this.inviteFriend(player);
    });

    portal.on('friendRemoved', (player: PortalPlayer) => {
      this.logger.info('Friend removed', {
        gamertag: player.profile?.gamertag ?? 'unknown',
        xuid: player.profile?.xuid ?? 'unknown',
      });
      this.recordEvent({
        type: 'friend_removed',
        message: 'Friend removed.',
        gamertag: player.profile?.gamertag ?? 'unknown',
        xuid: player.profile?.xuid ?? 'unknown',
      });
    });

    portal.on('playerJoin', (player: PortalPlayer) => {
      this.totalJoins += 1;
      this.logger.info('Player joined portal', {
        gamertag: player.profile?.gamertag ?? 'unknown',
        xuid: player.profile?.xuid ?? 'unknown',
      });
      this.recordEvent({
        type: 'player_join',
        message: 'Player joined portal.',
        gamertag: player.profile?.gamertag ?? 'unknown',
        xuid: player.profile?.xuid ?? 'unknown',
      });
    });

    portal.on('playerLeave', (player: PortalPlayer) => {
      this.logger.info('Player left portal', {
        gamertag: player.profile?.gamertag ?? 'unknown',
        xuid: player.profile?.xuid ?? 'unknown',
      });
      this.recordEvent({
        type: 'player_leave',
        message: 'Player left portal.',
        gamertag: player.profile?.gamertag ?? 'unknown',
        xuid: player.profile?.xuid ?? 'unknown',
      });
    });
  }

  private inviteFriend(player: PortalPlayer): void {
    if (!this.config.autoInviteOnFriendAdded) {
      return;
    }

    const xuid = player.profile?.xuid;
    const gamertag = player.profile?.gamertag ?? 'unknown';

    if (!xuid) {
      this.logger.warn('Cannot invite friend without XUID', { gamertag });
      return;
    }

    if (!this.inviteCache.claim(xuid)) {
      this.logger.debug('Invite skipped due to cooldown', { xuid });
      return;
    }

    void this.portal?.invitePlayer(xuid)
      .then(() => {
        this.logger.info('Invite sent', { gamertag, xuid });
        this.inviteRetryQueue.dequeue(xuid);
        this.recordEvent({
          type: 'invite_sent',
          message: 'Invite sent.',
          gamertag,
          xuid,
        });
      })
      .catch((error: unknown) => {
        this.logger.warn('Invite failed, queuing for retry', {
          gamertag,
          xuid,
          error: getErrorMessage(error),
        });
        this.inviteRetryQueue.enqueue(xuid, { xuid, gamertag });

        this.recordEvent({
          type: 'invite_failed',
          message: getErrorMessage(error),
          gamertag,
          xuid,
        });
      });
  }

  private async retryInvite(data: InviteRetryData): Promise<void> {
    if (!this.portal) {
      throw new Error('Portal is not running');
    }

    await this.portal.invitePlayer(data.xuid);
    this.logger.info('Retry invite succeeded', {
      gamertag: data.gamertag,
      xuid: data.xuid,
    });

    this.recordEvent({
      type: 'invite_sent',
      message: 'Invite sent after retry.',
      gamertag: data.gamertag,
      xuid: data.xuid,
    });
  }

  private isPlayerAllowed(player: SocialPlayer): boolean {
    const { xuid, gamertag } = getPlayerIdentity(player);
    const inAllowlist = this.isListed(xuid, gamertag, this.config.allowlistXuids, this.config.allowlistGamertags);
    const inBlocklist = this.isListed(xuid, gamertag, this.config.blocklistXuids, this.config.blocklistGamertags);

    if (inBlocklist) {
      return false;
    }

    if (this.config.lockdownMode || this.config.friendPolicy === 'allowlist') {
      return inAllowlist;
    }

    return true;
  }

  private isListed(xuid: string | null, gamertag: string | null, xuids: string[], gamertags: string[]): boolean {
    const normalizedGamertag = gamertag?.toLowerCase() ?? null;
    return Boolean(
      (xuid && xuids.includes(xuid))
      || (normalizedGamertag && gamertags.includes(normalizedGamertag)),
    );
  }

  private async restartPortal(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async republishSession(): Promise<void> {
    if (!this.portal) {
      throw new Error('Portal is not running');
    }

    const count = this.portal.getSessionMembers().size;
    await this.portal.updateMemberCount(count, this.config.worldMaxPlayers);
  }

  private async applyRemoteConfig(payload: unknown): Promise<AdminActionResult> {
    const patchPayload = readPatchPayload(payload);
    const patch = normalizeRemoteConfigPatch(patchPayload);
    const changed = this.applyPatch(patch);

    if (!changed.length) {
      return { ok: true, message: 'No config changes were needed.' };
    }

    if (changed.includes('inviteCooldownMs')) {
      this.inviteCache = new InviteCache(this.config.inviteCooldownMs);
    }

    await this.restartPortal();

    return {
      ok: true,
      message: `Applied ${changed.length} config change(s).`,
      data: { changed },
    };
  }

  private async updateBlockedXuid(payload: unknown, blocked: boolean): Promise<AdminActionResult> {
    const xuid = readXuidPayload(payload);
    if (!xuid) {
      return { ok: false, message: 'Missing valid XUID.' };
    }

    const blocklist = new Set(this.config.blocklistXuids);
    if (blocked) {
      blocklist.add(xuid);
    } else {
      blocklist.delete(xuid);
    }

    const changed = this.applyPatch({ blocklistXuids: [...blocklist] });
    if (!changed.length) {
      return { ok: true, message: blocked ? 'XUID already blocked.' : 'XUID was not blocked.' };
    }

    await this.restartPortal();

    return {
      ok: true,
      message: blocked ? 'XUID blocked and policy reloaded.' : 'XUID unblocked and policy reloaded.',
      data: { changed, xuid },
    };
  }

  private applyPatch(patch: RemoteConfigPatch): string[] {
    const changed: string[] = [];

    for (const [key, value] of Object.entries(patch) as Array<[keyof RemoteConfigPatch, RuntimeConfig[keyof RemoteConfigPatch]]>) {
      if (value !== undefined && !isSameConfigValue(this.config[key], value)) {
        this.config = { ...this.config, [key]: value };
        changed.push(key);
      }
    }

    return changed;
  }

  private recordEvent(event: Parameters<NonNullable<AdminEventSink['recordEvent']>>[0]): void {
    this.eventSink?.recordEvent(event);
  }

  private getSecurityDiagnostics(): Record<string, unknown> {
    return {
      online: this.portal !== null,
      lockdownMode: this.config.lockdownMode,
      friendPolicy: this.config.friendPolicy,
      autoFriendAcceptEnabled: this.config.autoFriendAcceptEnabled,
      autoFriendAddEnabled: this.config.autoFriendAddEnabled,
      autoInviteOnFriendAdded: this.config.autoInviteOnFriendAdded,
      allowlistXuids: this.config.allowlistXuids.length,
      allowlistGamertags: this.config.allowlistGamertags.length,
      blocklistXuids: this.config.blocklistXuids.length,
      blocklistGamertags: this.config.blocklistGamertags.length,
      inboundAdminApi: false,
      shellActions: false,
      secretLogging: false,
      actionAllowlist: true,
    };
  }
}

function readPatchPayload(payload: unknown): unknown {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload) && 'patch' in payload) {
    return (payload as Record<string, unknown>).patch;
  }

  return payload;
}
function getPlayerIdentity(player: SocialPlayer): PlayerIdentity {
  if ('profile' in player && player.profile) {
    return {
      xuid: player.profile.xuid ?? null,
      gamertag: firstText(player.profile.gamertag, player.profile.uniqueModernGamertag, player.profile.modernGamertag, player.profile.displayName),
    };
  }

  return {
    xuid: player.xuid ?? null,
    gamertag: firstText(player.gamertag, player.uniqueModernGamertag, player.modernGamertag, player.displayName),
  };
}

function firstText(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value?.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readXuidPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const value = (payload as Record<string, unknown>).xuid;
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) {
    return null;
  }

  return value;
}

function isSameConfigValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  return left === right;
}
