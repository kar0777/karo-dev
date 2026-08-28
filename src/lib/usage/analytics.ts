import 'server-only';

import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  agentRuns,
  computeEvents,
  modelPrices,
  models,
  projects,
  usageEvents,
} from '@/lib/db/schema';
import {
  calculateWeightedTokens,
  deriveMultipliers,
  type TokenCounts,
  type TokenPrices,
  type WeightClass,
} from '@/lib/pricing/weighted-tokens';

import { getDailyUsage, type DailyUsagePoint } from './metering';

/**
 * Read models for the usage analytics screen.
 *
 * `metering.ts` owns the write path and the team-wide report helpers. This
 * module adds what the analytics page needs on top of them: an optional project
 * filter, a gap-free daily series (a chart with missing days lies about the
 * shape of the trend), the model-vs-compute cost split, the per-model weight
 * multipliers behind the explainer, and a streaming CSV cursor for export.
 *
 * Everything returned here is already plain and serialisable, so a Server
 * Component can hand it straight to a Client Component.
 */

export type UsageScope = {
  teamId: string;
  since: Date;
  /** `null` means "every project, plus usage not attached to one". */
  projectId: string | null;
};

/* ------------------------------------------------------------------ *
 *  Daily series
 * ------------------------------------------------------------------ */

export type DailySeriesPoint = {
  date: string;
  weightedTokens: number;
  computeHours: number;
  chargedMicroUsd: number;
  modelChargedMicroUsd: number;
  computeChargedMicroUsd: number;
  upstreamCostMicroUsd: number;
  requests: number;
};

/** Hard ceiling so a very old `since` cannot generate an unbounded array. */
const MAX_SERIES_DAYS = 400;

function utcDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyPoint(date: string): DailySeriesPoint {
  return {
    date,
    weightedTokens: 0,
    computeHours: 0,
    chargedMicroUsd: 0,
    modelChargedMicroUsd: 0,
    computeChargedMicroUsd: 0,
    upstreamCostMicroUsd: 0,
    requests: 0,
  };
}

/** Same shape as `getDailyUsage`, narrowed to a single project. */
async function projectDailyUsage(scope: UsageScope): Promise<DailyUsagePoint[]> {
  const projectId = scope.projectId;
  if (!projectId) return [];

  const modelRows = await db
    .select({
      date: sql<string>`to_char(${usageEvents.occurredAt}, 'YYYY-MM-DD')`,
      weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
      chargedMicroUsd: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      upstreamCostMicroUsd: sql<number>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)::bigint`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.teamId, scope.teamId),
        eq(usageEvents.projectId, projectId),
        gte(usageEvents.occurredAt, scope.since),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const computeRows = await db
    .select({
      date: sql<string>`to_char(${computeEvents.occurredAt}, 'YYYY-MM-DD')`,
      computeHours: sql<number>`coalesce(sum(${computeEvents.billedComputeHours}), 0)::float8`,
      chargedMicroUsd: sql<number>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)::bigint`,
      upstreamCostMicroUsd: sql<number>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)::bigint`,
    })
    .from(computeEvents)
    .where(
      and(
        eq(computeEvents.teamId, scope.teamId),
        eq(computeEvents.projectId, projectId),
        gte(computeEvents.occurredAt, scope.since),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byDate = new Map<string, DailyUsagePoint>();
  const touch = (date: string) => {
    let point = byDate.get(date);
    if (!point) {
      point = {
        date,
        weightedTokens: 0,
        computeHours: 0,
        chargedMicroUsd: 0,
        upstreamCostMicroUsd: 0,
        requests: 0,
      };
      byDate.set(date, point);
    }
    return point;
  };

  for (const row of modelRows) {
    const point = touch(row.date);
    point.weightedTokens = Number(row.weightedTokens);
    point.chargedMicroUsd += Number(row.chargedMicroUsd);
    point.upstreamCostMicroUsd += Number(row.upstreamCostMicroUsd);
    point.requests = Number(row.requests);
  }
  for (const row of computeRows) {
    const point = touch(row.date);
    point.computeHours = Number(row.computeHours);
    point.chargedMicroUsd += Number(row.chargedMicroUsd);
    point.upstreamCostMicroUsd += Number(row.upstreamCostMicroUsd);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Charged money split by what produced it — drives the stacked cost bars. */
async function dailyCostSplit(
  scope: UsageScope,
): Promise<Map<string, { model: number; compute: number }>> {
  const modelWhere = [
    eq(usageEvents.teamId, scope.teamId),
    gte(usageEvents.occurredAt, scope.since),
  ];
  if (scope.projectId) modelWhere.push(eq(usageEvents.projectId, scope.projectId));

  const computeWhere = [
    eq(computeEvents.teamId, scope.teamId),
    gte(computeEvents.occurredAt, scope.since),
  ];
  if (scope.projectId) computeWhere.push(eq(computeEvents.projectId, scope.projectId));

  const [modelRows, computeRows] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(${usageEvents.occurredAt}, 'YYYY-MM-DD')`,
        charged: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      })
      .from(usageEvents)
      .where(and(...modelWhere))
      .groupBy(sql`1`),
    db
      .select({
        date: sql<string>`to_char(${computeEvents.occurredAt}, 'YYYY-MM-DD')`,
        charged: sql<number>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)::bigint`,
      })
      .from(computeEvents)
      .where(and(...computeWhere))
      .groupBy(sql`1`),
  ]);

  const split = new Map<string, { model: number; compute: number }>();
  const touch = (date: string) => {
    let entry = split.get(date);
    if (!entry) {
      entry = { model: 0, compute: 0 };
      split.set(date, entry);
    }
    return entry;
  };

  for (const row of modelRows) touch(row.date).model = Number(row.charged);
  for (const row of computeRows) touch(row.date).compute = Number(row.charged);
  return split;
}

/**
 * Gap-free daily series between `since` and today. Days with no activity are
 * emitted as explicit zeroes so an area chart drops to the baseline instead of
 * interpolating a straight line across a quiet weekend.
 */
export async function loadDailySeries(scope: UsageScope): Promise<DailySeriesPoint[]> {
  const [base, split] = await Promise.all([
    scope.projectId ? projectDailyUsage(scope) : getDailyUsage(scope.teamId, scope.since),
    dailyCostSplit(scope),
  ]);

  const byDate = new Map<string, DailySeriesPoint>();
  for (const point of base) {
    const costs = split.get(point.date);
    byDate.set(point.date, {
      date: point.date,
      weightedTokens: point.weightedTokens,
      computeHours: Math.round(point.computeHours * 10_000) / 10_000,
      chargedMicroUsd: point.chargedMicroUsd,
      modelChargedMicroUsd: costs?.model ?? 0,
      computeChargedMicroUsd: costs?.compute ?? 0,
      upstreamCostMicroUsd: point.upstreamCostMicroUsd,
      requests: point.requests,
    });
  }

  const out: DailySeriesPoint[] = [];
  const cursor = new Date(scope.since);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  for (
    let guard = 0;
    cursor.getTime() <= end.getTime() && guard < MAX_SERIES_DAYS;
    guard += 1
  ) {
    const key = utcDayKey(cursor);
    out.push(byDate.get(key) ?? emptyPoint(key));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Anything the database bucketed outside the generated window (timezone edge
  // days) still belongs in the chart — append rather than silently drop it.
  for (const [key, point] of byDate) {
    if (!out.some((existing) => existing.date === key)) out.push(point);
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ *
 *  Totals
 * ------------------------------------------------------------------ */

export type UsageTotals = {
  requests: number;
  errorRequests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  weightedTokens: number;
  computeHours: number;
  modelChargedMicroUsd: number;
  computeChargedMicroUsd: number;
  chargedMicroUsd: number;
  upstreamCostMicroUsd: number;
  avgLatencyMs: number;
};

export async function loadUsageTotals(scope: UsageScope): Promise<UsageTotals> {
  const modelWhere = [
    eq(usageEvents.teamId, scope.teamId),
    gte(usageEvents.occurredAt, scope.since),
  ];
  if (scope.projectId) modelWhere.push(eq(usageEvents.projectId, scope.projectId));

  const computeWhere = [
    eq(computeEvents.teamId, scope.teamId),
    gte(computeEvents.occurredAt, scope.since),
  ];
  if (scope.projectId) computeWhere.push(eq(computeEvents.projectId, scope.projectId));

  const [modelRow] = await db
    .select({
      requests: sql<number>`count(*)::int`,
      errorRequests: sql<number>`count(*) filter (where ${usageEvents.status} <> 'success')::int`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)::bigint`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageEvents.cacheWriteTokens}), 0)::bigint`,
      weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
      charged: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      upstream: sql<number>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)::bigint`,
      avgLatencyMs: sql<number>`coalesce(avg(${usageEvents.latencyMs}), 0)::float8`,
    })
    .from(usageEvents)
    .where(and(...modelWhere));

  const [computeRow] = await db
    .select({
      computeHours: sql<number>`coalesce(sum(${computeEvents.billedComputeHours}), 0)::float8`,
      charged: sql<number>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)::bigint`,
      upstream: sql<number>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)::bigint`,
    })
    .from(computeEvents)
    .where(and(...computeWhere));

  const modelCharged = Number(modelRow?.charged ?? 0);
  const computeCharged = Number(computeRow?.charged ?? 0);

  return {
    requests: Number(modelRow?.requests ?? 0),
    errorRequests: Number(modelRow?.errorRequests ?? 0),
    inputTokens: Number(modelRow?.inputTokens ?? 0),
    outputTokens: Number(modelRow?.outputTokens ?? 0),
    cachedInputTokens: Number(modelRow?.cachedInputTokens ?? 0),
    cacheWriteTokens: Number(modelRow?.cacheWriteTokens ?? 0),
    weightedTokens: Number(modelRow?.weightedTokens ?? 0),
    computeHours: Math.round(Number(computeRow?.computeHours ?? 0) * 10_000) / 10_000,
    modelChargedMicroUsd: modelCharged,
    computeChargedMicroUsd: computeCharged,
    chargedMicroUsd: modelCharged + computeCharged,
    upstreamCostMicroUsd: Number(modelRow?.upstream ?? 0) + Number(computeRow?.upstream ?? 0),
    avgLatencyMs: Math.round(Number(modelRow?.avgLatencyMs ?? 0)),
  };
}

export type RunCostSummary = {
  runs: number;
  chargedMicroUsd: number;
  /** `null` when there is nothing to average — never render a fabricated 0. */
  averageMicroUsd: number | null;
};

/**
 * Cost per agent run. Averaged over runs rather than requests, because a run is
 * the unit a person actually initiates — a single "fix the failing test" is one
 * decision and a dozen model calls.
 */
export async function loadRunCostSummary(scope: UsageScope): Promise<RunCostSummary> {
  const where = [eq(agentRuns.teamId, scope.teamId), gte(agentRuns.createdAt, scope.since)];
  if (scope.projectId) where.push(eq(agentRuns.projectId, scope.projectId));

  const [row] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      charged: sql<number>`coalesce(sum(${agentRuns.totalChargedMicroUsd}), 0)::bigint`,
    })
    .from(agentRuns)
    .where(and(...where));

  const runs = Number(row?.runs ?? 0);
  const chargedMicroUsd = Number(row?.charged ?? 0);

  return {
    runs,
    chargedMicroUsd,
    averageMicroUsd: runs > 0 ? Math.round(chargedMicroUsd / runs) : null,
  };
}

/* ------------------------------------------------------------------ *
 *  Distributions
 * ------------------------------------------------------------------ */

export type ModelUsageSlice = {
  modelSlug: string;
  displayName: string;
  weightedTokens: number;
  chargedMicroUsd: number;
  requests: number;
};

export type ProjectUsageSlice = {
  projectId: string | null;
  name: string;
  weightedTokens: number;
  chargedMicroUsd: number;
  requests: number;
};

/** Human names for the model slugs returned by the metering aggregates. */
export async function resolveModelNames(
  slugs: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(slugs.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ slug: models.slug, displayName: models.displayName })
    .from(models)
    .where(inArray(models.slug, unique));

  return new Map(rows.map((row) => [row.slug, row.displayName]));
}

export async function resolveProjectNames(
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, unique));

  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Project-scoped variant of `getUsageByModel`, used when a filter is active. */
export async function usageByModelForProject(scope: UsageScope): Promise<
  Array<{
    modelSlug: string;
    weightedTokens: number;
    chargedMicroUsd: number;
    requests: number;
  }>
> {
  const projectId = scope.projectId;
  if (!projectId) return [];

  const rows = await db
    .select({
      modelSlug: usageEvents.modelSlug,
      weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
      chargedMicroUsd: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.teamId, scope.teamId),
        eq(usageEvents.projectId, projectId),
        gte(usageEvents.occurredAt, scope.since),
      ),
    )
    .groupBy(usageEvents.modelSlug)
    .orderBy(sql`2 desc`)
    .limit(12);

  return rows.map((row) => ({
    modelSlug: row.modelSlug,
    weightedTokens: Number(row.weightedTokens),
    chargedMicroUsd: Number(row.chargedMicroUsd),
    requests: Number(row.requests),
  }));
}

/* ------------------------------------------------------------------ *
 *  Weighted-token multipliers
 * ------------------------------------------------------------------ */

export type ModelWeightRow = {
  modelSlug: string;
  displayName: string;
  providerKey: string;
  prices: TokenPrices;
  multipliers: Record<WeightClass, number>;
  /** True when the model has no published input price and fallbacks were used. */
  estimated: boolean;
  counts: TokenCounts;
  weightedTokens: number;
  requests: number;
  chargedMicroUsd: number;
};

/**
 * Per-model token mix plus the multipliers currently derived from that model's
 * price sheet. The explainer needs both halves: the rule, and the team's own
 * numbers the rule was applied to.
 */
export async function loadModelWeightBreakdown(scope: UsageScope): Promise<ModelWeightRow[]> {
  const where = [
    eq(usageEvents.teamId, scope.teamId),
    gte(usageEvents.occurredAt, scope.since),
  ];
  if (scope.projectId) where.push(eq(usageEvents.projectId, scope.projectId));

  const rows = await db
    .select({
      modelId: usageEvents.modelId,
      modelSlug: usageEvents.modelSlug,
      providerKey: usageEvents.providerKey,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageEvents.cachedInputTokens}), 0)::bigint`,
      cacheWriteTokens: sql<number>`coalesce(sum(${usageEvents.cacheWriteTokens}), 0)::bigint`,
      weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
      chargedMicroUsd: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(and(...where))
    .groupBy(usageEvents.modelId, usageEvents.modelSlug, usageEvents.providerKey)
    .orderBy(sql`8 desc`)
    .limit(8);

  if (rows.length === 0) return [];

  const modelIds = rows
    .map((row) => row.modelId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const priceRows = modelIds.length
    ? await db
        .select({
          modelId: modelPrices.modelId,
          displayName: models.displayName,
          inputMicroUsdPerMtok: modelPrices.inputMicroUsdPerMtok,
          outputMicroUsdPerMtok: modelPrices.outputMicroUsdPerMtok,
          cachedInputMicroUsdPerMtok: modelPrices.cachedInputMicroUsdPerMtok,
          cacheWriteMicroUsdPerMtok: modelPrices.cacheWriteMicroUsdPerMtok,
        })
        .from(modelPrices)
        .innerJoin(models, eq(models.id, modelPrices.modelId))
        .where(and(inArray(modelPrices.modelId, modelIds), isNull(modelPrices.effectiveTo)))
    : [];

  const priceByModel = new Map(priceRows.map((row) => [row.modelId, row]));

  return rows.map((row) => {
    const price = row.modelId ? priceByModel.get(row.modelId) : undefined;
    const prices: TokenPrices = {
      inputMicroUsdPerMtok: Number(price?.inputMicroUsdPerMtok ?? 0),
      outputMicroUsdPerMtok: Number(price?.outputMicroUsdPerMtok ?? 0),
      cachedInputMicroUsdPerMtok: Number(price?.cachedInputMicroUsdPerMtok ?? 0),
      cacheWriteMicroUsdPerMtok: Number(price?.cacheWriteMicroUsdPerMtok ?? 0),
    };
    const derived = deriveMultipliers(prices);

    return {
      modelSlug: row.modelSlug || 'unknown',
      displayName: price?.displayName ?? row.modelSlug ?? 'Unknown model',
      providerKey: row.providerKey,
      prices,
      multipliers: derived.multipliers,
      estimated: derived.estimated,
      counts: {
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
        cachedInputTokens: Number(row.cachedInputTokens),
        cacheWriteTokens: Number(row.cacheWriteTokens),
      },
      weightedTokens: Number(row.weightedTokens),
      requests: Number(row.requests),
      chargedMicroUsd: Number(row.chargedMicroUsd),
    } satisfies ModelWeightRow;
  });
}

export type WorkedExample = {
  modelName: string;
  components: Array<{
    label: string;
    tokens: number;
    multiplier: number;
    weightedTokens: number;
  }>;
  weightedTokens: number;
  estimated: boolean;
};

/** Recomputes the weighting for the team's busiest model, showing every step. */
export function buildWorkedExample(rows: readonly ModelWeightRow[]): WorkedExample | null {
  const top = rows.find((row) => row.counts.inputTokens + row.counts.outputTokens > 0);
  if (!top) return null;

  const result = calculateWeightedTokens(top.counts, top.prices);
  return {
    modelName: top.displayName,
    components: result.components.map((component) => ({
      label: component.label,
      tokens: component.tokens,
      multiplier: component.multiplier,
      weightedTokens: component.weightedTokens,
    })),
    weightedTokens: result.weightedTokens,
    estimated: result.estimated,
  };
}

/* ------------------------------------------------------------------ *
 *  Recent requests
 * ------------------------------------------------------------------ */

export type RecentRequest = {
  id: string;
  occurredAt: string;
  projectId: string | null;
  projectName: string | null;
  modelSlug: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  weightedTokens: number;
  chargedMicroUsd: number;
  latencyMs: number;
  status: string;
  settlement: string;
  usedByok: boolean;
};

export const RECENT_REQUESTS_PAGE_SIZE = 25;

export async function listRecentRequests(
  scope: UsageScope,
  options: { limit?: number; offset?: number } = {},
): Promise<{ rows: RecentRequest[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? RECENT_REQUESTS_PAGE_SIZE, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  const where = [
    eq(usageEvents.teamId, scope.teamId),
    gte(usageEvents.occurredAt, scope.since),
  ];
  if (scope.projectId) where.push(eq(usageEvents.projectId, scope.projectId));

  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: usageEvents.id,
        occurredAt: usageEvents.occurredAt,
        projectId: usageEvents.projectId,
        projectName: projects.name,
        modelSlug: usageEvents.modelSlug,
        modelName: models.displayName,
        inputTokens: usageEvents.inputTokens,
        outputTokens: usageEvents.outputTokens,
        cachedInputTokens: usageEvents.cachedInputTokens,
        weightedTokens: usageEvents.weightedTokens,
        chargedMicroUsd: usageEvents.chargedMicroUsd,
        latencyMs: usageEvents.latencyMs,
        status: usageEvents.status,
        settlement: usageEvents.settlement,
        usedByok: usageEvents.usedByok,
      })
      .from(usageEvents)
      .leftJoin(projects, eq(projects.id, usageEvents.projectId))
      .leftJoin(models, eq(models.id, usageEvents.modelId))
      .where(and(...where))
      .orderBy(desc(usageEvents.occurredAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(usageEvents)
      .where(and(...where)),
  ]);

  return {
    total: Number(countRow?.total ?? 0),
    rows: rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      projectId: row.projectId,
      projectName: row.projectName,
      modelSlug: row.modelSlug || '—',
      modelName: row.modelName ?? row.modelSlug ?? '—',
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cachedInputTokens,
      weightedTokens: Number(row.weightedTokens),
      chargedMicroUsd: Number(row.chargedMicroUsd),
      latencyMs: row.latencyMs,
      status: row.status,
      settlement: row.settlement,
      usedByok: row.usedByok,
    })),
  };
}

/* ------------------------------------------------------------------ *
 *  CSV export
 * ------------------------------------------------------------------ */

const CSV_COLUMNS = [
  'occurred_at',
  'project',
  'model',
  'provider',
  'input_tokens',
  'output_tokens',
  'cached_input_tokens',
  'weighted_tokens',
  'charged_usd',
  'upstream_cost_usd',
  'settlement',
  'used_byok',
  'latency_ms',
  'status',
] as const;

/** Quote everything: a project name may legitimately contain a comma. */
function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function microUsdToCsv(microUsd: number): string {
  return (microUsd / 1_000_000).toFixed(6);
}

/**
 * Async cursor over the export. Rows are fetched a page at a time so a team
 * with a hundred thousand requests does not materialise the whole export in
 * memory before the first byte reaches the browser.
 */
export async function* usageCsvChunks(
  scope: UsageScope,
  options: { pageSize?: number; maxRows?: number } = {},
): AsyncGenerator<string> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 500, 50), 2000);
  const maxRows = Math.min(Math.max(options.maxRows ?? 100_000, 1), 500_000);

  yield `${CSV_COLUMNS.join(',')}\n`;

  const where = [
    eq(usageEvents.teamId, scope.teamId),
    gte(usageEvents.occurredAt, scope.since),
  ];
  if (scope.projectId) where.push(eq(usageEvents.projectId, scope.projectId));

  let offset = 0;
  for (;;) {
    const rows = await db
      .select({
        occurredAt: usageEvents.occurredAt,
        projectName: projects.name,
        modelName: models.displayName,
        modelSlug: usageEvents.modelSlug,
        providerKey: usageEvents.providerKey,
        inputTokens: usageEvents.inputTokens,
        outputTokens: usageEvents.outputTokens,
        cachedInputTokens: usageEvents.cachedInputTokens,
        weightedTokens: usageEvents.weightedTokens,
        chargedMicroUsd: usageEvents.chargedMicroUsd,
        upstreamCostMicroUsd: usageEvents.upstreamCostMicroUsd,
        settlement: usageEvents.settlement,
        usedByok: usageEvents.usedByok,
        latencyMs: usageEvents.latencyMs,
        status: usageEvents.status,
      })
      .from(usageEvents)
      .leftJoin(projects, eq(projects.id, usageEvents.projectId))
      .leftJoin(models, eq(models.id, usageEvents.modelId))
      .where(and(...where))
      .orderBy(desc(usageEvents.occurredAt))
      .limit(pageSize)
      .offset(offset);

    if (rows.length === 0) return;

    let buffer = '';
    for (const row of rows) {
      buffer += [
        csvCell(row.occurredAt.toISOString()),
        csvCell(row.projectName ?? ''),
        csvCell(row.modelName ?? row.modelSlug),
        csvCell(row.providerKey),
        csvCell(row.inputTokens),
        csvCell(row.outputTokens),
        csvCell(row.cachedInputTokens),
        csvCell(Number(row.weightedTokens)),
        csvCell(microUsdToCsv(Number(row.chargedMicroUsd))),
        csvCell(microUsdToCsv(Number(row.upstreamCostMicroUsd))),
        csvCell(row.settlement),
        csvCell(row.usedByok),
        csvCell(row.latencyMs),
        csvCell(row.status),
      ].join(',');
      buffer += '\n';
    }
    yield buffer;

    offset += rows.length;
    if (rows.length < pageSize || offset >= maxRows) return;
  }
}
