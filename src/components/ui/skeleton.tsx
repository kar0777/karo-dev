import type * as React from 'react';

import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('karo-skeleton rounded-md', className)}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends React.ComponentProps<'div'> {
  lines?: number;
  /** Height of each line — match the text it stands in for. */
  lineClassName?: string;
}

/** Paragraph placeholder; the last line is short so it reads as text, not a block. */
export function SkeletonText({
  lines = 3,
  className,
  lineClassName,
  ...props
}: SkeletonTextProps) {
  const count = Math.max(1, lines);
  return (
    <div
      data-slot="skeleton-text"
      aria-hidden="true"
      className={cn('space-y-1.5', className)}
      {...props}
    >
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          key={index}
          className={cn(
            'h-3 rounded-sm',
            index === count - 1 ? 'w-3/5' : 'w-full',
            lineClassName,
          )}
        />
      ))}
    </div>
  );
}

export interface SkeletonCardProps extends React.ComponentProps<'div'> {
  lines?: number;
  /** Reserves the square media/avatar slot in the header. */
  media?: boolean;
}

export function SkeletonCard({
  lines = 2,
  media = true,
  className,
  ...props
}: SkeletonCardProps) {
  return (
    <div
      data-slot="skeleton-card"
      aria-hidden="true"
      className={cn('rounded-lg border border-line bg-surface p-4', className)}
      {...props}
    >
      <div className="flex items-center gap-3">
        {media ? <Skeleton className="size-8 rounded-md" /> : null}
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-2/5 rounded-sm" />
          <Skeleton className="h-2.5 w-1/4 rounded-sm" />
        </div>
      </div>
      <SkeletonText lines={lines} className="mt-4" />
    </div>
  );
}
