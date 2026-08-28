'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cn, formatCompactNumber, formatMicroUsd } from '@/lib/utils';

/**
 * Chart primitives for the admin console.
 *
 * Every series colour comes from the `--k-chart-*` ramp, so a chart never
 * introduces a hue the rest of the product does not use, and both themes flip
 * automatically. Axis and grid colours are read from the token variables for
 * the same reason.
 */

const AXIS = 'var(--k-fg-subtle)';
const GRID = 'var(--k-border)';

export const CHART_COLORS = [
  'var(--k-chart-1)',
  'var(--k-chart-2)',
  'var(--k-chart-3)',
  'var(--k-chart-4)',
  'var(--k-chart-5)',
  'var(--k-chart-6)',
] as const;

function shortDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

type TooltipEntry = {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

function KaroTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  format: (value: number, key: string) => string;
  labelFormat?: (label: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const headline =
    typeof label === 'string' ? (labelFormat?.(label) ?? label) : String(label ?? '');

  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-2 shadow-pop">
      <p className="mb-1 text-[11px] font-medium text-fg">{headline}</p>
      <ul className="flex flex-col gap-0.5">
        {payload.map((entry, index) => (
          <li key={index} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: entry.color }}
            />
            <span>{entry.name}</span>
            <span className="karo-numeric ml-auto pl-3 font-medium text-fg">
              {format(Number(entry.value ?? 0), String(entry.dataKey ?? ''))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartFrame({
  title,
  description,
  actions,
  height = 240,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  height?: number;
  children: React.ReactElement;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-line bg-surface', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm leading-tight font-semibold text-fg">{title}</h2>
          {description ? (
            <p className="mt-1 text-[12px] leading-snug text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
      <div className="p-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

const axisProps = {
  stroke: AXIS,
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: AXIS },
} as const;

/* ------------------------------------------------------------------ *
 *  Growth
 * ------------------------------------------------------------------ */

export type GrowthPoint = {
  date: string;
  signups: number;
  activeTeams: number;
  runs: number;
};

export function GrowthChart({ data }: { data: GrowthPoint[] }) {
  return (
    <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
      <defs>
        <linearGradient id="karo-growth-signups" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--k-chart-1)" stopOpacity={0.35} />
          <stop offset="100%" stopColor="var(--k-chart-1)" stopOpacity={0.02} />
        </linearGradient>
        <linearGradient id="karo-growth-teams" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--k-chart-3)" stopOpacity={0.28} />
          <stop offset="100%" stopColor="var(--k-chart-3)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
      <YAxis allowDecimals={false} width={44} {...axisProps} />
      <Tooltip
        cursor={{ stroke: GRID }}
        content={
          <KaroTooltip format={(value) => formatCompactNumber(value)} labelFormat={shortDate} />
        }
      />
      <Legend
        iconType="square"
        iconSize={8}
        wrapperStyle={{ fontSize: 11, color: 'var(--k-fg-muted)' }}
      />
      <Area
        type="monotone"
        dataKey="signups"
        name="Signups"
        stroke="var(--k-chart-1)"
        strokeWidth={1.6}
        fill="url(#karo-growth-signups)"
      />
      <Area
        type="monotone"
        dataKey="activeTeams"
        name="Active teams"
        stroke="var(--k-chart-3)"
        strokeWidth={1.6}
        fill="url(#karo-growth-teams)"
      />
    </AreaChart>
  );
}

export function RunsChart({ data }: { data: GrowthPoint[] }) {
  return (
    <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
      <YAxis allowDecimals={false} width={44} {...axisProps} />
      <Tooltip
        cursor={{ fill: 'var(--k-surface-2)' }}
        content={
          <KaroTooltip format={(value) => formatCompactNumber(value)} labelFormat={shortDate} />
        }
      />
      <Bar dataKey="runs" name="Agent runs" fill="var(--k-chart-2)" radius={[2, 2, 0, 0]} />
    </BarChart>
  );
}

/* ------------------------------------------------------------------ *
 *  Usage & money
 * ------------------------------------------------------------------ */

export type UsagePoint = {
  date: string;
  weightedTokens: number;
  computeHours: number;
  chargedMicroUsd: number;
  upstreamMicroUsd: number;
};

export function TokensChart({ data }: { data: UsagePoint[] }) {
  return (
    <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -4 }}>
      <defs>
        <linearGradient id="karo-tokens" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--k-chart-1)" stopOpacity={0.35} />
          <stop offset="100%" stopColor="var(--k-chart-1)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
      <YAxis tickFormatter={(v: number) => formatCompactNumber(v)} width={52} {...axisProps} />
      <Tooltip
        cursor={{ stroke: GRID }}
        content={
          <KaroTooltip format={(value) => formatCompactNumber(value)} labelFormat={shortDate} />
        }
      />
      <Area
        type="monotone"
        dataKey="weightedTokens"
        name="Weighted tokens"
        stroke="var(--k-chart-1)"
        strokeWidth={1.6}
        fill="url(#karo-tokens)"
      />
    </AreaChart>
  );
}

export function ComputeChart({ data }: { data: UsagePoint[] }) {
  return (
    <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
      <YAxis width={44} {...axisProps} />
      <Tooltip
        cursor={{ fill: 'var(--k-surface-2)' }}
        content={
          <KaroTooltip format={(value) => `${value.toFixed(2)} h`} labelFormat={shortDate} />
        }
      />
      <Bar
        dataKey="computeHours"
        name="Compute hours"
        fill="var(--k-chart-2)"
        radius={[2, 2, 0, 0]}
      />
    </BarChart>
  );
}

export function RevenueVsCostChart({ data }: { data: UsagePoint[] }) {
  return (
    <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
      <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
      <YAxis tickFormatter={(v: number) => formatMicroUsd(v)} width={64} {...axisProps} />
      <Tooltip
        cursor={{ stroke: GRID }}
        content={
          <KaroTooltip format={(value) => formatMicroUsd(value)} labelFormat={shortDate} />
        }
      />
      <Legend
        iconType="square"
        iconSize={8}
        wrapperStyle={{ fontSize: 11, color: 'var(--k-fg-muted)' }}
      />
      <Line
        type="monotone"
        dataKey="chargedMicroUsd"
        name="Charged"
        stroke="var(--k-chart-1)"
        strokeWidth={1.8}
        dot={false}
      />
      <Line
        type="monotone"
        dataKey="upstreamMicroUsd"
        name="Upstream cost"
        stroke="var(--k-chart-2)"
        strokeWidth={1.8}
        strokeDasharray="4 3"
        dot={false}
      />
    </LineChart>
  );
}

/* ------------------------------------------------------------------ *
 *  Categorical
 * ------------------------------------------------------------------ */

export type CategoryPoint = { label: string; value: number };

export function CategoryBarChart({
  data,
  unit = 'count',
}: {
  data: CategoryPoint[];
  unit?: 'count' | 'money';
}) {
  const format = (value: number) =>
    unit === 'money' ? formatMicroUsd(value) : formatCompactNumber(value);

  return (
    <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
      <CartesianGrid stroke={GRID} strokeDasharray="2 4" horizontal={false} />
      <XAxis type="number" tickFormatter={format} {...axisProps} />
      <YAxis type="category" dataKey="label" width={110} {...axisProps} />
      <Tooltip
        cursor={{ fill: 'var(--k-surface-2)' }}
        content={<KaroTooltip format={format} />}
      />
      <Bar dataKey="value" name="Total" radius={[0, 2, 2, 0]}>
        {data.map((entry, index) => (
          <Cell key={entry.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
        ))}
      </Bar>
    </BarChart>
  );
}
