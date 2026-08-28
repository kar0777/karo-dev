'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatCompactNumber, formatMicroUsd, formatNumber } from '@/lib/utils';

import {
  AXIS_PROPS,
  CURSOR_FILL,
  ChartFrame,
  GRID_PROPS,
  SERIES_COLORS,
  chartColor,
  makeTooltip,
  payloadRow,
  payloadValue,
} from './chart-kit';

/**
 * Every chart on the usage page.
 *
 * One client boundary for all of them: recharts is heavy, and splitting it
 * across five islands would ship the same bundle five times.
 */

export type DailyPoint = {
  date: string;
  weightedTokens: number;
  computeHours: number;
  chargedMicroUsd: number;
  modelChargedMicroUsd: number;
  computeChargedMicroUsd: number;
  upstreamCostMicroUsd: number;
  requests: number;
};

export type QuotaPoint = { date: string; remaining: number; ideal: number };

export type ModelSlice = {
  modelSlug: string;
  displayName: string;
  weightedTokens: number;
  chargedMicroUsd: number;
  requests: number;
};

export type ProjectSlice = {
  projectId: string | null;
  name: string;
  weightedTokens: number;
  chargedMicroUsd: number;
  requests: number;
};

export interface UsageChartsProps {
  daily: readonly DailyPoint[];
  quota: readonly QuotaPoint[] | null;
  byModel: readonly ModelSlice[];
  byProject: readonly ProjectSlice[] | null;
  includedWeightedTokens: number;
  rangeLabel: string;
  /** Copy explaining why the burn-down chart has nothing to draw. */
  quotaUnavailableReason: string | null;
}

const EMPTY_TITLE = 'No usage yet';
const EMPTY_BODY = 'Start a run and it will appear here within a few seconds.';

function shortDate(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return text;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function fullDate(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return text;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function hours(value: number): string {
  if (value <= 0) return '0 h';
  if (value < 1) return `${Math.round(value * 60)} min`;
  return `${value.toFixed(value < 10 ? 2 : 1)} h`;
}

/** Static legend — recharts' own legend cannot be styled with our tokens. */
function Legend({ items }: { items: ReadonlyArray<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rotate-45 rounded-[1px]"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function UsageCharts({
  daily,
  quota,
  byModel,
  byProject,
  includedWeightedTokens,
  rangeLabel,
  quotaUnavailableReason,
}: UsageChartsProps) {
  const dailyData = React.useMemo(() => daily.map((point) => ({ ...point })), [daily]);
  const hasDaily = dailyData.some(
    (point) => point.weightedTokens > 0 || point.computeHours > 0 || point.requests > 0,
  );
  const hasCost = dailyData.some((point) => point.chargedMicroUsd > 0);

  const modelData = React.useMemo(
    () =>
      byModel
        .filter((row) => row.weightedTokens > 0)
        .slice(0, 8)
        .map((row) => ({ ...row })),
    [byModel],
  );

  const projectData = React.useMemo(
    () =>
      (byProject ?? [])
        .filter((row) => row.weightedTokens > 0)
        .slice(0, 6)
        .map((row) => ({ ...row })),
    [byProject],
  );

  const usageTooltip = React.useMemo(
    () =>
      makeTooltip({
        title: (label) => fullDate(label),
        rows: (payload) => [
          {
            label: 'Weighted tokens',
            value: formatNumber(payloadValue(payload, 'weightedTokens')),
            color: SERIES_COLORS.tokens,
          },
          {
            label: 'Compute',
            value: hours(payloadValue(payload, 'computeHours')),
            color: SERIES_COLORS.compute,
          },
        ],
        footer: (payload) => {
          const row = payloadRow<DailyPoint>(payload);
          if (!row) return null;
          return `${formatNumber(row.requests)} ${row.requests === 1 ? 'request' : 'requests'} · ${formatMicroUsd(row.chargedMicroUsd)} charged`;
        },
      }),
    [],
  );

  const costTooltip = React.useMemo(
    () =>
      makeTooltip({
        title: (label) => fullDate(label),
        rows: (payload) => [
          {
            label: 'Model',
            value: formatMicroUsd(payloadValue(payload, 'modelChargedMicroUsd'), {
              precise: true,
            }),
            color: SERIES_COLORS.modelSpend,
          },
          {
            label: 'Compute',
            value: formatMicroUsd(payloadValue(payload, 'computeChargedMicroUsd'), {
              precise: true,
            }),
            color: SERIES_COLORS.computeSpend,
          },
        ],
        footer: (payload) => {
          const row = payloadRow<DailyPoint>(payload);
          if (!row) return null;
          return `Total ${formatMicroUsd(row.chargedMicroUsd, { precise: true })}`;
        },
      }),
    [],
  );

  const quotaTooltip = React.useMemo(
    () =>
      makeTooltip({
        title: (label) => fullDate(label),
        rows: (payload) => [
          {
            label: 'Remaining',
            value: formatNumber(payloadValue(payload, 'remaining')),
            color: SERIES_COLORS.remaining,
          },
          {
            label: 'Even burn',
            value: formatNumber(payloadValue(payload, 'ideal')),
            color: SERIES_COLORS.reference,
          },
        ],
        footer: (payload) => {
          const remaining = payloadValue(payload, 'remaining');
          const ideal = payloadValue(payload, 'ideal');
          if (remaining >= ideal) return 'On track — you are under the even-burn line.';
          return 'Ahead of an even burn — at this pace the allowance runs out early.';
        },
      }),
    [],
  );

  const modelTooltip = React.useMemo(
    () =>
      makeTooltip({
        title: (label) => String(label ?? ''),
        rows: (payload) => {
          const row = payloadRow<ModelSlice>(payload);
          if (!row) return [];
          return [
            { label: 'Weighted tokens', value: formatNumber(row.weightedTokens) },
            { label: 'Charged', value: formatMicroUsd(row.chargedMicroUsd, { precise: true }) },
            { label: 'Requests', value: formatNumber(row.requests) },
          ];
        },
      }),
    [],
  );

  const projectTooltip = React.useMemo(
    () =>
      makeTooltip({
        title: (label) => String(label ?? 'Project'),
        rows: (payload) => {
          const row = payloadRow<ProjectSlice>(payload);
          if (!row) return [];
          return [
            { label: 'Weighted tokens', value: formatNumber(row.weightedTokens) },
            { label: 'Charged', value: formatMicroUsd(row.chargedMicroUsd, { precise: true }) },
            { label: 'Requests', value: formatNumber(row.requests) },
          ];
        },
      }),
    [],
  );

  const projectTotal = projectData.reduce((sum, row) => sum + row.weightedTokens, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartFrame
          title="Daily usage"
          description={`Weighted tokens and compute hours · ${rangeLabel}`}
          isEmpty={!hasDaily}
          emptyTitle={EMPTY_TITLE}
          emptyDescription={EMPTY_BODY}
          action={
            <Legend
              items={[
                { label: 'Weighted tokens', color: SERIES_COLORS.tokens },
                { label: 'Compute hours', color: SERIES_COLORS.compute },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="karo-tokens-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLORS.tokens} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={SERIES_COLORS.tokens} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="karo-compute-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLORS.compute} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={SERIES_COLORS.compute} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis {...AXIS_PROPS} dataKey="date" tickFormatter={shortDate} minTickGap={24} />
              <YAxis
                {...AXIS_PROPS}
                yAxisId="tokens"
                width={48}
                tickFormatter={(value: number) => formatCompactNumber(value, 1)}
              />
              <YAxis
                {...AXIS_PROPS}
                yAxisId="compute"
                orientation="right"
                width={40}
                tickFormatter={(value: number) => `${formatCompactNumber(value, 1)}h`}
              />
              <Tooltip content={usageTooltip} cursor={{ stroke: 'var(--color-line-strong)' }} />
              <Area
                yAxisId="tokens"
                type="monotone"
                dataKey="weightedTokens"
                name="Weighted tokens"
                stroke={SERIES_COLORS.tokens}
                strokeWidth={1.5}
                fill="url(#karo-tokens-fill)"
                isAnimationActive={false}
              />
              <Area
                yAxisId="compute"
                type="monotone"
                dataKey="computeHours"
                name="Compute hours"
                stroke={SERIES_COLORS.compute}
                strokeWidth={1.5}
                fill="url(#karo-compute-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Daily cost"
          description={`What was actually charged, split by model and compute · ${rangeLabel}`}
          isEmpty={!hasCost}
          emptyTitle="Nothing charged yet"
          emptyDescription="Usage covered by your plan allowance shows as $0.00 — overage and pay-as-you-go runs appear here."
          action={
            <Legend
              items={[
                { label: 'Model', color: SERIES_COLORS.modelSpend },
                { label: 'Compute', color: SERIES_COLORS.computeSpend },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis {...AXIS_PROPS} dataKey="date" tickFormatter={shortDate} minTickGap={24} />
              <YAxis
                {...AXIS_PROPS}
                width={56}
                tickFormatter={(value: number) => formatMicroUsd(value)}
              />
              <Tooltip content={costTooltip} cursor={{ fill: CURSOR_FILL }} />
              <Bar
                dataKey="modelChargedMicroUsd"
                name="Model"
                stackId="cost"
                fill={SERIES_COLORS.modelSpend}
                isAnimationActive={false}
              />
              <Bar
                dataKey="computeChargedMicroUsd"
                name="Compute"
                stackId="cost"
                fill={SERIES_COLORS.computeSpend}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <ChartFrame
        title="Remaining allowance"
        description="Weighted tokens left this billing period, against an even burn across the period."
        isEmpty={!quota || quota.length === 0}
        emptyTitle={quotaUnavailableReason ? 'No included allowance' : EMPTY_TITLE}
        emptyDescription={quotaUnavailableReason ?? EMPTY_BODY}
        height={200}
        action={
          quota && quota.length > 0 ? (
            <Legend
              items={[
                { label: 'Remaining', color: SERIES_COLORS.remaining },
                { label: 'Even burn', color: SERIES_COLORS.reference },
              ]}
            />
          ) : null
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={quota ? [...quota] : []}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid {...GRID_PROPS} />
            <XAxis {...AXIS_PROPS} dataKey="date" tickFormatter={shortDate} minTickGap={24} />
            <YAxis
              {...AXIS_PROPS}
              width={48}
              domain={[0, includedWeightedTokens > 0 ? includedWeightedTokens : 'auto']}
              tickFormatter={(value: number) => formatCompactNumber(value, 1)}
            />
            <Tooltip content={quotaTooltip} cursor={{ stroke: 'var(--color-line-strong)' }} />
            <Line
              type="monotone"
              dataKey="ideal"
              name="Even burn"
              stroke={SERIES_COLORS.reference}
              strokeDasharray="4 4"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="remaining"
              name="Remaining"
              stroke={SERIES_COLORS.remaining}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>

      <div
        className={
          projectData.length > 0 ? 'grid grid-cols-1 gap-4 xl:grid-cols-2' : 'grid grid-cols-1'
        }
      >
        <ChartFrame
          title="By model"
          description="Weighted tokens per model over the selected period."
          isEmpty={modelData.length === 0}
          emptyTitle={EMPTY_TITLE}
          emptyDescription={EMPTY_BODY}
          height={Math.max(180, modelData.length * 30 + 30)}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={modelData}
              layout="vertical"
              margin={{ top: 0, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
              <XAxis
                {...AXIS_PROPS}
                type="number"
                tickFormatter={(value: number) => formatCompactNumber(value, 1)}
              />
              <YAxis
                {...AXIS_PROPS}
                type="category"
                dataKey="displayName"
                width={132}
                tickFormatter={(value: string) =>
                  value.length > 20 ? `${value.slice(0, 19)}…` : value
                }
              />
              <Tooltip content={modelTooltip} cursor={{ fill: CURSOR_FILL }} />
              <Bar
                dataKey="weightedTokens"
                name="Weighted tokens"
                radius={[0, 3, 3, 0]}
                isAnimationActive={false}
              >
                {modelData.map((row, index) => (
                  <Cell key={row.modelSlug} fill={chartColor(index)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        {projectData.length > 0 ? (
          <ChartFrame
            title="By project"
            description={`${formatNumber(projectTotal)} weighted tokens across ${projectData.length} ${projectData.length === 1 ? 'project' : 'projects'}.`}
            height={Math.max(180, modelData.length * 30 + 30)}
            action={
              <Legend
                items={projectData.map((row, index) => ({
                  label: row.name,
                  color: chartColor(index),
                }))}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Tooltip content={projectTooltip} />
                <Pie
                  data={projectData}
                  dataKey="weightedTokens"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={1.5}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {projectData.map((row, index) => (
                    <Cell
                      key={row.projectId ?? `unassigned-${index}`}
                      fill={chartColor(index)}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </ChartFrame>
        ) : null}
      </div>
    </div>
  );
}
