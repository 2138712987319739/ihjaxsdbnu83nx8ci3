export type Joinability = 'inviteOnly' | 'friendsOnly' | 'friendsOfFriends';
export type FriendPolicy = 'open' | 'allowlist' | 'blocklist';
export type PanelFont = 'Geist' | 'Inter' | 'System' | 'IBM Plex Sans' | 'Space Grotesk';
export type AdminRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type AdminPermission = 'config:write' | 'actions:write' | 'users:write' | 'security:write';

export type BotConfig = {
  displayName: string;
  targetHost: string;
  targetPort: number;
  primaryColor: string;
  secondaryColor: string;
  panelFont: PanelFont;
  brandingAssetUrl: string;
  joinability: Joinability;
  useBrandColors: boolean;
  worldVersion: string;
  updatePresence: boolean;
  inviteCooldownMs: number;
  worldMaxPlayers: number;
  sessionCardText: string;
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
};

export type BotStatus = {
  online: boolean;
  heartbeatFresh: boolean;
  currentPlayers: number;
  totalJoins: number;
  targetHost: string;
  targetPort: number;
  sessionDisplay: string;
  joinability: Joinability;
  friendPolicy: FriendPolicy;
  lockdownMode: boolean;
  lastHeartbeat: string | null;
};

export type BotEvent = {
  id: string;
  type: string;
  message: string;
  gamertag: string | null;
  createdAt: string;
};

export type BotError = {
  id: string;
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  fixAction: string | null;
  createdAt: string;
};

export type BotAction = {
  id: string;
  actionType: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  message: string | null;
  createdAt: string;
};

export type FixLog = {
  id: string;
  actionType: string;
  status: 'completed' | 'failed';
  message: string;
  createdAt: string;
};

export type PlayerSession = {
  id: string;
  gamertag: string;
  xuid: string;
  joinedAt: string;
  leftAt: string | null;
};

export type SecurityEvent = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  message: string;
  source: string;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  email: string;
  role: AdminRole;
  permissions: AdminPermission[];
  invitedAt: string | null;
  acceptedAt: string | null;
  passwordSetAt: string | null;
  lastSeenAt: string | null;
  disabledAt: string | null;
};

export type DashboardData = {
  config: BotConfig;
  status: BotStatus;
  adminUsers: AdminUser[];
  events: BotEvent[];
  errors: BotError[];
  actions: BotAction[];
  fixLogs: FixLog[];
  players: PlayerSession[];
  securityEvents: SecurityEvent[];
};
