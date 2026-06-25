'use client';

import { useMemo, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, Code2, LogOut, Save, ShieldCheck } from 'lucide-react';
import { QueryProvider } from '@/components/dashboard/query-provider';
import { DeveloperPanel } from '@/components/dashboard/developer-panel';
import { LoginPanel } from '@/components/dashboard/login-panel';
import { MainPanel } from '@/components/dashboard/main-panel';
import { StatusCards } from '@/components/dashboard/status-cards';
import { PortalScene } from '@/components/visual/portal-scene';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDashboardData } from '@/hooks/use-dashboard-data';
import { useSession } from '@/hooks/use-session';
import { hasSupabaseEnv } from '@/lib/env';
import { getSupabaseClient } from '@/lib/supabase';
import { usePanelStore } from '@/store/panel-store';

export function AdminShell() {
  return (
    <QueryProvider>
      <AdminShellContent />
    </QueryProvider>
  );
}

function AdminShellContent() {
  const configured = hasSupabaseEnv();
  const { user, loading } = useSession();
  const authenticated = configured ? Boolean(user) : true;
  const { data } = useDashboardData(authenticated);
  const { activeSection, setActiveSection } = usePanelStore();
  const brandingImage = /^https:\/\/[^\s"')]+$/i.test(data.config.brandingAssetUrl) ? data.config.brandingAssetUrl : '';
  const shellStyle = useMemo(() => ({
    '--primary': data.config.primaryColor,
    '--ring': data.config.primaryColor,
    '--destructive': data.config.secondaryColor,
    fontFamily: getFontStack(data.config.panelFont),
  }) as CSSProperties, [data.config.panelFont, data.config.primaryColor, data.config.secondaryColor]);

  if (!loading && !authenticated) {
    return <LoginPanel />;
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-4 text-foreground sm:px-6 lg:px-8" style={shellStyle}>
      <div className="pointer-events-none absolute inset-0 opacity-75">
        <PortalScene online={data.status.online} />
      </div>

      <div className="relative z-10 mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-col gap-3 rounded-lg border border-border bg-black/30 p-4 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {brandingImage ? (
                <span
                  aria-hidden="true"
                  className="h-9 w-9 rounded-md border border-border bg-cover bg-center"
                  style={{ backgroundImage: `url("${brandingImage}")` }}
                />
              ) : null}
              <h1 className="text-xl font-semibold sm:text-2xl">
                <span className="text-blue-300">Fracture</span> <span className="text-red-300">MC</span> FriendConnect
              </h1>
              <Badge tone={data.status.online ? 'green' : 'red'}>{data.status.online ? 'Online' : 'Offline'}</Badge>
              {!configured ? <Badge tone="yellow">Setup mode</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.status.targetHost}:{data.status.targetPort} · {data.status.sessionDisplay}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={activeSection === 'main' ? 'default' : 'subtle'}
              onClick={() => setActiveSection('main')}
            >
              <Save size={16} />
              Main
            </Button>
            <Button
              variant={activeSection === 'developer' ? 'default' : 'subtle'}
              onClick={() => setActiveSection('developer')}
            >
              <Code2 size={16} />
              Developer
            </Button>
            {user ? (
              <Button variant="outline" onClick={() => void getSupabaseClient()?.auth.signOut()}>
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
              <DeveloperPanel data={data} configured={configured} />
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-black/24 px-4 py-3 text-xs text-muted-foreground">
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

function getFontStack(font: string): string {
  if (font === 'Inter') {
    return 'Inter, Geist, ui-sans-serif, system-ui, sans-serif';
  }

  if (font === 'IBM Plex Sans') {
    return '"IBM Plex Sans", Geist, ui-sans-serif, system-ui, sans-serif';
  }

  if (font === 'Space Grotesk') {
    return '"Space Grotesk", Geist, ui-sans-serif, system-ui, sans-serif';
  }

  if (font === 'System') {
    return 'ui-sans-serif, system-ui, sans-serif';
  }

  return 'Geist, Inter, ui-sans-serif, system-ui, sans-serif';
}
