// Website or admin panel made by Clovic.
import * as React from 'react';
import { cn } from '@/lib/utils';

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'blue' | 'red' | 'green' | 'neutral' | 'yellow';
};

const tones = {
  blue: 'border-blue-400/40 bg-blue-500/14 text-blue-100',
  red: 'border-red-400/40 bg-red-500/14 text-red-100',
  green: 'border-emerald-400/40 bg-emerald-500/14 text-emerald-100',
  neutral: 'border-slate-400/30 bg-slate-500/12 text-slate-100',
  yellow: 'border-amber-400/40 bg-amber-500/14 text-amber-100',
};

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium', tones[tone], className)}
      {...props}
    />
  );
}
