// Website or admin panel made by Clovic.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { createActor } from 'xstate';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { Ban, Bug, CheckCircle2, Hammer, LockKeyhole, Play, Radar, ShieldAlert, TerminalSquare, UnlockKeyhole } from 'lucide-react';
import type { BotAction, BotError, BotEvent, DashboardData, FixLog, PlayerSession, SecurityEvent } from '@/types/admin';
import type { BotActionType } from '@/lib/actions';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { queueBotAction } from '@/lib/actions';
import { formatDate } from '@/lib/utils';
import { getDefenseSignal, securityMachine } from '@/store/security-machine';

type DeveloperPanelProps = {
  data: DashboardData;
  configured: boolean;
};

type ConsoleLine = {
  id: string;
  createdAt: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
};

const knownFixes: Record<string, BotActionType> = {
  auth_expired: 'reconnect_portal',
  invite_failed: 'retry_failed_invites',
  rta_disconnected: 'reconnect_portal',
  session_initialization_failed: 'reconnect_portal',
  session_stale: 'republish_session',
  config_invalid: 'reload_config',
  cooldown_stuck: 'clear_invite_cooldown',
};

const fixActions = [
  'keepalive',
  'run_diagnostics',
  'republish_session',
  'reconnect_portal',
  'clear_invite_cooldown',
  'retry_failed_invites',
  'reload_config',
  'clear_stale_actions',
] as const satisfies readonly BotActionType[];

const actionCopy: Record<BotActionType, { label: string; description: string; queued: string }> = {
  acknowledge_error: {
    label: 'Acknowledge error',
    description: 'Marks a selected error as reviewed.',
    queued: 'The bridge will mark the selected error as acknowledged.',
  },
  apply_config: {
    label: 'Apply saved settings',
    description: 'Validates and applies saved runtime settings.',
    queued: 'The bot will validate saved settings and apply any real changes.',
  },
  block_xuid: {
    label: 'Block player XUID',
    description: 'Adds a player XUID to the blocklist.',
    queued: 'The bot will add this XUID to the blocklist and reload policy.',
  },
  clear_invite_cooldown: {
    label: 'Clear invite cooldown',
    description: 'Lets valid players receive a fresh invite.',
    queued: 'The bot will clear saved invite cooldown entries.',
  },
  clear_stale_actions: {
    label: 'Clear stuck commands',
    description: 'Closes commands that were left queued or running too long.',
    queued: 'The bridge will close stale commands so the queue stays readable.',
  },
  disable_lockdown: {
    label: 'Disable lockdown',
    description: 'Returns the bot to the normal friend policy.',
    queued: 'The bot will turn lockdown mode off.',
  },
  enable_lockdown: {
    label: 'Enable lockdown',
    description: 'Allows only approved players through policy checks.',
    queued: 'The bot will turn lockdown mode on.',
  },
  keepalive: {
    label: 'Ping bot session',
    description: 'Refreshes the Xbox session heartbeat and player count.',
    queued: 'The bot will refresh the Xbox session heartbeat.',
  },
  reconnect_portal: {
    label: 'Reconnect portal',
    description: 'Stops the current portal and opens a fresh session.',
    queued: 'The bot will reconnect the portal without changing friend automation.',
  },
  reload_config: {
    label: 'Reload runtime settings',
    description: 'Refreshes the running config snapshot.',
    queued: 'The bot will refresh its runtime config snapshot.',
  },
  republish_session: {
    label: 'Republish session',
    description: 'Refreshes the Minecraft session card.',
    queued: 'The bot will republish the session card and visible player count.',
  },
  retry_failed_invites: {
    label: 'Retry failed invites',
    description: 'Checks the failed-invite retry queue.',
    queued: 'The bot will check pending invite retries.',
  },
  run_diagnostics: {
    label: 'Run diagnostics',
    description: 'Checks status, target server, and keepalive timing.',
    queued: 'The bot will run a health check and report what it sees.',
  },
  run_security_diagnostics: {
    label: 'Run security diagnostics',
    description: 'Checks lockdown, policies, lists, and admin controls.',
    queued: 'The bot will run a security-focused health check.',
  },
  unblock_xuid: {
    label: 'Unblock player XUID',
    description: 'Removes a player XUID from the blocklist.',
    queued: 'The bot will remove this XUID from the blocklist and reload policy.',
  },
};

const securityActions = [
  'run_security_diagnostics',
  'enable_lockdown',
  'disable_lockdown',
] as const satisfies readonly BotActionType[];

export function DeveloperPanel({ data, configured }: DeveloperPanelProps) {
  const [activeTab, setActiveTab] = useState('console');
  const [blockXuid, setBlockXuid] = useState('');
  const [message, setMessage] = useState('');
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const securityActor = useMemo(() => createActor(securityMachine), []);
  const [defenseState, setDefenseState] = useState(String(securityActor.getSnapshot().value));
  const openErrors = data.errors.filter((error) => error.status === 'open').length;

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
    const requestedAction = error.fixAction || knownFixes[error.code];
    if (!requestedAction || !isKnownAction(requestedAction)) {
      setMessage('Please contact Clovic for further support.');
      appendConsole(`No automatic fix exists for ${error.code}. Please contact Clovic for further support.`, 'warning');
      return;
    }
    const action = requestedAction;

    if (!configured) {
      setMessage('Connect Supabase before running fixes.');
      appendConsole('The fix could not be queued because Supabase is not connected.', 'error');
      return;
    }

    appendConsole(`Starting ${actionLabel(action)} for ${error.code}. The error message was: ${error.message}`, 'info');

    try {
      await queueBotAction(action, { errorId: error.id, code: error.code });
      setMessage(`${actionLabel(action)} queued.`);
      appendConsole(`${actionLabel(action)} queued. ${actionCopy[action].queued}`, 'success');
    } catch (queueError) {
      const errorMessage = getErrorMessage(queueError);
      setMessage(errorMessage);
      appendConsole(`${actionLabel(action)} could not be queued. ${errorMessage}`, 'error');
    }
  }

  async function runAction(action: BotActionType, payload: Record<string, unknown> = {}) {
    if (!configured) {
      setMessage('Connect Supabase before queueing actions.');
      appendConsole('The command could not be queued because Supabase is not connected.', 'error');
      return;
    }

    appendConsole(`Starting ${actionLabel(action)}. ${actionCopy[action].description}`, 'info');

    try {
      await queueBotAction(action, payload);
      setMessage(`${actionLabel(action)} queued.`);
      appendConsole(`${actionLabel(action)} queued. ${actionCopy[action].queued}`, 'success');
    } catch (queueError) {
      const errorMessage = getErrorMessage(queueError);
      setMessage(errorMessage);
      appendConsole(`${actionLabel(action)} could not be queued. ${errorMessage}`, 'error');
    }
  }

  async function updateBlockedXuid(action: 'block_xuid' | 'unblock_xuid') {
    const xuid = blockXuid.trim();
    if (!/^\d{1,20}$/.test(xuid)) {
      setMessage('Enter a valid numeric XUID.');
      appendConsole('The XUID command was not sent because the value is not a valid numeric XUID.', 'warning');
      return;
    }

    await runAction(action, { xuid });
    setBlockXuid('');
  }

  function appendConsole(messageText: string, tone: ConsoleLine['tone'] = 'info') {
    setConsoleLines((lines) => [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        tone,
        message: messageText,
      },
      ...lines,
    ].slice(0, 30));
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
              <TabsTrigger value="logs">Fix Logs</TabsTrigger>
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="console">
              <CommandConsole
                lines={consoleLines}
                actions={data.actions}
                fixLogs={data.fixLogs}
                events={data.events}
              />
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
                  <Button key={action} variant="outline" className="h-auto min-h-16 items-start justify-start whitespace-normal py-3 text-left" onClick={() => void runAction(action)}>
                    <Play size={16} />
                    <span className="grid min-w-0 gap-0.5">
                      <span>{actionLabel(action)}</span>
                      <span className="text-xs font-normal text-muted-foreground">{actionCopy[action].description}</span>
                    </span>
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
                        {actionLabel(action)}
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

            <TabsContent value="logs">
              <FixLogTimeline logs={data.fixLogs} />
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
            {message || 'Every command writes plain-English output to Console and Fix Logs.'}
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

type ConsoleEntry = {
  id: string;
  createdAt: string;
  tone: ConsoleLine['tone'];
  source: string;
  message: string;
};

function CommandConsole({
  lines,
  actions,
  fixLogs,
  events,
}: {
  lines: ConsoleLine[];
  actions: BotAction[];
  fixLogs: FixLog[];
  events: BotEvent[];
}) {
  const entries: ConsoleEntry[] = [
    ...lines.map((line) => ({
      id: `local-${line.id}`,
      createdAt: line.createdAt,
      tone: line.tone,
      source: 'Panel',
      message: line.message,
    })),
    ...actions.slice(0, 8).map((action) => ({
      id: `action-${action.id}`,
      createdAt: action.createdAt,
      tone: actionTone(action.status),
      source: 'Command',
      message: action.result?.data?.consoleText || commandStatusMessage(action),
    })),
    ...fixLogs.slice(0, 8).map((log) => ({
      id: `fix-${log.id}`,
      createdAt: log.createdAt,
      tone: fixLogTone(log.status),
      source: 'Fix Log',
      message: log.result?.data?.consoleText || `${actionLabel(log.actionType)}: ${log.message}`,
    })),
    ...events.slice(0, 8).map((event) => ({
      id: `event-${event.id}`,
      createdAt: event.createdAt,
      tone: 'info' as const,
      source: event.gamertag ?? 'Bot',
      message: `${eventLabel(event.type)}: ${event.message}`,
    })),
  ]
    .sort((left, right) => dateValue(right.createdAt) - dateValue(left.createdAt))
    .slice(0, 30);

  if (!entries.length) {
    return <div className="rounded-lg border border-border bg-black/24 p-6 text-sm text-muted-foreground">No console activity yet.</div>;
  }

  return (
    <div className="grid max-h-[520px] gap-2 overflow-y-auto rounded-lg border border-border bg-black/30 p-3 font-mono">
      {entries.map((entry) => (
        <div key={entry.id} className="grid gap-2 rounded-md border border-border bg-white/5 p-3 md:grid-cols-[150px_110px_1fr] md:items-start">
          <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
          <Badge tone={consoleTone(entry.tone)}>{entry.source}</Badge>
          <div className="min-w-0 text-sm leading-6 text-foreground whitespace-pre-wrap">{entry.message}</div>
        </div>
      ))}
    </div>
  );
}

function FixLogTimeline({ logs }: { logs: FixLog[] }) {
  if (!logs.length) {
    return <div className="rounded-lg border border-border bg-black/24 p-6 text-sm text-muted-foreground">No fix attempts recorded.</div>;
  }

  return (
    <div className="grid gap-3">
      {logs.map((log) => (
        <div key={log.id} className="grid gap-2 rounded-lg border border-border bg-black/24 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Hammer size={16} className="text-blue-200" />
            <p className="font-medium">{actionLabel(log.actionType)}</p>
            <Badge tone={log.status === 'completed' ? 'green' : 'red'}>{log.status === 'completed' ? 'Finished' : 'Failed'}</Badge>
            <span className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</span>
          </div>
          <p className="text-sm font-semibold text-foreground">{log.message}</p>
          {log.result?.data?.steps && (
            <ul className="mt-2 grid gap-1.5">
              {log.result.data.steps.map((step, index) => (
                <li key={index} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                  {step}
                </li>
              ))}
            </ul>
          )}
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

const securityHelper = createColumnHelper<SecurityEvent>();
const securityColumns = [
  securityHelper.accessor('severity', { header: 'Severity', cell: (info) => <Badge tone={info.getValue() === 'critical' ? 'red' : info.getValue() === 'warning' ? 'yellow' : 'blue'}>{info.getValue()}</Badge> }),
  securityHelper.accessor('category', { header: 'Category' }),
  securityHelper.accessor('message', { header: 'Message' }),
  securityHelper.accessor('source', { header: 'Source' }),
  securityHelper.accessor('createdAt', { header: 'Time', cell: (info) => formatDate(info.getValue()) }),
];

const actionHelper = createColumnHelper<BotAction>();
const actionColumns = [
  actionHelper.accessor('actionType', { header: 'Action', cell: (info) => actionLabel(info.getValue()) }),
  actionHelper.accessor('status', { header: 'Status', cell: (info) => <Badge tone={info.getValue() === 'completed' ? 'green' : info.getValue() === 'failed' ? 'red' : 'blue'}>{actionStatusLabel(info.getValue())}</Badge> }),
  actionHelper.accessor('message', { header: 'Result', cell: (info) => info.getValue() ?? 'Waiting for the bot bridge.' }),
  actionHelper.accessor('createdAt', { header: 'Time', cell: (info) => formatDate(info.getValue()) }),
];

const playerHelper = createColumnHelper<PlayerSession>();
const playerColumns = [
  playerHelper.accessor('gamertag', { header: 'Gamertag' }),
  playerHelper.accessor('xuid', { header: 'XUID' }),
  playerHelper.accessor('joinedAt', { header: 'Joined', cell: (info) => formatDate(info.getValue()) }),
];

function actionLabel(action: string): string {
  if (isKnownAction(action)) {
    return actionCopy[action].label;
  }

  return action.replaceAll('_', ' ');
}

function isKnownAction(action: string): action is BotActionType {
  return action in actionCopy;
}

function commandStatusMessage(action: BotAction): string {
  const label = actionLabel(action.actionType);

  if (action.message) {
    return `${label}: ${action.message}`;
  }

  if (action.status === 'queued') {
    return `${label} is waiting for the bot bridge.`;
  }

  if (action.status === 'running') {
    return `${label} is running on the bot now.`;
  }

  return `${label} finished without an extra message.`;
}

function actionStatusLabel(status: BotAction['status']): string {
  if (status === 'queued') {
    return 'Waiting';
  }

  if (status === 'running') {
    return 'Running';
  }

  if (status === 'completed') {
    return 'Finished';
  }

  return 'Failed';
}

function actionTone(status: BotAction['status']): ConsoleLine['tone'] {
  if (status === 'failed') {
    return 'error';
  }

  if (status === 'completed') {
    return 'success';
  }

  return 'info';
}

function fixLogTone(status: FixLog['status']): ConsoleLine['tone'] {
  return status === 'completed' ? 'success' : 'error';
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    friend_added: 'Friend added',
    friend_removed: 'Friend removed',
    friend_rejected: 'Friend rejected',
    invite_failed: 'Invite failed',
    invite_sent: 'Invite sent',
    player_join: 'Player joined',
    player_leave: 'Player left',
    session_created: 'Session published',
    session_recovered: 'Session recovered',
    session_updated: 'Session updated',
    setup: 'Setup',
    shutdown: 'Shutdown',
    startup: 'Startup',
  };

  return labels[type] ?? type.replaceAll('_', ' ');
}

function consoleTone(tone: ConsoleLine['tone']): 'blue' | 'red' | 'green' | 'neutral' | 'yellow' {
  if (tone === 'success') {
    return 'green';
  }

  if (tone === 'warning') {
    return 'yellow';
  }

  if (tone === 'error') {
    return 'red';
  }

  return 'blue';
}

function dateValue(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
