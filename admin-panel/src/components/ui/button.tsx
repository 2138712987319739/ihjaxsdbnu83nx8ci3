import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'border border-blue-300/35 bg-blue-500/78 text-primary-foreground shadow-lg shadow-blue-950/35 hover:bg-blue-400',
        destructive: 'border border-red-300/35 bg-red-500/78 text-destructive-foreground shadow-lg shadow-red-950/35 hover:bg-red-400',
        outline: 'liquid-control hover:border-blue-300/45 hover:bg-blue-500/12',
        ghost: 'hover:bg-blue-500/10 hover:text-blue-100',
        subtle: 'border border-blue-300/18 bg-blue-500/10 text-foreground hover:bg-blue-500/16',
      },
      size: {
        default: 'h-9 px-3',
        sm: 'h-8 px-2.5 text-xs',
        icon: 'h-9 w-9 px-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>
  & VariantProps<typeof buttonVariants>
  & { asChild?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
