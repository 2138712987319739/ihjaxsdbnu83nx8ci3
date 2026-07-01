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

/**
 * Data structure for queued invite retry
 */
type InviteRetryData = {
  xuid: string;
  gamertag: string;
};

const joinabilityMap: Record<RuntimeConfig['joinability'], Joinability> = {
  inviteOnly: Joinability.InviteOnly,
  friendsOnly: Joinability.FriendsOnly,
  friendsOfFriends: Joinability.FriendsOfFriends,
};

const SESSION_KEEPALIVE_MIN_MEMBER_COUNT = 1;
const SESSION_INITIALIZATION_ERROR_TEXT = 'member initialization requiring at least 1 members to start';
const SESSION_STALE_ERROR_TEXT = 'session is configured for member initialization';

type SessionMemberUpdate = {
  members: {
    me: {
      constants: {
        system: {
          xuid: string;
          initialize: true;
        };
        custom?: {
          protocol?: number;
          netherNetEnabled?: boolean;
        };
      };
      properties: {
        system: {
          active: true;
          connection?: string;
          subscription?: {
            id: string;
            changeTypes: ['everything'];
          };
        };
      };
    };
  };
};

type PortalRestRuntime = {
  updateConnection(sessionName: string, connectionId: string): Promise<void>;
  updateSession(sessionName: string, payload: SessionMemberUpdate): Promise<unknown>;
  leaveSession(sessionName: string): Promise<void>;
  setActivity(sessionName: string): Promise<unknown>;
};

type PortalHostRuntime = {
  rest: PortalRestRuntime;
  profile: { xuid?: string } | null;
  subscriptionId?: string;
};

export function isXboxSessionInitializationError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes(SESSION_INITIALIZATION_ERROR_TEXT) || message.includes(SESSION_STALE_ERROR_TEXT);
}

export function isXboxRateLimitError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes('429 too many requests');
}

export class FriendConnectService implements AdminServiceController {
  private portal: BedrockPortal | null = null;
  private inviteCache: InviteCache;
  private inviteRetryQueue: RetryQueue<InviteRetryData>;
  private eventSink: AdminEventSink | null = null;
  private startedAt: string | null = null;
  private totalJoins = 0;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private keepaliveInFlight = false;
  private restartPromise: Promise<void> | null = null;

  constructor(
    private config: RuntimeConfig,
    private readonly logger: Logger,
  ) {
    this.inviteCache = new InviteCache(config.inviteCooldownMs);
    this.inviteRetryQueue = new RetryQueue<InviteRetryData>(
      {
        maxRetries: 3,
        initialDelayMs: 30000, // 30 seconds
        maxDelayMs: 300000, // 5 minutes
        backoffMultiplier: 2,
      },
      (data) => this.retryInvite(data),
      logger,
      'Invite retry queue',
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
      this.startSessionKeepalive();
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
    this.stopSessionKeepalive();

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
      case 'keepalive_ping':
        return this.runKeepaliveAction();
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
        return this.republishSession();
      case 'retry_failed_invites':
        return {
          ok: true,
          message: `Retry queue has ${this.inviteRetryQueue.size()} pending invite(s).`,
          data: { queueSize: this.inviteRetryQueue.size() },
        };
      case 'run_diagnostics':
        return this.runDiagnostics();
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

    this.hardenPortalRest(portal);

    return portal;
  }

  private bindPortalEvents(portal: BedrockPortal): void {
    portal.on('sessionCreated', () => {
      this.logger.info('Bedrock session published', {
        display: 'Fracture MC',
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

  /**
   * Invite a friend to the session
   * Failed invites are automatically queued for retry
   */
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
        // Remove from retry queue if it was there
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
        
        // Add to retry queue
        this.inviteRetryQueue.enqueue(xuid, { xuid, gamertag });
        
        this.recordEvent({
          type: 'invite_failed',
          message: getErrorMessage(error),
          gamertag,
          xuid,
        });
      });
  }

  /**
   * Retry a failed invite (called by retry queue)
   */
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

  async recoverPortal(source: string, error?: unknown): Promise<void> {
    this.logger.warn('Recovering portal after Xbox session refresh failure', {
      source,
      error: error ? getErrorMessage(error) : undefined,
    });
    this.recordEvent({
      type: 'session_recovered',
      message: 'Portal recovery started.',
      payload: { source },
    });

    await this.restartPortal();

    this.recordEvent({
      type: 'session_recovered',
      message: 'Portal recovery completed.',
      payload: { source },
    });
  }

  private async restartPortal(): Promise<void> {
    if (this.restartPromise) {
      await this.restartPromise;
      return;
    }

    this.restartPromise = this.performPortalRestart()
      .finally(() => {
        this.restartPromise = null;
      });

    await this.restartPromise;
  }

  private async performPortalRestart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async republishSession(): Promise<AdminActionResult> {
    return this.runSessionRefreshAction(
      'manual republish',
      'Session republished. The Minecraft session card and player count were refreshed.',
    );
  }

  private async runDiagnostics(): Promise<AdminActionResult> {
    const config = this.config;
    const status = this.getStatusSnapshot(config.admin.botId);
    const steps: string[] = [
      `Checking bot status: ${status.online ? 'Online' : 'Offline'}`,
      `Target server: ${config.bedrockHost}:${config.bedrockPort}`,
    ];

    try {
      const { lookup } = await import('node:dns/promises');
      const address = await lookup(config.bedrockHost);
      steps.push(`DNS: ${config.bedrockHost} resolves to ${address.address}`);

      // Try a UDP Ping to see if the server is actually reachable
      const reachable = await this.pingUDP(address.address, config.bedrockPort);
      if (reachable) {
        steps.push(`Network: Successfully reached the server on port ${config.bedrockPort} (UDP).`);
      } else {
        steps.push(`Network FAILED: Could not reach the server on port ${config.bedrockPort}. Check your Firewall or Geyser config.`);
      }
    } catch (error) {
      steps.push(`DNS FAILED: Could not resolve ${config.bedrockHost}`);
    }

    if (this.portal) {
      steps.push('Xbox Session: Active and visible to friends.');
      const members = this.portal.getSessionMembers();
      steps.push(`Xbox Session: ${members.size} player(s) currently in session.`);
    } else {
      steps.push('Xbox Session: NOT active. Try "Republish session".');
    }

    const consoleLines = [
      `[DIAGNOSTICS - ${new Date().toLocaleTimeString()}]`,
      ...steps.map(s => {
        if (s.includes('FAILED')) return ` [!] ${s}`;
        if (s.includes('Successfully') || s.includes('Active')) return ` [+] ${s}`;
        return ` > ${s}`;
      }),
      '',
      steps.some(s => s.includes('FAILED'))
        ? 'Result: Issues detected. Please follow the English fix steps above.'
        : 'Result: Everything looks perfect from the bot\'s side!',
    ];

    return {
      ok: true,
      message: 'Diagnostics completed. Review the Fix Logs for details.',
      data: {
        ...status,
        steps,
        consoleText: consoleLines.join('\n'),
      },
    };
  }

  private async pingUDP(host: string, port: number): Promise<boolean> {
    const dgram = await import('node:dgram');
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const timeout = setTimeout(() => {
        socket.close();
        resolve(false);
      }, 3000);

      // RakNet Unconnected Ping
      const ping = Buffer.alloc(33);
      ping[0] = 0x01; // ID_UNCONNECTED_PING
      // 8 bytes time (can be 0)
      // 16 bytes magic
      Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex').copy(ping, 9);
      // 8 bytes GUID (can be 0)

      socket.on('message', () => {
        clearTimeout(timeout);
        socket.close();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        socket.close();
        resolve(false);
      });

      socket.send(ping, port, host, (err) => {
        if (err) {
          clearTimeout(timeout);
          socket.close();
          resolve(false);
        }
      });
    });
  }

  private async runKeepaliveAction(): Promise<AdminActionResult> {
    return this.runSessionRefreshAction(
      'admin keepalive',
      'Keepalive completed. The bot session was pinged and is still active.',
    );
  }

  private async runSessionRefreshAction(source: string, successMessage: string): Promise<AdminActionResult> {
    try {
      const data = await this.refreshSession(source);
      return { ok: true, message: successMessage, data };
    } catch (error) {
      if (!isXboxSessionInitializationError(error)) {
        throw error;
      }

      await this.recoverPortal(source, error);
      return {
        ok: true,
        message: 'The Xbox session had gone stale, so the portal was reconnected and is ready again.',
        data: { recovered: true, source },
      };
    }
  }

  private async refreshSession(source: string): Promise<Record<string, unknown>> {
    if (!this.portal) {
      throw new Error('Portal is not running');
    }

    const currentPlayers = this.portal.getSessionMembers().size;
    const visibleMembers = Math.max(SESSION_KEEPALIVE_MIN_MEMBER_COUNT, currentPlayers);
    await this.portal.updateMemberCount(visibleMembers, this.config.worldMaxPlayers);
    await this.refreshSessionActivity(this.portal, source);

    return {
      source,
      currentPlayers,
      visibleMembers,
      maxMembers: this.config.worldMaxPlayers,
    };
  }

  private startSessionKeepalive(): void {
    if (this.keepaliveTimer) {
      return;
    }

    this.keepaliveTimer = setInterval(() => void this.runScheduledKeepalive(), this.config.sessionKeepaliveIntervalMs);
    this.logger.info('Session keepalive started', { intervalMs: this.config.sessionKeepaliveIntervalMs });
  }

  private stopSessionKeepalive(): void {
    if (!this.keepaliveTimer) {
      return;
    }

    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = null;
    this.logger.info('Session keepalive stopped');
  }

  private async runScheduledKeepalive(): Promise<void> {
    if (this.keepaliveInFlight) {
      this.logger.debug('Session keepalive skipped because the previous ping is still running');
      return;
    }

    this.keepaliveInFlight = true;

    try {
      const data = await this.refreshSession('scheduled keepalive');
      this.logger.debug('Session keepalive completed', {
        currentPlayers: Number(data.currentPlayers),
        visibleMembers: Number(data.visibleMembers),
      });
    } catch (error) {
      if (isXboxSessionInitializationError(error)) {
        await this.recoverPortal('scheduled keepalive', error).catch((recoveryError: unknown) => {
          this.logger.error('Portal recovery failed after keepalive error', { error: getErrorMessage(recoveryError) });
        });
        return;
      }

      this.logger.warn('Session keepalive failed', { error: getErrorMessage(error) });
    } finally {
      this.keepaliveInFlight = false;
    }
  }

  private async refreshSessionActivity(portal: BedrockPortal, source: string): Promise<void> {
    const sessionName = portal.session.name;
    if (!sessionName) {
      return;
    }

    const host = portal.host as unknown as PortalHostRuntime;
    await host.rest.setActivity(sessionName).catch((error: unknown) => {
      this.logger.warn('Session activity refresh failed', { source, error: getErrorMessage(error) });
    });
  }

  private hardenPortalRest(portal: BedrockPortal): void {
    const host = portal.host as unknown as PortalHostRuntime;
    const rest = host.rest;
    const originalUpdateConnection = rest.updateConnection.bind(rest);
    const originalUpdateSession = rest.updateSession.bind(rest);
    const originalLeaveSession = rest.leaveSession.bind(rest);

    rest.updateConnection = async (sessionName: string, connectionId: string): Promise<void> => {
      const xuid = host.profile?.xuid;
      const subscriptionId = host.subscriptionId;

      try {
        // Try the original method first
        await originalUpdateConnection(sessionName, connectionId);
        this.logger.debug('Harden: updateConnection succeeded normally');
      } catch (error) {
        if (isXboxSessionInitializationError(error) && xuid && subscriptionId) {
          this.logger.debug('Harden: updateConnection failed with initialization error, retrying with fixed payload', { xuid });
          await rest.updateSession(sessionName, buildInitializedMemberUpdate(xuid, connectionId, subscriptionId));
        } else {
          throw error;
        }
      }
    };

    rest.updateSession = async (sessionName: string, payload: any): Promise<unknown> => {
      const xuid = host.profile?.xuid;

      // Harden session constants and properties if they are present in the payload
      if (payload.constants || payload.properties) {
        if (payload.constants) {
          payload.constants.system = {
            ...(payload.constants.system ?? {}),
            capabilities: {
              ...(payload.constants.system?.capabilities ?? {}),
              connectivity: true,
              multiplayer: true,
            },
          };
        }

        if (payload.properties) {
          payload.properties.system = {
            ...(payload.properties.system ?? {}),
            peerToPeerEnabled: true,
            crossPlayEnabled: true,
          };
        }
      }

      if (xuid && payload?.members?.me) {
        // Ensure initialize constant is always present in any 'me' member update
        payload.members.me.constants = {
          ...payload.members.me.constants,
          system: {
            ...(payload.members.me.constants?.system ?? {}),
            xuid,
            initialize: true,
          },
        };
        // Add protocol and NetherNet constants which help with connectivity
        if (!payload.members.me.constants.custom) {
          payload.members.me.constants.custom = {};
        }
        payload.members.me.constants.custom.protocol = 4;
        payload.members.me.constants.custom.netherNetEnabled = true;

        this.logger.debug('Harden: updateSession injected constants and capabilities', { sessionName });
      }
      return originalUpdateSession(sessionName, payload);
    };

    rest.leaveSession = async (sessionName: string): Promise<void> => {
      try {
        await originalLeaveSession(sessionName);
      } catch (error) {
        if (isXboxSessionInitializationError(error)) {
          this.logger.warn('Ignored stale Xbox session during portal cleanup', { error: getErrorMessage(error) });
          return;
        }

        throw error;
      }
    };
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

function buildInitializedMemberUpdate(xuid: string, connectionId: string, subscriptionId: string): SessionMemberUpdate {
  return {
    members: {
      me: {
        constants: {
          system: {
            xuid,
            initialize: true,
          },
          custom: {
            protocol: 4,
            netherNetEnabled: true,
          },
        },
        properties: {
          system: {
            active: true,
            connection: connectionId,
            subscription: {
              id: subscriptionId,
              changeTypes: ['everything'],
            },
          },
        },
      },
    },
  };
}

function readPatchPayload(payload: unknown): unknown {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload) && 'patch' in payload) {
    return (payload as Record<string, unknown>).patch;
  }

  return payload;
}

/**
 * Extract player identity from various player data formats
 *
 * Player data can come in different formats from different APIs:
 * - Portal events have a nested `profile` object
 * - Social/friend APIs may have properties at the top level
 *
 * Priority order for gamertag:
 * 1. gamertag (primary identifier)
 * 2. uniqueModernGamertag (unique modern format)
 * 3. modernGamertag (modern format, may not be unique)
 * 4. displayName (fallback display name)
 *
 * @param player - Player data from portal or social APIs
 * @returns Normalized player identity with XUID and gamertag
 */
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
