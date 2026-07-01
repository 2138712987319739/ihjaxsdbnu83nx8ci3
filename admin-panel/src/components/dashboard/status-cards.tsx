import { Activity, Clock, LogIn, Users } from 'lucide-react';
import type { DashboardData } from '@/types/admin';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate, formatNumber } from '@/lib/utils';

export function StatusCards({ data }: { data: DashboardData }) {
  const items = [
    {
      label: 'Current players',
      value: formatNumber(data.status.currentPlayers),
      hint: data.status.online ? 'Portal session active' : 'Awaiting fresh bot heartbeat',
      icon: Users,
      accent: 'text-blue-200',
      wash: 'from-blue-500/22 to-blue-500/4',
    },
    {
      label: 'Joined through bot',
      value: formatNumber(data.status.totalJoins),
      hint: 'Recorded by bridge',
      icon: LogIn,
      accent: 'text-red-200',
      wash: 'from-red-500/22 to-red-500/4',
    },
    {
      label: 'Target',
      value: `${data.status.targetHost}:${data.status.targetPort}`,
      hint: data.status.joinability,
      icon: Activity,
      accent: 'text-blue-200',
      wash: 'from-blue-500/22 to-blue-500/4',
    },
    {
      label: 'Heartbeat',
      value: formatDate(data.status.lastHeartbeat),
      hint: data.status.heartbeatFresh ? 'Bridge reporting' : 'No recent signal',
      icon: Clock,
      accent: 'text-red-200',
      wash: 'from-red-500/22 to-red-500/4',
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.label} className={`signal-line overflow-hidden bg-gradient-to-br ${item.wash}`}>
            <CardContent className="flex items-center gap-3 p-4 pl-5">
              <div className={`liquid-control flex h-11 w-11 items-center justify-center rounded-md ${item.accent}`}>
                <Icon size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase text-muted-foreground">{item.label}</p>
                <p className="truncate text-lg font-semibold">{item.value}</p>
                <p className="truncate text-xs text-muted-foreground">{item.hint}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
