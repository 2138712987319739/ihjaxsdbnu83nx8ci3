'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PlayerSession } from '@/types/admin';

export function ActivityChart({ players }: { players: PlayerSession[] }) {
  const data = buildChartData(players);

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -20, right: 12, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="playerGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2777ff" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#ff3f5f" stopOpacity={0.12} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="#a9b3c7" fontSize={11} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} stroke="#a9b3c7" fontSize={11} />
          <Tooltip
            contentStyle={{
              background: '#101726',
              border: '1px solid rgba(148,163,184,0.22)',
              borderRadius: 8,
              color: '#f7f9ff',
            }}
          />
          <Area type="monotone" dataKey="joins" stroke="#5aa0ff" fill="url(#playerGradient)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildChartData(players: PlayerSession[]) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return {
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      joins: 0,
    };
  });

  const index = new Map(days.map((day) => [day.key, day]));
  for (const player of players) {
    const key = player.joinedAt.slice(0, 10);
    const day = index.get(key);
    if (day) {
      day.joins += 1;
    }
  }

  return days;
}
