import { Activity, Clock, LogIn, Users } from 'lucide-react';
import type { DashboardData } from '@/types/admin';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate, formatNumber } from '@/lib/utils';

export function StatusCards({ data }: { data: DashboardData }) {
  const items = [
    {
      label: 'Current players',
      value: formatNumber(data.status.currentPlayers),
      icon: Users,
      accent: 'text-blue-200',
    },
    {
      label: 'Joined through bot',
      value: formatNumber(data.status.totalJoins),
      icon: LogIn,
      accent: 'text-red-200',
    },
    {
      label: 'Target',
      value: `${data.status.targetHost}:${data.status.targetPort}`,
      icon: Activity,
      accent: 'text-blue-200',
    },
    {
      label: 'Heartbeat',
      value: formatDate(data.status.lastHeartbeat),
      icon: Clock,
      accent: 'text-red-200',
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-md bg-white/8 ${item.accent}`}>
                <Icon size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase text-muted-foreground">{item.label}</p>
                <p className="truncate text-lg font-semibold">{item.value}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
