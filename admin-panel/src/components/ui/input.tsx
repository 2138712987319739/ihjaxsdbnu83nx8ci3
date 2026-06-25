import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'liquid-control h-9 w-full rounded-md px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-blue-300/60 focus:ring-2 focus:ring-blue-400/30',
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
