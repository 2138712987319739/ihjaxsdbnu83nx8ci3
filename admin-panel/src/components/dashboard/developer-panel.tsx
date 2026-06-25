'use client';

import { useEffect, useMemo, useState } from 'react';
import { createActor } from 'xstate';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { Ban, Bug, CheckCircle2, Hammer, LockKeyhole, MailPlus, Play, Radar, ShieldAlert, TerminalSquare, UnlockKeyhole, UsersRound } from 'lucide-react';
import type { AdminPermission, AdminRole, AdminUser, BotAction, BotError, BotEvent, DashboardData, FixLog, PlayerSession, SecurityEvent } from '@/types/admin';
import type { BotActionType } from '@/lib/actions';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inviteAdminUser, queueBotAction } from '@/lib/actions';
import { formatDate } from '@/lib/utils';
import { getDefenseSignal, securityMachine } from '@/store/security-machine';

type DeveloperPanelProps = {
  data: DashboardData;
  configured: boolean;
  profile: AdminUser | null;
};

const knownFixes: Record<string, BotActionType> = {
  auth_expired: 'reconnect_portal',
  invite_failed: 'retry_failed_invites',
  rta_disconnected: 'reconnect_portal',
  session_stale: 'republish_session',
  config_invalid: 'reload_config',
  cooldown_stuck: 'clear_invite_cooldown',
};

const fixActions = [
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
  const [message, setMessage] = useState('');
  const securityActor = useMemo(() => createActor(securityMachine), []);
  const [defenseState, setDefenseState] = useState(String(securityActor.getSnapshot().value));
  const openErrors = data.errors.filter((error) => error.status === 'open').length;
  const canManageUsers = Boolean(profile?.role === 'owner' || profile?.permissions.includes('users:write'));

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
    setMessage(`Queued ${action}.`);
  }

  async function runAction(action: BotActionType, payload: Record<string, unknown> = {}) {
    if (!configured) {
      setMessage('Connect Supabase before queueing actions.');
      return;
    }

    await queueBotAction(action, payload);
    setMessage(`Queued ${action}.`);
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

  async function sendAdminInvite() {
    if (!configured) {
      setMessage('Connect Supabase before inviting admins.');
      return;
    }

    if (!canManageUsers) {
      setMessage('Your account does not have Admin users permission.');
      return;
    }

    try {
      await inviteAdminUser({
        email: inviteEmail,
        role: inviteRole,
        permissions: inviteRole === 'owner' ? ['config:write', 'actions:write', 'users:write', 'security:write'] : invitePermissions,
        redirectTo: window.location.origin + window.location.pathname,
      });
      setInviteEmail('');
      setMessage(`Invite queued for ${inviteEmail.trim().toLowerCase()}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invite failed.');
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
              <DataTable data={data.events} columns={eventColumns} empty="No console events yet." />
            </TabsContent>

            <TabsContent value="errors">
              <div className="grid gap-3">
                {data.errors.length ? data.errors.map((error) => (
                  <div key={error.id} className="grid gap-3 rounded-lg border border-border bg-black/24 p-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Bug size={16} className="text-red-200" />
                        <p className="font-medium">{error.code}</p>
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
                    {action.replaceAll('_', ' ')}
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
                        {action.replaceAll('_', ' ')}
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
                <section className="rounded-lg border border-border bg-black/24 p-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <MailPlus size={18} className="text-blue-200" />
                    Invite Admin
                  </div>
                  <div className="mt-3 grid gap-3">
                    <Input type="email" value={inviteEmail} placeholder="operator@fracturemc.com" onChange={(event) => setInviteEmail(event.target.value)} />
                    <select
                      className="h-9 rounded-md border border-input bg-black/20 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                      value={inviteRole}
                      onChange={(event) => setInviteRole(event.target.value as AdminRole)}
                    >
                      <option value="admin">Admin</option>
                      <option value="operator">Operator</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {permissionOptions.map(([permission, label]) => (
                        <label key={permission} className="flex min-h-11 items-center gap-2 rounded-md border border-border bg-white/5 px-3 text-sm">
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
                    <Button onClick={() => void sendAdminInvite()} disabled={!canManageUsers || !inviteEmail.includes('@')}>
                      <MailPlus size={16} />
                      Queue invite
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Invites are sent by the running bot bridge so the service-role key never reaches the browser.
                    </p>
                  </div>
                </section>
                <section className="min-w-0">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <UsersRound size={17} className="text-blue-200" />
                    Active and invited accounts
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
              <DataTable data={data.actions} columns={actionColumns} empty="No queued actions." />
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

const eventHelper = createColumnHelper<BotEvent>();
const adminHelper = createColumnHelper<AdminUser>();
const adminUserColumns = [
  adminHelper.accessor('email', { header: 'Email' }),
  adminHelper.accessor('role', { header: 'Role', cell: (info) => <Badge tone={info.getValue() === 'owner' ? 'blue' : 'neutral'}>{info.getValue()}</Badge> }),
  adminHelper.accessor('permissions', { header: 'Permissions', cell: (info) => info.getValue().join(', ') || 'read only' }),
  adminHelper.accessor('passwordSetAt', { header: 'Password', cell: (info) => <Badge tone={info.getValue() ? 'green' : 'yellow'}>{info.getValue() ? 'set' : 'pending'}</Badge> }),
  adminHelper.accessor('lastSeenAt', { header: 'Last seen', cell: (info) => formatDate(info.getValue()) }),
];

const eventColumns = [
  eventHelper.accessor('type', { header: 'Type' }),
  eventHelper.accessor('message', { header: 'Message' }),
  eventHelper.accessor('gamertag', { header: 'Player', cell: (info) => info.getValue() ?? 'System' }),
  eventHelper.accessor('createdAt', { header: 'Time', cell: (info) => formatDate(info.getValue()) }),
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
  fixHelper.accessor('actionType', { header: 'Action' }),
  fixHelper.accessor('status', { header: 'Status', cell: (info) => <Badge tone={info.getValue() === 'completed' ? 'green' : 'red'}>{info.getValue()}</Badge> }),
  fixHelper.accessor('message', { header: 'Message' }),
  fixHelper.accessor('createdAt', { header: 'Time', cell: (info) => formatDate(info.getValue()) }),
];

const actionHelper = createColumnHelper<BotAction>();
const actionColumns = [
  actionHelper.accessor('actionType', { header: 'Action' }),
  actionHelper.accessor('status', { header: 'Status', cell: (info) => <Badge tone={info.getValue() === 'completed' ? 'green' : info.getValue() === 'failed' ? 'red' : 'blue'}>{info.getValue()}</Badge> }),
  actionHelper.accessor('message', { header: 'Result', cell: (info) => info.getValue() ?? 'Pending' }),
  actionHelper.accessor('createdAt', { header: 'Time', cell: (info) => formatDate(info.getValue()) }),
];

const playerHelper = createColumnHelper<PlayerSession>();
const playerColumns = [
  playerHelper.accessor('gamertag', { header: 'Gamertag' }),
  playerHelper.accessor('xuid', { header: 'XUID' }),
  playerHelper.accessor('joinedAt', { header: 'Joined', cell: (info) => formatDate(info.getValue()) }),
];
