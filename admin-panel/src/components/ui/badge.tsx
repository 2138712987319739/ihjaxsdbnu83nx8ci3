import * as React from 'react';
import { cn } from '@/lib/utils';

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'blue' | 'red' | 'green' | 'neutral' | 'yellow';
};

const tones = {
  blue: 'border-blue-300/42 bg-blue-500/22 text-blue-50 shadow-[0_0_18px_rgba(31,122,255,0.18)]',
  red: 'border-red-300/42 bg-red-500/22 text-red-50 shadow-[0_0_18px_rgba(255,49,93,0.18)]',
  green: 'border-emerald-400/40 bg-emerald-500/14 text-emerald-100',
  neutral: 'border-blue-200/22 bg-blue-500/8 text-blue-100',
  yellow: 'border-amber-400/40 bg-amber-500/14 text-amber-100',
};

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex h-6 items-center rounded-full border px-2 text-xs font-semibold', tones[tone], className)}
      {...props}
    />
  );
}
