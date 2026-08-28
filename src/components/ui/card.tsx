import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface CardProps extends React.ComponentProps<'div'> {
  /** Adds hover affordance — use only when the whole card is a link or button. */
  interactive?: boolean;
}

export function Card({ className, interactive = false, ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-lg border border-line bg-surface text-fg shadow-sm',
        interactive &&
          'cursor-pointer transition-[border-color,box-shadow,background-color] duration-150 ease-[var(--k-ease)] hover:border-line-strong hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

/** Header bar: title block on the left, `CardToolbar` on the right. */
export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'flex items-start justify-between gap-3 border-b border-line px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-sm leading-tight font-semibold text-fg', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn('mt-1 text-[13px] leading-snug text-muted', className)}
      {...props}
    />
  );
}

export function CardToolbar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-toolbar"
      className={cn('flex shrink-0 items-center gap-1.5', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center justify-between gap-3 border-t border-line px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}
