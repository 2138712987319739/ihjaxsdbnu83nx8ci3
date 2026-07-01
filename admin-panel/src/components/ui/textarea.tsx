import * as React from 'react';
import { cn } from '@/lib/utils';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'liquid-control min-h-24 w-full resize-y rounded-md px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-blue-300/60 focus:ring-2 focus:ring-blue-400/30',
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = 'Textarea';
