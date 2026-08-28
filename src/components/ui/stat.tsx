import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type * as React from 'react';

import { cn, formatNumber } from '@/lib/utils';

import { type IconLike, renderIcon } from './icon-slot';

export type StatTone = 'default' | 'primary' | 'ember';

const VALUE_TONE: Record<StatTone, string> = {
  default: 'text-fg',
  primary: 'text-primary',
  ember: 'text-ember',
};

export interface StatProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Percentage change: `12.4` renders as `↑ 12.4%`. */
  delta?: number;
  /** Replaces the generated delta text (e.g. `+1,204 runs`). */
  deltaLabel?: React.ReactNode;
  /** For spend, latency and error rates, where a rise is the bad outcome. */
  deltaInverted?: boolean;
  caption?: React.ReactNode;
  tone?: StatTone;
  icon?: IconLike;
}

export function Stat({
  label,
  value,
  delta,
  deltaLabel,
  deltaInverted = false,
  caption,
  tone = 'default',
  icon,
  className,
  ...props
}: StatProps) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const rising = hasDelta && delta > 0;
  const flat = hasDelta && delta === 0;
  const good = deltaInverted ? !rising : rising;
  const DeltaIcon = flat ? Minus : rising ? ArrowUp : ArrowDown;

  return (
    <div
      data-slot="stat"
      className={cn('flex flex-col gap-1 bg-surface p-4', className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium tracking-wide text-subtle uppercase">
          {label}
        </span>
        {icon ? (
          <span aria-hidden="true" className="shrink-0 text-subtle">
            {renderIcon(icon, 'size-3.5')}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            'karo-numeric text-xl leading-tight font-semibold tracking-tight',
            VALUE_TONE[tone],
          )}
        >
          {value}
        </span>
        {hasDelta || deltaLabel ? (
          <span
            className={cn(
              'karo-numeric inline-flex items-center gap-0.5 text-[11px] font-medium',
              !hasDelta || flat ? 'text-subtle' : good ? 'text-success' : 'text-danger',
            )}
          >
            {hasDelta ? <DeltaIcon className="size-3" aria-hidden="true" /> : null}
            {deltaLabel ?? `${formatNumber(Math.abs(delta ?? 0), 1)}%`}
          </span>
        ) : null}
      </div>

      {caption ? <span className="text-[11px] text-muted">{caption}</span> : null}
    </div>
  );
}

export interface StatGridProps extends React.ComponentProps<'div'> {
  columns?: 2 | 3 | 4 | 6;
}

/** Hairline-separated tile row: the 1px gaps are the container's background. */
export function StatGrid({ columns = 4, className, ...props }: StatGridProps) {
  return (
    <div
      data-slot="stat-grid"
      className={cn(
        'grid gap-px overflow-hidden rounded-lg border border-line bg-line',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        columns === 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
        columns === 6 && 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
        className,
      )}
      {...props}
    />
  );
}
