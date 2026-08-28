import type * as React from 'react';

import { cn } from '@/lib/utils';

const SIZES = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
} as const;

export interface SpinnerProps extends Omit<React.ComponentProps<'svg'>, 'size'> {
  size?: keyof typeof SIZES;
  /** Screen-reader text. Set to `null` when a sibling already announces the wait. */
  label?: string | null;
}

/**
 * Indeterminate progress. Inherits `currentColor`, so it works on any surface
 * and inside any button variant without extra styling.
 */
export function Spinner({ size = 'sm', label = 'Loading', className, ...props }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden={label === null ? true : undefined}
      role={label === null ? undefined : 'status'}
      aria-label={label === null ? undefined : label}
      className={cn('animate-spin shrink-0', SIZES[size], className)}
      {...props}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="2"
      />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
