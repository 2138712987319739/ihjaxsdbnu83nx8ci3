'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { Controller, useForm } from 'react-hook-form';
import { Bot, Braces, Clock3, Image, Paintbrush, Save, ServerCog, ShieldCheck, UsersRound } from 'lucide-react';
import type { BotConfig, DashboardData } from '@/types/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { configSchema, listToText, parseListText } from '@/lib/config-schema';
import { saveBotConfig } from '@/lib/actions';

type MainPanelProps = {
  data: DashboardData;
  configured: boolean;
};

const numericFields = {
  targetPort: { min: 1, max: 65535 },
  inviteCooldownMs: { min: 10000, max: 3600000 },
  worldMaxPlayers: { min: 1, max: 1000 },
  friendCheckIntervalMs: { min: 5000, max: 3600000 },
  friendAddIntervalMs: { min: 1000, max: 600000 },
  friendRemoveIntervalMs: { min: 1000, max: 600000 },
} as const;

export function MainPanel({ data, configured }: MainPanelProps) {
  const [command, setCommand] = useState('');
  const [message, setMessage] = useState('');
  const form = useForm<BotConfig>({
    resolver: zodResolver(configSchema),
    defaultValues: data.config,
    mode: 'onChange',
  });
  const { control, formState, handleSubmit, register, reset, setValue, watch } = form;
  const watched = watch();
  const previewStyle = useMemo(() => ({
    '--preview-primary': watched.primaryColor,
    '--preview-secondary': watched.secondaryColor,
  }) as CSSProperties, [watched.primaryColor, watched.secondaryColor]);

  useEffect(() => {
    reset(data.config);
  }, [data.config, reset]);

  const submitSave = handleSubmit(async (values) => {
    if (!configured) {
      setMessage('Connect Supabase before saving live bot settings.');
      return;
    }

    if (command.trim().toLowerCase() !== 'save') {
      setMessage('Type save in the command box to apply changes.');
      return;
    }

    await saveBotConfig(values);
    setMessage('Save queued. The running bot will validate and apply the change.');
    setCommand('');
    reset(values);
  });

  return (
    <form className="grid gap-4" onSubmit={(event) => void submitSave(event)}>
      <Card className="overflow-hidden">
        <CardHeader className="items-center">
          <div>
            <CardTitle>Control Core</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Full safe runtime configuration for the FriendConnect service.</p>
          </div>
          <Badge tone={formState.isDirty ? 'blue' : 'neutral'}>{formState.isDirty ? 'Unsaved' : 'Synced'}</Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
            <section className="control-preview" style={previewStyle}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Session identity</p>
                  <h2 className="mt-1 text-2xl font-semibold">{watched.displayName}</h2>
                </div>
                <div className="control-core-icon">
                  <Bot size={28} />
                </div>
              </div>
              <p className="mt-4 break-words text-sm text-muted-foreground">{watched.sessionCardText}</p>
              <div className="mt-5 grid gap-2 text-sm">
                <PreviewRow label="Target" value={`${watched.targetHost}:${watched.targetPort}`} />
                <PreviewRow label="Joinability" value={watched.joinability.replace(/([A-Z])/g, ' $1')} />
                <PreviewRow label="Policy" value={watched.lockdownMode ? 'lockdown' : watched.friendPolicy} />
                <PreviewRow label="Max players" value={String(watched.worldMaxPlayers)} />
              </div>
            </section>

            <Tabs defaultValue="identity">
              <TabsList className="flex flex-wrap">
                <TabsTrigger value="identity">Identity</TabsTrigger>
                <TabsTrigger value="runtime">Runtime</TabsTrigger>
                <TabsTrigger value="friends">Friends</TabsTrigger>
                <TabsTrigger value="security">Security</TabsTrigger>
              </TabsList>

              <TabsContent value="identity">
                <div className="control-grid">
                  <PanelBlock title="Brand" icon={<Paintbrush size={18} />}>
                    <Field label="Bot name" error={formState.errors.displayName?.message}>
                      <Input {...register('displayName')} />
                    </Field>
                    <Field label="Session card text" error={formState.errors.sessionCardText?.message}>
                      <Textarea className="min-h-20" {...register('sessionCardText')} />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Blue accent" error={formState.errors.primaryColor?.message}>
                        <Input type="color" {...register('primaryColor')} />
                      </Field>
                      <Field label="Red accent" error={formState.errors.secondaryColor?.message}>
                        <Input type="color" {...register('secondaryColor')} />
                      </Field>
                    </div>
                  </PanelBlock>

                  <PanelBlock title="Panel" icon={<Image size={18} />}>
                    <Field label="Font" error={formState.errors.panelFont?.message}>
                      <Select {...register('panelFont')}>
                        <option value="Geist">Geist</option>
                        <option value="Inter">Inter</option>
                        <option value="System">System</option>
                        <option value="IBM Plex Sans">IBM Plex Sans</option>
                        <option value="Space Grotesk">Space Grotesk</option>
                      </Select>
                    </Field>
                    <Field label="Profile image URL" error={formState.errors.brandingAssetUrl?.message}>
                      <Input placeholder="https://..." {...register('brandingAssetUrl')} />
                    </Field>
                  </PanelBlock>
                </div>
              </TabsContent>

              <TabsContent value="runtime">
                <div className="control-grid">
                  <PanelBlock title="Endpoint" icon={<ServerCog size={18} />}>
                    <div className="grid gap-3 sm:grid-cols-[1fr_130px]">
                      <Field label="Target host" error={formState.errors.targetHost?.message}>
                        <Input {...register('targetHost')} />
                      </Field>
                      <Field label="Port" error={formState.errors.targetPort?.message}>
                        <Input type="number" {...numericFields.targetPort} {...register('targetPort', { valueAsNumber: true })} />
                      </Field>
                    </div>
                    <Field label="Joinability" error={formState.errors.joinability?.message}>
                      <Select {...register('joinability')}>
                        <option value="inviteOnly">Invite only</option>
                        <option value="friendsOnly">Friends only</option>
                        <option value="friendsOfFriends">Friends of friends</option>
                      </Select>
                    </Field>
                    <ToggleRow
                      label="Update Xbox presence"
                      checked={watched.updatePresence}
                      onChange={(checked) => setValue('updatePresence', checked, { shouldDirty: true, shouldValidate: true })}
                    />
                  </PanelBlock>

                  <PanelBlock title="Session" icon={<Braces size={18} />}>
                    <Field label="World version text" error={formState.errors.worldVersion?.message}>
                      <Input {...register('worldVersion')} />
                    </Field>
                    <Field label="Max players" error={formState.errors.worldMaxPlayers?.message}>
                      <Input type="number" {...numericFields.worldMaxPlayers} {...register('worldMaxPlayers', { valueAsNumber: true })} />
                    </Field>
                    <Field label="Invite cooldown ms" error={formState.errors.inviteCooldownMs?.message}>
                      <Input type="number" {...numericFields.inviteCooldownMs} {...register('inviteCooldownMs', { valueAsNumber: true })} />
                    </Field>
                  </PanelBlock>
                </div>
              </TabsContent>

              <TabsContent value="friends">
                <div className="control-grid">
                  <PanelBlock title="Automation" icon={<UsersRound size={18} />}>
                    <ToggleRow
                      label="Instant request accept"
                      checked={watched.autoFriendAcceptEnabled}
                      onChange={(checked) => setValue('autoFriendAcceptEnabled', checked, { shouldDirty: true, shouldValidate: true })}
                    />
                    <ToggleRow
                      label="Add back followers"
                      checked={watched.autoFriendAddEnabled}
                      onChange={(checked) => setValue('autoFriendAddEnabled', checked, { shouldDirty: true, shouldValidate: true })}
                    />
                    <ToggleRow
                      label="Invite after add"
                      checked={watched.autoInviteOnFriendAdded}
                      onChange={(checked) => setValue('autoInviteOnFriendAdded', checked, { shouldDirty: true, shouldValidate: true })}
                    />
                    <Field label="Friend policy" error={formState.errors.friendPolicy?.message}>
                      <Select {...register('friendPolicy')}>
                        <option value="open">Open unless blocked</option>
                        <option value="allowlist">Allowlist only</option>
                        <option value="blocklist">Blocklist guarded</option>
                      </Select>
                    </Field>
                  </PanelBlock>

                  <PanelBlock title="Timing" icon={<Clock3 size={18} />}>
                    <Field label="Add-back delay ms" error={formState.errors.friendCheckIntervalMs?.message}>
                      <Input type="number" {...numericFields.friendCheckIntervalMs} {...register('friendCheckIntervalMs', { valueAsNumber: true })} />
                    </Field>
                    <Field label="Add-back spacing ms" error={formState.errors.friendAddIntervalMs?.message}>
                      <Input type="number" {...numericFields.friendAddIntervalMs} {...register('friendAddIntervalMs', { valueAsNumber: true })} />
                    </Field>
                    <Field label="Remove spacing ms" error={formState.errors.friendRemoveIntervalMs?.message}>
                      <Input type="number" {...numericFields.friendRemoveIntervalMs} {...register('friendRemoveIntervalMs', { valueAsNumber: true })} />
                    </Field>
                  </PanelBlock>
                </div>
              </TabsContent>

              <TabsContent value="security">
                <div className="control-grid">
                  <PanelBlock title="Access Lists" icon={<ShieldCheck size={18} />}>
                    <Controller
                      control={control}
                      name="allowlistXuids"
                      render={({ field }) => (
                        <ListField label="Allowlist XUIDs" value={field.value} error={formState.errors.allowlistXuids?.message} onChange={field.onChange} />
                      )}
                    />
                    <Controller
                      control={control}
                      name="allowlistGamertags"
                      render={({ field }) => (
                        <ListField label="Allowlist gamertags" value={field.value} error={formState.errors.allowlistGamertags?.message} onChange={field.onChange} />
                      )}
                    />
                  </PanelBlock>

                  <PanelBlock title="Defense" icon={<ShieldCheck size={18} />}>
                    <ToggleRow
                      label="Lockdown mode"
                      checked={watched.lockdownMode}
                      onChange={(checked) => setValue('lockdownMode', checked, { shouldDirty: true, shouldValidate: true })}
                    />
                    <Controller
                      control={control}
                      name="blocklistXuids"
                      render={({ field }) => (
                        <ListField label="Blocked XUIDs" value={field.value} error={formState.errors.blocklistXuids?.message} onChange={field.onChange} />
                      )}
                    />
                    <Controller
                      control={control}
                      name="blocklistGamertags"
                      render={({ field }) => (
                        <ListField label="Blocked gamertags" value={field.value} error={formState.errors.blocklistGamertags?.message} onChange={field.onChange} />
                      )}
                    />
                  </PanelBlock>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <motion.div
            className="liquid-control rounded-lg p-3"
            animate={{ borderColor: formState.isDirty ? 'rgba(39,119,255,0.72)' : 'rgba(148,163,184,0.22)' }}
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                value={command}
                placeholder="Type save to apply changes"
                onChange={(event) => setCommand(event.target.value)}
              />
              <Button type="submit" disabled={!formState.isDirty || formState.isSubmitting}>
                <Save size={16} />
                Save
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{message || 'Settings are queued and applied by the bot bridge after validation.'}</p>
          </motion.div>
        </CardContent>
      </Card>
    </form>
  );
}

function PanelBlock({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="liquid-control grid gap-3 rounded-lg p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-blue-200">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
      {children}
      {error ? <span className="text-xs text-red-200">Invalid value</span> : null}
    </label>
  );
}

function ListField({ label, error, value, onChange }: { label: string; error?: string; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <Field label={label} error={error}>
      <Textarea
        className="min-h-28 font-mono text-xs"
        value={listToText(value)}
        onChange={(event) => onChange(parseListText(event.target.value))}
      />
    </Field>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="liquid-control flex min-h-10 items-center justify-between gap-3 rounded-md px-3 text-sm">
      <span>{label}</span>
      <input
        className="h-4 w-4 accent-blue-500"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="liquid-control flex items-center justify-between gap-3 rounded-md px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}
