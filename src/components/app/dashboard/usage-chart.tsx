'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { UsagePoint } from '@/components/app/shell-data';
import { formatCompactNumber, formatMicroUsd } from '@/lib/utils';

/**
 * Fourteen days of usage.
 *
 * Two series on two scales — weighted tokens (jade, the quota unit) and spend
 * (ember, the money unit). They are drawn together because the interesting
 * question is always "did the cost move with the volume, or did something get
 * more expensive?".
 */

export type UsageChartProps = {
  data: readonly UsagePoint[];
  className?: string;
};

type TooltipPayload = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
};

function shortDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function ChartTooltip({ active, label, payload }: TooltipPayload) {
  if (!active || !payload || payload.length === 0) return null;
  const tokens = payload.find((p) => p.dataKey === 'weightedTokens')?.value ?? 0;
  const spend = payload.find((p) => p.dataKey === 'chargedMicroUsd')?.value ?? 0;

  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-2 shadow-pop">
      <p className="text-[11px] font-medium text-fg">
        {typeof label === 'string' ? shortDay(label) : label}
      </p>
      <p className="karo-numeric mt-1 flex items-center gap-1.5 text-[11px] text-muted">
        <span className="size-2 rounded-full bg-chart-1" aria-hidden="true" />
        {formatCompactNumber(tokens)} weighted tokens
      </p>
      <p className="karo-numeric mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
        <span className="size-2 rounded-full bg-chart-2" aria-hidden="true" />
        {formatMicroUsd(spend)} charged
      </p>
    </div>
  );
}

export function UsageChart({ data, className }: UsageChartProps) {
  const empty = React.useMemo(
    () => data.every((point) => point.weightedTokens === 0 && point.chargedMicroUsd === 0),
    [data],
  );

  if (empty) {
    return (
      <div className={className}>
        <div className="flex h-40 flex-col items-center justify-center rounded-md border border-dashed border-line bg-bg-inset text-center">
          <p className="text-[13px] font-medium text-fg">No metered usage yet</p>
          <p className="mt-1 max-w-xs text-[12px] leading-snug text-muted">
            Send the agent a message and this fills in — every request and every compute-second
            is recorded here within a few seconds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={168}>
        <AreaChart data={[...data]} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="karo-usage-tokens" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--k-chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--k-chart-1)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="karo-usage-spend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--k-chart-2)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--k-chart-2)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--k-border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDay}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tick={{ fill: 'var(--k-fg-subtle)', fontSize: 10 }}
          />
          <YAxis
            yAxisId="tokens"
            tickFormatter={(value: number) => formatCompactNumber(value)}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fill: 'var(--k-fg-subtle)', fontSize: 10 }}
          />
          <YAxis yAxisId="spend" orientation="right" hide />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--k-border-strong)' }} />

          <Area
            yAxisId="tokens"
            type="monotone"
            dataKey="weightedTokens"
            name="Weighted tokens"
            stroke="var(--k-chart-1)"
            strokeWidth={1.5}
            fill="url(#karo-usage-tokens)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          <Area
            yAxisId="spend"
            type="monotone"
            dataKey="chargedMicroUsd"
            name="Charged"
            stroke="var(--k-chart-2)"
            strokeWidth={1.5}
            fill="url(#karo-usage-spend)"
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-2 flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-1" aria-hidden="true" />
          Weighted tokens
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-2" aria-hidden="true" />
          Charged
        </span>
      </div>
    </div>
  );
}
