import type * as React from 'react';

import { clamp, cn, formatPercent } from '@/lib/utils';

export type MeterTone = 'primary' | 'ember' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<MeterTone, string> = {
  primary: 'bg-primary',
  ember: 'bg-ember',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export interface MeterProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  value: number;
  max?: number;
  label?: React.ReactNode;
  /** Right-hand caption, e.g. `12.4M / 40M weighted tokens`. */
  caption?: React.ReactNode;
  /** Pinning a tone disables the automatic warning/danger escalation. */
  tone?: MeterTone;
  /** Appends the used percentage to the caption row. */
  showPercent?: boolean;
}

/**
 * Quota bar. Above 80% used it turns warning, above 95% danger — a quota that
 * is about to bite should look like it before the request fails.
 */
export function Meter({
  value,
  max = 100,
  label,
  caption,
  tone,
  showPercent = false,
  className,
  'aria-label': ariaLabel,
  ...props
}: MeterProps) {
  const safeMax = max > 0 ? max : 100;
  const ratio = clamp(value / safeMax, 0, 1);
  const percent = ratio * 100;
  const resolvedTone: MeterTone =
    tone ?? (percent > 95 ? 'danger' : percent > 80 ? 'warning' : 'primary');
  const accessibleName =
    ariaLabel ?? (typeof label === 'string' ? label : undefined) ?? 'Usage';

  return (
    <div data-slot="meter" className={cn('w-full', className)} {...props}>
      {label || caption || showPercent ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="truncate text-[12px] font-medium text-fg">{label}</span>
          <span className="karo-numeric shrink-0 text-[11px] text-muted">
            {caption}
            {showPercent ? (
              <span className={cn(caption && 'ml-1.5 text-subtle')}>
                {formatPercent(ratio, percent > 0 && percent < 1 ? 1 : 0)}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
      <div
        role="meter"
        aria-label={accessibleName}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(safeMax)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width,background-color] duration-300 ease-[var(--k-ease)]',
            TONES[resolvedTone],
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
