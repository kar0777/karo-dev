import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  [
    'inline-flex w-fit shrink-0 items-center gap-1 rounded-md border font-medium whitespace-nowrap',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  ].join(' '),
  {
    variants: {
      variant: {
        neutral: 'border-line bg-surface-2 text-muted',
        primary: 'border-transparent bg-primary-soft text-primary-soft-fg',
        ember: 'border-transparent bg-ember-soft text-ember-soft-fg',
        success: 'border-transparent bg-success-soft text-success-soft-fg',
        warning: 'border-transparent bg-warning-soft text-warning-soft-fg',
        danger: 'border-transparent bg-danger-soft text-danger-soft-fg',
        info: 'border-transparent bg-info-soft text-info-soft-fg',
        outline: 'border-line-strong bg-transparent text-muted',
      },
      size: {
        sm: 'h-5 px-1.5 text-[10px]',
        md: 'h-6 px-2 text-[11px]',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

export function Badge({ className, variant, size, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : 'span';
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}
