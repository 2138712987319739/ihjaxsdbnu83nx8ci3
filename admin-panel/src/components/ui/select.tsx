import * as React from 'react';
import { cn } from '@/lib/utils';

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'liquid-control h-9 w-full rounded-md px-3 text-sm text-foreground outline-none transition focus:border-blue-300/60 focus:ring-2 focus:ring-blue-400/30',
        className,
      )}
      {...props}
    />
  );
}
