'use client';

import type * as React from 'react';
import type { TooltipContentProps } from 'recharts';

import { cn } from '@/lib/utils';

/**
 * The shared chart chrome: one palette, one tooltip, one axis style.
 *
 * Colours are referenced as CSS variables rather than resolved values so a
 * theme switch repaints the charts without a re-render — `--color-chart-*` is
 * already defined for both themes in `globals.css`.
 */

export const CHART_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0];
}

/** Tokens = jade (throughput), money = ember, compute = blue. */
export const SERIES_COLORS = {
  tokens: 'var(--color-chart-1)',
  compute: 'var(--color-chart-3)',
  modelSpend: 'var(--color-chart-2)',
  computeSpend: 'var(--color-chart-3)',
  remaining: 'var(--color-chart-1)',
  reference: 'var(--color-subtle)',
} as const;

export const AXIS_PROPS = {
  stroke: 'var(--color-subtle)',
  tickLine: false,
  axisLine: false,
  tick: { fill: 'var(--color-subtle)', fontSize: 11 },
} as const;

export const GRID_PROPS = {
  stroke: 'var(--color-line)',
  strokeDasharray: '2 4',
  vertical: false,
} as const;

export const CURSOR_FILL = 'var(--color-surface-2)';

/* ------------------------------------------------------------------ *
 *  Tooltip
 * ------------------------------------------------------------------ */

export type TooltipRow = { label: string; value: string; color?: string };

export type TooltipPayload = TooltipContentProps['payload'];

export type TooltipRenderer = (props: TooltipContentProps) => React.ReactNode;

/**
 * Builds a recharts `content` renderer. Passing a function rather than an
 * element keeps the props fully typed — recharts clones elements and injects
 * props, which defeats prop checking.
 */
export function makeTooltip(options: {
  title: (label: unknown) => string;
  rows: (payload: TooltipPayload) => TooltipRow[];
  footer?: (payload: TooltipPayload) => string | null;
}): TooltipRenderer {
  return function TooltipContent(props) {
    if (!props.active || !props.payload || props.payload.length === 0) return null;
    const rows = options.rows(props.payload);
    if (rows.length === 0) return null;
    const footer = options.footer?.(props.payload) ?? null;

    return (
      <div className="pointer-events-none min-w-40 rounded-md border border-line bg-surface px-2.5 py-2 shadow-pop">
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
          {options.title(props.label)}
        </p>
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-4 text-[12px]">
              <span className="flex items-center gap-1.5 text-muted">
                {row.color ? (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rotate-45 rounded-[1px]"
                    style={{ backgroundColor: row.color }}
                  />
                ) : null}
                {row.label}
              </span>
              <span className="karo-numeric font-medium text-fg">{row.value}</span>
            </li>
          ))}
        </ul>
        {footer ? (
          <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-subtle">{footer}</p>
        ) : null}
      </div>
    );
  };
}

/** Reads one series value out of a recharts tooltip payload. */
export function payloadValue(payload: TooltipPayload, dataKey: string): number {
  const entry = payload?.find((item) => item.dataKey === dataKey);
  const value = entry?.value;
  if (typeof value === 'number') return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Reads the original row a tooltip entry came from. */
export function payloadRow<T>(payload: TooltipPayload): T | null {
  const first = payload?.[0];
  return (first?.payload as T | undefined) ?? null;
}

/* ------------------------------------------------------------------ *
 *  Frame
 * ------------------------------------------------------------------ */

export interface ChartFrameProps {
  title: string;
  description?: string;
  /** Rendered instead of the chart when there is nothing to plot. */
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  action?: React.ReactNode;
  height?: number;
  className?: string;
  children: React.ReactNode;
}

const DEFAULT_EMPTY_TITLE = 'No usage yet';
const DEFAULT_EMPTY_DESCRIPTION = 'Start a run and it will appear here within a few seconds.';

export function ChartFrame({
  title,
  description,
  isEmpty = false,
  emptyTitle = DEFAULT_EMPTY_TITLE,
  emptyDescription = DEFAULT_EMPTY_DESCRIPTION,
  action,
  height = 220,
  className,
  children,
}: ChartFrameProps) {
  return (
    <section
      className={cn('rounded-lg border border-line bg-surface shadow-sm', className)}
      aria-label={title}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm leading-tight font-semibold text-fg">{title}</h3>
          {description ? (
            <p className="mt-1 text-[12px] leading-snug text-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
      </header>

      <div className="p-4">
        {isEmpty ? (
          <div
            className="karo-dotgrid flex flex-col items-center justify-center rounded-md border border-dashed border-line px-4 text-center"
            style={{ height }}
          >
            <p className="text-[13px] font-medium text-fg">{emptyTitle}</p>
            <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-muted">
              {emptyDescription}
            </p>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </section>
  );
}
