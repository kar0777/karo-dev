import type * as React from 'react';

import { cn } from '@/lib/utils';

export type StatusDotStatus = 'live' | 'idle' | 'sleeping' | 'error' | 'pending' | 'off';

const CORE: Record<StatusDotStatus, string> = {
  live: 'bg-primary',
  idle: 'bg-muted',
  sleeping: 'bg-info',
  error: 'bg-danger',
  pending: 'bg-warning',
  off: 'bg-subtle',
};

const HALO: Record<StatusDotStatus, string> = {
  live: 'bg-primary/30',
  idle: 'bg-muted/25',
  sleeping: 'bg-info/25',
  error: 'bg-danger/30',
  pending: 'bg-warning/30',
  off: 'bg-subtle/25',
};

/** Default announcements — concrete enough to be useful on their own. */
const DEFAULT_LABEL: Record<StatusDotStatus, string> = {
  live: 'Running',
  idle: 'Idle',
  sleeping: 'Sleeping',
  error: 'Failed',
  pending: 'Pending',
  off: 'Stopped',
};

const SIZES = {
  sm: { box: 'size-2', core: 'size-1' },
  md: { box: 'size-2.5', core: 'size-1.5' },
  lg: { box: 'size-3', core: 'size-2' },
} as const;

export interface StatusDotProps extends React.ComponentProps<'span'> {
  status?: StatusDotStatus;
  size?: keyof typeof SIZES;
  /** Overrides the pulsing halo, which is on for `live` by default. */
  pulse?: boolean;
  /** Screen-reader text; pass `null` when adjacent text already says it. */
  label?: string | null;
}

/** A filled dot plus an optional pulsing halo — the smallest "is it alive?" signal. */
export function StatusDot({
  status = 'idle',
  size = 'md',
  pulse,
  label,
  className,
  ...props
}: StatusDotProps) {
  const showHalo = pulse ?? status === 'live';
  const { box, core } = SIZES[size];
  const text = label === null ? null : (label ?? DEFAULT_LABEL[status]);

  return (
    <span
      data-slot="status-dot"
      data-status={status}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        box,
        className,
      )}
      {...props}
    >
      {showHalo ? (
        <span
          aria-hidden="true"
          className={cn('absolute inset-0 rounded-full animate-pulse-dot', HALO[status])}
        />
      ) : null}
      <span aria-hidden="true" className={cn('rounded-full', core, CORE[status])} />
      {text ? <span className="sr-only">{text}</span> : null}
    </span>
  );
}
