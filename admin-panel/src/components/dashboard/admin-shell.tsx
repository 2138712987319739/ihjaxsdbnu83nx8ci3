'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Code2, LockKeyhole, LogOut, Save, ShieldCheck, UserX } from 'lucide-react';
import { QueryProvider } from '@/components/dashboard/query-provider';
import { DeveloperPanel } from '@/components/dashboard/developer-panel';
import { LoginPanel } from '@/components/dashboard/login-panel';
import { MainPanel } from '@/components/dashboard/main-panel';
import { StatusCards } from '@/components/dashboard/status-cards';
import { PortalScene } from '@/components/visual/portal-scene';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardData } from '@/hooks/use-dashboard-data';
import { useSession } from '@/hooks/use-session';
import { hasSupabaseEnv } from '@/lib/env';
import { getSupabaseClient } from '@/lib/supabase';

export function AdminShell() {
  return (
    <QueryProvider>
      <AdminShellContent />
    </QueryProvider>
  );
}

function AdminShellContent() {
  const configured = hasSupabaseEnv();
  const { user, profile, firstAdminAvailable, loading } = useSession();
  const authenticated = configured ? Boolean(user && profile) : true;
  const { data } = useDashboardData(authenticated);
  const [activeSection, setActiveSection] = useState<'main' | 'developer'>('main');
  const brandingImage = /^https:\/\/[^\s"')]+$/i.test(data.config.brandingAssetUrl) ? data.config.brandingAssetUrl : '';
  const shellStyle = useMemo(() => ({
    '--primary': data.config.primaryColor,
    '--ring': data.config.primaryColor,
    '--destructive': data.config.secondaryColor,
    fontFamily: getFontStack(data.config.panelFont),
  }) as CSSProperties, [data.config.panelFont, data.config.primaryColor, data.config.secondaryColor]);

  if (!configured) {
    return <SetupRequired />;
  }

  if (loading) {
    return <AuthLoading />;
  }

  if (user && profile && !profile.passwordSetAt) {
    return <LoginPanel mode="setup-password" userEmail={profile.email || user.email || ''} />;
  }

  if (!authenticated) {
    if (user && !profile && !firstAdminAvailable) {
      return <AccessDenied email={user.email ?? 'unknown'} />;
    }

    return <LoginPanel firstAdminAvailable={firstAdminAvailable} />;
  }

  return (
    <main className="dashboard-shell relative min-h-screen overflow-hidden px-3 py-3 text-foreground sm:px-5 lg:px-7" style={shellStyle}>
      <div className="pointer-events-none fixed inset-0 opacity-90">
        <PortalScene online={data.status.online} />
      </div>

      <div className="relative z-10 mx-auto flex max-w-[1480px] flex-col gap-3">
        <header className="command-header grid gap-3 rounded-lg p-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {brandingImage ? (
                <span
                  aria-hidden="true"
                  className="liquid-control h-10 w-10 rounded-md bg-cover bg-center"
                  style={{ backgroundImage: `url("${brandingImage}")` }}
                />
              ) : null}
              <h1 className="fmc-wordmark text-lg font-bold tracking-normal sm:text-2xl">
                <span className="text-blue-300">Fracture</span> <span className="text-red-300">MC</span> FriendConnect
              </h1>
              <Badge tone={data.status.online ? 'green' : 'red'}>{data.status.online ? 'Online' : 'Offline'}</Badge>
              {profile ? <Badge tone={profile.role === 'owner' ? 'blue' : 'neutral'}>{profile.role}</Badge> : null}
              {!configured ? <Badge tone="yellow">Setup mode</Badge> : null}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {data.status.sessionDisplay} · {data.status.targetHost}:{data.status.targetPort} · {data.status.joinability}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button
              variant={activeSection === 'main' ? 'default' : 'subtle'}
              type="button"
              onClick={() => setActiveSection('main')}
            >
              <Save size={16} />
              Main
            </Button>
            <Button
              variant={activeSection === 'developer' ? 'default' : 'subtle'}
              type="button"
              onClick={() => setActiveSection('developer')}
            >
              <Code2 size={16} />
              Developer
            </Button>
            {user ? (
              <Button type="button" variant="outline" onClick={() => void getSupabaseClient()?.auth.signOut()}>
                <LogOut size={16} />
                Sign out
              </Button>
            ) : null}
          </div>
        </header>

        <StatusCards data={data} />

        <AnimatePresence mode="wait">
          {activeSection === 'main' ? (
            <motion.div
              key="main"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22 }}
            >
              <MainPanel data={data} configured={configured} />
            </motion.div>
          ) : (
            <motion.div
              key="developer"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22 }}
            >
              <DeveloperPanel data={data} configured={configured} profile={profile} />
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="liquid-control flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-xs text-muted-foreground">
          <ShieldCheck size={14} />
          Private dashboard. Actions are queued and validated by the running bot process.
          <span className="hidden sm:inline">·</span>
          <Activity size={14} />
          Live status requires Supabase and the bridge environment variables.
        </footer>
      </div>
    </main>
  );
}

function AccessDenied({ email }: { email: string }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-md border border-red-300/30 bg-red-500/16 text-red-200">
            <UserX size={21} />
          </div>
          <CardTitle>Access Denied</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{email} is signed in, but it is not assigned to this admin panel.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border border-border bg-white/5 px-3 py-2 text-sm text-muted-foreground">
            Ask an owner to create this email from Developer → Admin Users.
          </div>
          <Button className="w-full" variant="outline" onClick={() => void getSupabaseClient()?.auth.signOut()}>
            <LockKeyhole size={16} />
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function SetupRequired() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-md border border-blue-300/30 bg-blue-500/16 text-blue-200">
            <LockKeyhole size={21} />
          </div>
          <CardTitle>Supabase Setup Required</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the public Supabase URL and anon key to the GitHub repository variables, then rerun the Pages workflow.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="rounded-md border border-border bg-white/5 px-3 py-2">
            Required variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
          </div>
          <div className="rounded-md border border-border bg-white/5 px-3 py-2">
            After the database migration is applied, the first signed-in account becomes the owner.
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function AuthLoading() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-md border border-blue-300/30 bg-blue-500/16 text-blue-200">
            <ShieldCheck size={21} />
          </div>
          <CardTitle>Checking Access</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            The panel is verifying the current admin session before loading controls.
          </p>
        </CardHeader>
      </Card>
    </main>
  );
}

function getFontStack(font: string): string {
  if (font === 'Inter') {
    return 'Inter, "Fira Sans", ui-sans-serif, system-ui, sans-serif';
  }

  if (font === 'IBM Plex Sans') {
    return '"IBM Plex Sans", "Fira Sans", ui-sans-serif, system-ui, sans-serif';
  }

  if (font === 'Space Grotesk') {
    return '"Space Grotesk", "Fira Sans", ui-sans-serif, system-ui, sans-serif';
  }

  if (font === 'System') {
    return 'ui-sans-serif, system-ui, sans-serif';
  }

  return '"Fira Sans", ui-sans-serif, system-ui, sans-serif';
}
