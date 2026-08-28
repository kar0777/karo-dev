import type * as React from 'react';

import { Meter, type MeterTone } from '@/components/ui/meter';
import { type IconLike, renderIcon } from '@/components/ui/icon-slot';
import { cn } from '@/lib/utils';

/**
 * A dashboard tile: one number, one meter, one sentence.
 *
 * `Stat` from the primitive set renders its caption inside a `<span>`, which
 * cannot legally contain the meter's `<div>`. This is the same visual tile with
 * room for the bar underneath — the metric and its limit belong together.
 */
export interface QuotaStatProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  icon?: IconLike;
  tone?: 'default' | 'primary' | 'ember';
  meter?: { value: number; max: number; tone?: MeterTone; caption?: React.ReactNode };
}

const VALUE_TONE = {
  default: 'text-fg',
  primary: 'text-primary',
  ember: 'text-ember',
} as const;

export function QuotaStat({
  label,
  value,
  caption,
  icon,
  tone = 'default',
  meter,
  className,
  ...props
}: QuotaStatProps) {
  return (
    <div className={cn('flex flex-col gap-1.5 bg-surface p-4', className)} {...props}>
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

      <span
        className={cn(
          'karo-numeric text-xl leading-tight font-semibold tracking-tight',
          VALUE_TONE[tone],
        )}
      >
        {value}
      </span>

      {meter ? (
        <Meter
          value={meter.value}
          max={meter.max}
          tone={meter.tone}
          aria-label={label}
          caption={meter.caption}
          className="mt-0.5"
        />
      ) : null}

      {caption ? (
        <p className="mt-auto pt-0.5 text-[11px] leading-snug text-muted">{caption}</p>
      ) : null}
    </div>
  );
}
