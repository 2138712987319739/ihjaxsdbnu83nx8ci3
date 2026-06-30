'use client';

import { useEffect, useMemo, useState } from 'react';
import { createActor } from 'xstate';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { Ban, Bug, CheckCircle2, Hammer, KeyRound, LockKeyhole, MailPlus, Play, Radar, ShieldAlert, TerminalSquare, UnlockKeyhole, UserPlus, UsersRound } from 'lucide-react';
import type { AdminPermission, AdminRole, AdminUser, BotAction, BotError, BotEvent, DashboardData, FixLog, PlayerSession, SecurityEvent } from '@/types/admin';
import type { BotActionType } from '@/lib/actions';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createAdminAccount, queueBotAction } from '@/lib/actions';
import { formatDate } from '@/lib/utils';
import { getDefenseSignal, securityMachine } from '@/store/security-machine';

type DeveloperPanelProps = {
  data: DashboardData;
  configured: boolean;
  profile: AdminUser | null;
};

const staleSessionErrorCode = ['session', 'refresh', 'failed'].join('_');

const knownFixes: Record<string, BotActionType> = {
  auth_expired: 'reconnect_portal',
  invite_failed: 'retry_failed_invites',
  rta_disconnected: 'reconnect_portal',
  session_stale: 'republish_session',
  [staleSessionErrorCode]: 'reconnect_portal',
  config_invalid: 'reload_config',
  cooldown_stuck: 'clear_invite_cooldown',
};

const fixActions = [
  'keepalive_ping',
  'run_diagnostics',
  'republish_session',
  'reconnect_portal',
  'clear_invite_cooldown',
  'retry_failed_invites',
  'reload_config',
  'clear_stale_actions',
] as const satisfies readonly BotActionType[];

const securityActions = [
  'run_security_diagnostics',
  'enable_lockdown',
  'disable_lockdown',
] as const satisfies readonly BotActionType[];

const permissionOptions = [
  ['config:write', 'Bot config'],
  ['actions:write', 'Fix actions'],
  ['users:write', 'Admin users'],
  ['security:write', 'Security controls'],
] as const satisfies readonly [AdminPermission, string][];

export function DeveloperPanel({ data, configured, profile }: DeveloperPanelProps) {
  const [activeTab, setActiveTab] = useState('console');
  const [blockXuid, setBlockXuid] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AdminRole>('operator');
  const [invitePermissions, setInvitePermissions] = useState<AdminPermission[]>(['actions:write']);
  const [accountCredential, setAccountCredential] = useState('');
  const [accountCredentialConfirm, setAccountCredentialConfirm] = useState('');
  const [message, setMessage] = useState('');
  const securityActor = useMemo(() => createActor(securityMachine), []);
  const [defenseState, setDefenseState] = useState(String(securityActor.getSnapshot().value));
  const openErrors = data.errors.filter((error) => error.status === 'open').length;
  const canManageUsers = Boolean(profile?.role === 'owner' || profile?.permissions.includes('users:write'));
  const bridgeReady = Boolean(data.status.online && data.status.heartbeatFresh);

  useEffect(() => {
    const subscription = securityActor.subscribe((snapshot) => setDefenseState(String(snapshot.value)));
    securityActor.start();
    return () => {
      subscription.unsubscribe();
      securityActor.stop();
    };
  }, [securityActor]);

  useEffect(() => {
    const signal = getDefenseSignal(data.status.lockdownMode, openErrors, data.securityEvents.length);
    if (signal === 'lockdown') {
      securityActor.send({ type: 'LOCKDOWN' });
    } else if (signal === 'attention') {
      securityActor.send({ type: 'ATTENTION' });
    } else {
      securityActor.send({ type: 'RESET' });
    }
  }, [data.securityEvents.length, data.status.lockdownMode, openErrors, securityActor]);

  async function runFix(error: BotError) {
    const action = error.fixAction as BotActionType | null || knownFixes[error.code];
    if (!action) {
      setMessage('Please contact Clovic for further support.');
      return;
    }

    if (!configured) {
      setMessage('Connect Supabase before running fixes.');
      return;
    }

    await queueBotAction(action, { errorId: error.id, code: error.code });
    setMessage(`${actionTitle(action)} queued.`);
  }

  async function runAction(action: BotActionType, payload: Record<string, unknown> = {}) {
    if (!configured) {
      setMessage('Connect Supabase before queueing actions.');
      return;
    }

    await queueBotAction(action, payload);
    setMessage(`${actionTitle(action)} queued.`);
  }

  async function updateBlockedXuid(action: 'block_xuid' | 'unblock_xuid') {
    const xuid = blockXuid.trim();
    if (!/^\d{1,20}$/.test(xuid)) {
      setMessage('Enter a valid numeric XUID.');
      return;
    }

    await runAction(action, { xuid });
    setBlockXuid('');
  }

  async function createAccount() {
    if (!configured) {
      setMessage('Connect Supabase before creating admin accounts.');
      return;
    }

    if (!canManageUsers) {
      setMessage('Your account does not have Admin users permission.');
      return;
    }

    if (!bridgeReady) {
      setMessage('Bot bridge is offline or stale. Start the Node server before creating admin accounts.');
      return;
    }

    if (accountCredential !== accountCredentialConfirm) {
      setMessage('Passwords do not match.');
      return;
    }

    try {
      const email = inviteEmail.trim().toLowerCase();
      await createAdminAccount({
        email,
        credential: accountCredential,
        role: inviteRole,
        permissions: inviteRole === 'owner' ? ['config:write', 'actions:write', 'users:write', 'security:write'] : invitePermissions,
      });
      setInviteEmail('');
      setAccountCredential('');
      setAccountCredentialConfirm('');
      setMessage(`Account creation queued for ${email}. Check Actions for the result.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Account creation failed.');
    }
  }

  function toggleInvitePermission(permission: AdminPermission) {
    setInvitePermissions((current) => (
      current.includes(permission)
        ? current.filter((entry) => entry !== permission)
        : [...current, permission]
    ));
  }

  return (
    <section className="grid gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Developer</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Diagnostics, fix actions, security controls, and player activity.</p>
          </div>
          <TerminalSquare className="text-blue-200" size={20} />
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <SecurityTile label="Posture" value={defenseState} tone={defenseState === 'lockdown' ? 'red' : defenseState === 'attention' ? 'yellow' : 'green'} />
            <SecurityTile label="Open errors" value={String(openErrors)} tone={openErrors ? 'yellow' : 'green'} />
            <SecurityTile label="Security events" value={String(data.securityEvents.length)} tone={data.securityEvents.length ? 'yellow' : 'green'} />
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="console">Console</TabsTrigger>
              <TabsTrigger value="errors">Errors</TabsTrigger>
              <TabsTrigger value="fixes">Fixes</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="users">Admin Users</TabsTrigger>
              <TabsTrigger value="logs">Fix Logs</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="console">
              <DeveloperConsole data={data} />
            </TabsContent>

            <TabsContent value="errors">
              <div className="grid gap-3">
                {data.errors.length ? data.errors.map((error) => (
                  <div key={error.id} className="grid gap-3 rounded-lg border border-border bg-black/24 p-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Bug size={16} className="text-red-200" />
                        <p className="font-medium">{errorTitle(error)}</p>
                        <Badge tone={error.severity === 'critical' ? 'red' : 'yellow'}>{error.severity}</Badge>
                        <Badge>{error.status}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
                    </div>
                    <Button variant="subtle" onClick={() => void runFix(error)}>
                      <Hammer size={16} />
                      Fix
                    </Button>
                  </div>
                )) : (
                  <div className="rounded-lg border border-border bg-black/24 p-6 text-sm text-muted-foreground">No open errors.</div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="fixes">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {fixActions.map((action) => (
                  <Button key={action} variant="outline" className="justify-start" onClick={() => void runAction(action)}>
                    <Play size={16} />
                    {actionTitle(action)}
                  </Button>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="security">
              <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                <section className="grid gap-3 rounded-lg border border-border bg-black/24 p-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <ShieldAlert size={18} className="text-red-200" />
                    Defensive Controls
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {securityActions.map((action) => (
                      <Button key={action} variant={action === 'enable_lockdown' ? 'destructive' : 'outline'} className="justify-start" onClick={() => void runAction(action)}>
                        {action === 'enable_lockdown' ? <LockKeyhole size={16} /> : action === 'disable_lockdown' ? <UnlockKeyhole size={16} /> : <Radar size={16} />}
                        {actionTitle(action)}
                      </Button>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <Input value={blockXuid} placeholder="XUID" onChange={(event) => setBlockXuid(event.target.value)} />
                    <Button variant="destructive" onClick={() => void updateBlockedXuid('block_xuid')}>
                      <Ban size={16} />
                      Block
                    </Button>
                    <Button variant="outline" onClick={() => void updateBlockedXuid('unblock_xuid')}>
                      <UnlockKeyhole size={16} />
                      Unblock
                    </Button>
                  </div>
                  <div className="grid gap-2 text-sm text-muted-foreground">
                    <DefenseLine label="Static dashboard hosting" value="No inbound bot admin port" />
                    <DefenseLine label="Supabase access" value="Private login and RLS policies" />
                    <DefenseLine label="Action queue" value="Allowlisted and throttled" />
                    <DefenseLine label="Bot controls" value="No shell execution or file editing" />
                    <DefenseLine label="DDoS posture" value="Lockdown, blocklists, and provider edge protections" />
                  </div>
                </section>
                <section className="min-w-0">
                  <DataTable data={data.securityEvents} columns={securityColumns} empty="No security events recorded." />
                </section>
              </div>
            </TabsContent>

            <TabsContent value="users">
              <div className="grid gap-4 xl:grid-cols-[0.86fr_1.14fr]">
                <section className="liquid-control rounded-lg p-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <UserPlus size={18} className="text-blue-200" />
                    Create Account
                  </div>
                  <div className="mt-3 grid gap-3">
                    {!bridgeReady ? (
                      <div className="rounded-md border border-yellow-300/25 bg-yellow-400/10 px-3 py-2 text-xs text-yellow-100">
                        The bot bridge is not reporting. Start the Node server before creating admin accounts.
                      </div>
                    ) : null}
                    <Input type="email" value={inviteEmail} placeholder="operator@fracturemc.com" onChange={(event) => setInviteEmail(event.target.value)} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input type="password" value={accountCredential} placeholder="Password" onChange={(event) => setAccountCredential(event.target.value)} />
                      <Input type="password" value={accountCredentialConfirm} placeholder="Confirm password" onChange={(event) => setAccountCredentialConfirm(event.target.value)} />
                    </div>
                    <select
                      className="liquid-control h-9 rounded-md px-3 text-sm outline-none focus:border-blue-300/60 focus:ring-2 focus:ring-blue-400/30"
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value as AdminRole)}
                    >
                      <option value="admin">Admin</option>
                      <option value="operator">Operator</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {permissionOptions.map(([permission, label]) => (
                        <label key={permission} className="liquid-control flex min-h-11 items-center gap-2 rounded-md px-3 text-sm">
                          <input
                            type="checkbox"
                            checked={inviteRole === 'owner' || invitePermissions.includes(permission)}
                            disabled={inviteRole === 'owner'}
                            onChange={() => toggleInvitePermission(permission)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <Button onClick={() => void createAccount()} disabled={!canManageUsers || !bridgeReady || !inviteEmail.includes('@') || accountCredential.length < 12 || accountCredential !== accountCredentialConfirm}>
                      <KeyRound size={16} />
                      {bridgeReady ? 'Create account' : 'Bridge offline'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Creates a confirmed login through the running bot bridge. Use the exact email and password here to sign in after the action completes.
                    </p>
                  </div>
                </section>
                <section className="min-w-0">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <UsersRound size={17} className="text-blue-200" />
                    Active accounts
                  </div>
                  <DataTable data={data.adminUsers} columns={adminUserColumns} empty="No admin users recorded." />
                </section>
              </div>
            </TabsContent>

            <TabsContent value="logs">
              <DataTable data={data.fixLogs} columns={fixLogColumns} empty="No fix attempts recorded." />
            </TabsContent>

            <TabsContent value="diagnostics">
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <section className="rounded-lg border border-border bg-black/20 p-3">
                  <h3 className="text-sm font-semibold">Player Activity</h3>
                  <div className="mt-3 min-h-52 min-w-0">
                    {activeTab === 'diagnostics' ? <ActivityChart players={data.players} /> : null}
                  </div>
                </section>
                <section className="min-w-0 rounded-lg border border-border bg-black/20 p-3">
                  <h3 className="mb-3 text-sm font-semibold">Recent Players</h3>
                  <DataTable data={data.players} columns={playerColumns} empty="No player sessions recorded." />
                </section>
              </div>
            </TabsContent>

            <TabsContent value="actions">
              <DataTable data={data.actions} columns={createActionColumns(canManageUsers)} empty="No queued actions." />
            </TabsContent>
          </Tabs>
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 size={16} className="text-emerald-200" />
            {message || 'Every fix attempt is recorded in Fix Logs.'}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function SecurityTile({ label, value, tone }: { label: string; value: string; tone: 'green' | 'yellow' | 'red' }) {
  return (
    <div className="rounded-lg border border-border bg-black/24 p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-lg font-semibold capitalize">{value}</p>
        <Badge tone={tone}>{tone}</Badge>
      </div>
    </div>
  );
}

function DefenseLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-border bg-white/5 px-3 py-2 sm:grid-cols-[160px_1fr]">
      <span className="text-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DeveloperConsole({ data }: { data: DashboardData }) {
  const entries = useMemo(() => [
    ...data.events.map((event) => ({
      id: `event-${event.id}`,
      title: eventTitle(event),
      body: eventBody(event),
      time: event.createdAt,
      tone: eventTone(event.type),
    })),
    ...data.actions.map((action) => ({
      id: `action-${action.id}`,
      title: actionTitle(action.actionType),
      body: actionStatusText(action.actionType, action.status, action.message),
      time: action.createdAt,
      tone: action.status === 'failed' ? 'red' : action.status === 'completed' ? 'green' : 'blue',
    })),
    ...data.fixLogs.map((log) => ({
      id: `fix-${log.id}`,
      title: `Fix log: ${actionTitle(log.actionType)}`,
      body: fixLogText(log),
      time: log.createdAt,
      tone: log.status === 'completed' ? 'green' : 'red',
    })),
  ].sort((left, right) => Date.parse(right.time) - Date.parse(left.time)).slice(0, 60), [data.actions, data.events, data.fixLogs]);

  if (!entries.length) {
    return <div className="rounded-lg border border-border bg-black/24 p-6 text-sm text-muted-foreground">No console activity yet.</div>;
  }

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-black/30 p-3">
      {entries.map((entry) => (
        <div key={entry.id} className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 md:grid-cols-[132px_1fr_auto] md:items-start">
          <Badge tone={entry.tone as 'blue' | 'green' | 'red' | 'yellow' | 'neutral'}>{entry.tone}</Badge>
          <div className="min-w-0">
            <p className="font-medium">{entry.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{entry.body}</p>
          </div>
          <span className="text-xs text-muted-foreground md:text-right">{formatDate(entry.time)}</span>
        </div>
      ))}
    </div>
  );
}

function DataTable<T>({ data, columns, empty }: { data: T[]; columns: unknown[]; empty: string }) {
  const table = useReactTable({
    data,
    columns: columns as ColumnDef<T, unknown>[],
    getCoreRowModel: getCoreRowModel(),
  });

  if (!data.length) {
    return <div className="rounded-lg border border-border bg-black/24 p-6 text-sm text-muted-foreground">{empty}</div>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const actionText: Record<string, { title: string; queued: string; running: string; completed: string; failed: string }> = {
  acknowledge_error: {
    title: 'Acknowledge error',
    queued: 'The bot will mark the selected error as acknowledged.',
    running: 'The bot is updating the error record.',
    completed: 'The selected error was acknowledged.',
    failed: 'The error could not be acknowledged.',
  },
  apply_config: {
    title: 'Apply saved settings',
    queued: 'The bot will validate the saved settings and reload safely.',
    running: 'The bot is applying the latest saved settings.',
    completed: 'The saved settings were applied.',
    failed: 'The saved settings could not be applied.',
  },
  block_xuid: {
    title: 'Block player XUID',
    queued: 'The bot will add this XUID to the blocklist.',
    running: 'The bot is updating the player blocklist.',
    completed: 'The player was blocked and policy was reloaded.',
    failed: 'The player could not be blocked.',
  },
  clear_invite_cooldown: {
    title: 'Clear invite cooldown',
    queued: 'The bot will clear remembered invite cooldowns.',
    running: 'The bot is clearing invite cooldown state.',
    completed: 'Invite cooldown state was cleared.',
    failed: 'Invite cooldown state could not be cleared.',
  },
  clear_stale_actions: {
    title: 'Clear stale commands',
    queued: 'The bridge will close commands that have been stuck too long.',
    running: 'The bridge is checking for stale commands.',
    completed: 'Stale commands were cleared.',
    failed: 'Stale commands could not be cleared.',
  },
  create_admin_account: {
    title: 'Create admin account',
    queued: 'The bridge will create a confirmed admin login.',
    running: 'The bridge is creating the admin login.',
    completed: 'The admin login was created.',
    failed: 'The admin login could not be created.',
  },
  disable_lockdown: {
    title: 'Disable lockdown',
    queued: 'The bot will return to the configured friend policy.',
    running: 'The bot is disabling lockdown mode.',
    completed: 'Lockdown mode was disabled.',
    failed: 'Lockdown mode could not be disabled.',
  },
  enable_lockdown: {
    title: 'Enable lockdown',
    queued: 'The bot will allow only explicitly allowed players.',
    running: 'The bot is enabling lockdown mode.',
    completed: 'Lockdown mode was enabled.',
    failed: 'Lockdown mode could not be enabled.',
  },
  invite_admin_user: {
    title: 'Send admin invite',
    queued: 'The bridge will create an admin invitation.',
    running: 'The bridge is preparing the admin invitation.',
    completed: 'The admin invitation is ready.',
    failed: 'The admin invitation could not be sent.',
  },
  keepalive_ping: {
    title: 'Check session health',
    queued: 'The bot will check that the Bedrock session is still alive.',
    running: 'The bot is checking the Bedrock session.',
    completed: 'The Bedrock session health check completed.',
    failed: 'The Bedrock session health check failed.',
  },
  reconnect_portal: {
    title: 'Reconnect portal',
    queued: 'The bot will restart the Bedrock portal session.',
    running: 'The bot is reconnecting the portal session.',
    completed: 'The portal session was reconnected.',
    failed: 'The portal session could not reconnect.',
  },
  reload_config: {
    title: 'Reload config',
    queued: 'The bot will refresh its runtime configuration snapshot.',
    running: 'The bot is refreshing its configuration snapshot.',
    completed: 'The runtime configuration snapshot was refreshed.',
    failed: 'The runtime configuration snapshot could not refresh.',
  },
  republish_session: {
    title: 'Republish session',
    queued: 'The bot will refresh the Friends-tab session card.',
    running: 'The bot is refreshing the session card.',
    completed: 'The Friends-tab session card was refreshed.',
    failed: 'The session card could not be refreshed.',
  },
  retry_failed_invites: {
    title: 'Retry failed invites',
    queued: 'The bot will retry known failed player invites.',
    running: 'The bot is retrying failed invites.',
    completed: 'Known failed invites were checked.',
    failed: 'Failed invites could not be retried.',
  },
  run_diagnostics: {
    title: 'Run diagnostics',
    queued: 'The bot will collect a safe runtime health snapshot.',
    running: 'The bot is collecting diagnostics.',
    completed: 'Diagnostics completed.',
    failed: 'Diagnostics failed.',
  },
  run_security_diagnostics: {
    title: 'Run security diagnostics',
    queued: 'The bot will check defensive posture and exposed controls.',
    running: 'The bot is checking defensive posture.',
    completed: 'Security diagnostics completed.',
    failed: 'Security diagnostics failed.',
  },
  unblock_xuid: {
    title: 'Unblock player XUID',
    queued: 'The bot will remove this XUID from the blocklist.',
    running: 'The bot is updating the player blocklist.',
    completed: 'The player was unblocked and policy was reloaded.',
    failed: 'The player could not be unblocked.',
  },
};

function actionTitle(actionType: string): string {
  return actionText[actionType]?.title ?? humanizeName(actionType);
}

function actionStatusText(actionType: string, status: BotAction['status'], message: string | null): string {
  const fallback = actionText[actionType]?.[status] ?? `${actionTitle(actionType)} is ${status}.`;
  return message ? `${fallback} ${message}` : fallback;
}

function fixLogText(log: FixLog): string {
  return actionStatusText(log.actionType, log.status === 'completed' ? 'completed' : 'failed', log.message);
}

function errorTitle(error: BotError): string {
  const titles: Record<string, string> = {
    auth_expired: 'Xbox login expired',
    config_invalid: 'Saved configuration is invalid',
    cooldown_stuck: 'Invite cooldown needs reset',
    invite_failed: 'Player invite failed',
    rta_disconnected: 'Xbox realtime connection dropped',
    [staleSessionErrorCode]: 'Xbox session refresh failed',
    session_stale: 'Bedrock session is stale',
  };

  return titles[error.code] ?? humanizeName(error.code);
}

function eventTitle(event: BotEvent): string {
  const titles: Record<string, string> = {
    friend_added: 'Friend added',
    friend_removed: 'Friend removed',
    friend_rejected: 'Friend policy blocked a player',
    invite_failed: 'Invite failed',
    invite_sent: 'Invite sent',
    player_join: 'Player joined through the portal',
    player_leave: 'Player left the portal',
    session_created: 'Bedrock session published',
    session_error: 'Session needs attention',
    session_keepalive: 'Session health check',
    session_recovery_completed: 'Session recovery completed',
    session_recovery_started: 'Session recovery started',
    session_updated: 'Bedrock session updated',
    startup: 'Bot started',
    shutdown: 'Bot stopped',
  };

  return titles[event.type] ?? humanizeName(event.type);
}

function eventBody(event: BotEvent): string {
  const player = event.gamertag ? ` Player: ${event.gamertag}.` : '';
  return `${event.message}${player}`;
}

function eventTone(type: string): 'blue' | 'green' | 'red' | 'yellow' | 'neutral' {
  if (type.includes('failed') || type.includes('error')) {
    return 'red';
  }
  if (type.includes('recovery_started') || type.includes('rejected')) {
    return 'yellow';
  }
  if (type.includes('sent') || type.includes('join') || type.includes('completed') || type.includes('keepalive')) {
    return 'green';
  }
  if (type.includes('startup') || type.includes('created') || type.includes('updated')) {
    return 'blue';
  }
  return 'neutral';
}

function humanizeName(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const adminHelper = createColumnHelper<AdminUser>();
const adminUserColumns = [
  adminHelper.accessor('email', { header: 'Email' }),
  adminHelper.accessor('role', { header: 'Role', cell: (info) => <Badge tone={info.getValue() === 'owner' ? 'blue' : 'neutral'}>{info.getValue()}</Badge> }),
  adminHelper.accessor('permissions', { header: 'Permissions', cell: (info) => info.getValue().join(', ') || 'read only' }),
  adminHelper.accessor('passwordSetAt', { header: 'Password', cell: (info) => <Badge tone={info.getValue() ? 'green' : 'yellow'}>{info.getValue() ? 'set' : 'pending'}</Badge> }),
  adminHelper.accessor('lastSeenAt', { header: 'Last seen', cell: (info) => formatDate(info.getValue()) }),
];

const securityHelper = createColumnHelper<SecurityEvent>();
const securityColumns = [
  securityHelper.accessor('severity', { header: 'Severity', cell: (info) => <Badge tone={info.getValue() === 'critical' ? 'red' : info.getValue() === 'warning' ? 'yellow' : 'blue'}>{info.getValue()}</Badge> }),
  securityHelper.accessor('category', { header: 'Category' }),
  securityHelper.accessor('message', { header: 'Message' }),
  securityHelper.accessor('source', { header: 'Source' }),
  securityHelper.accessor('createdAt', { header: 'Time', cell: (info) => formatDate(info.getValue()) }),
];

const fixHelper = createColumnHelper<FixLog>();
const fixLogColumns = [
  fixHelper.accessor('actionType', { header: 'Command', cell: (info) => actionTitle(info.getValue()) }),
  fixHelper.accessor('status', { header: 'Status', cell: (info) => <Badge tone={info.getValue() === 'completed' ? 'green' : 'red'}>{info.getValue()}</Badge> }),
  fixHelper.accessor('message', { header: 'What happened', cell: (info) => actionStatusText(info.row.original.actionType, info.row.original.status === 'completed' ? 'completed' : 'failed', info.getValue()) }),
  fixHelper.accessor('createdAt', { header: 'Time', cell: (info) => formatDate(info.getValue()) }),
];

const actionHelper = createColumnHelper<BotAction>();
function createActionColumns(showInviteLinks: boolean) {
  return [
  actionHelper.accessor('actionType', { header: 'Command', cell: (info) => actionTitle(info.getValue()) }),
  actionHelper.accessor('status', { header: 'Status', cell: (info) => <Badge tone={info.getValue() === 'completed' ? 'green' : info.getValue() === 'failed' ? 'red' : 'blue'}>{info.getValue()}</Badge> }),
  actionHelper.accessor('message', {
    header: 'What happened',
    cell: (info) => {
      const action = info.row.original;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span>{actionStatusText(action.actionType, action.status, info.getValue())}</span>
          {showInviteLinks && action.manualInviteLink ? (
            <Button type="button" variant="subtle" onClick={() => void navigator.clipboard.writeText(action.manualInviteLink ?? '')}>
              <MailPlus size={14} />
              Copy invite link
            </Button>
          ) : null}
        </div>
      );
    },
  }),
  actionHelper.accessor('createdAt', { header: 'Time', cell: (info) => formatDate(info.getValue()) }),
  ];
}

const playerHelper = createColumnHelper<PlayerSession>();
const playerColumns = [
  playerHelper.accessor('gamertag', { header: 'Gamertag' }),
  playerHelper.accessor('xuid', { header: 'XUID' }),
  playerHelper.accessor('joinedAt', { header: 'Joined', cell: (info) => formatDate(info.getValue()) }),
];
