import 'server-only';

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  agentRuns,
  computeEvents,
  models,
  plans,
  subscriptions,
  teams,
  usageEvents,
} from '@/lib/db/schema';

import { dayKeys, toNumber, type Period } from './period';

/**
 * Platform-wide consumption.
 *
 * The suspicious-usage detector at the bottom is deliberately simple: a team is
 * compared against **its own** trailing median, not against other teams. A
 * research lab burning 40 compute hours a day is not an anomaly; that same lab
 * suddenly burning 400 is. Every flag carries the numbers that produced it so
 * an operator can disagree with it in one glance.
 */

export type UsageDayPoint = {
  date: string;
  weightedTokens: number;
  computeHours: number;
  chargedMicroUsd: number;
  upstreamMicroUsd: number;
};

export type UsageBreakdownRow = {
  key: string;
  label: string;
  sublabel?: string;
  weightedTokens: number;
  calls: number;
  chargedMicroUsd: number;
  upstreamMicroUsd: number;
};

export type TopTeamRow = {
  teamId: string;
  teamName: string;
  teamSlug: string;
  planName: string;
  weightedTokens: number;
  computeHours: number;
  chargedMicroUsd: number;
  upstreamMicroUsd: number;
};

export type UsageFlag = {
  teamId: string;
  teamName: string;
  metric: 'runs' | 'compute' | 'spend';
  metricLabel: string;
  latest: number;
  median: number;
  ratio: number;
  reason: string;
};

export type UsageData = {
  daily: UsageDayPoint[];
  byModel: UsageBreakdownRow[];
  byProvider: UsageBreakdownRow[];
  byPlanTier: UsageBreakdownRow[];
  topTeams: TopTeamRow[];
  flags: UsageFlag[];
  totals: {
    weightedTokens: number;
    computeHours: number;
    chargedMicroUsd: number;
    upstreamMicroUsd: number;
    calls: number;
  };
};

/** A flag needs both a big multiple and a meaningful absolute jump. */
const SPIKE_RATIO = 3;
const FLOORS = { runs: 12, compute: 4, spend: 500_000 } as const;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const DAY = sql`'YYYY-MM-DD'`;

export async function loadUsage(period: Period): Promise<UsageData> {
  const { from, to } = period;
  const window = and(gte(usageEvents.occurredAt, from), lte(usageEvents.occurredAt, to));
  const computeWindow = and(
    gte(computeEvents.occurredAt, from),
    lte(computeEvents.occurredAt, to),
  );

  const [modelDaily, computeDaily, byModel, byProvider, teamTotals, computeTeamTotals] =
    await Promise.all([
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${usageEvents.occurredAt} at time zone 'UTC'), ${DAY})`,
          weighted: sql<string>`coalesce(sum(${usageEvents.weightedTokens}), 0)`,
          charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
          upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
        })
        .from(usageEvents)
        .where(window)
        .groupBy(sql`1`),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${computeEvents.occurredAt} at time zone 'UTC'), ${DAY})`,
          hours: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
          charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
          upstream: sql<string>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)`,
        })
        .from(computeEvents)
        .where(computeWindow)
        .groupBy(sql`1`),
      db
        .select({
          modelId: usageEvents.modelId,
          modelSlug: usageEvents.modelSlug,
          displayName: models.displayName,
          weighted: sql<string>`coalesce(sum(${usageEvents.weightedTokens}), 0)`,
          calls: sql<string>`count(*)`,
          charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
          upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
        })
        .from(usageEvents)
        .leftJoin(models, eq(models.id, usageEvents.modelId))
        .where(window)
        .groupBy(usageEvents.modelId, usageEvents.modelSlug, models.displayName),
      db
        .select({
          providerKey: usageEvents.providerKey,
          weighted: sql<string>`coalesce(sum(${usageEvents.weightedTokens}), 0)`,
          calls: sql<string>`count(*)`,
          charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
          upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
        })
        .from(usageEvents)
        .where(window)
        .groupBy(usageEvents.providerKey),
      db
        .select({
          teamId: usageEvents.teamId,
          weighted: sql<string>`coalesce(sum(${usageEvents.weightedTokens}), 0)`,
          charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
          upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
        })
        .from(usageEvents)
        .where(window)
        .groupBy(usageEvents.teamId),
      db
        .select({
          teamId: computeEvents.teamId,
          hours: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
          charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
          upstream: sql<string>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)`,
        })
        .from(computeEvents)
        .where(computeWindow)
        .groupBy(computeEvents.teamId),
    ]);

  /* ---- Daily series ---------------------------------------------------- */
  const modelByDay = new Map(modelDaily.map((r) => [r.day, r]));
  const computeByDay = new Map(computeDaily.map((r) => [r.day, r]));

  const daily: UsageDayPoint[] = dayKeys(from, to).map((date) => {
    const m = modelByDay.get(date);
    const c = computeByDay.get(date);
    return {
      date,
      weightedTokens: toNumber(m?.weighted),
      computeHours: toNumber(c?.hours),
      chargedMicroUsd: toNumber(m?.charged) + toNumber(c?.charged),
      upstreamMicroUsd: toNumber(m?.upstream) + toNumber(c?.upstream),
    };
  });

  /* ---- Team aggregates ------------------------------------------------- */
  type TeamAcc = {
    weighted: number;
    hours: number;
    charged: number;
    upstream: number;
  };
  const teamAcc = new Map<string, TeamAcc>();
  const ensure = (teamId: string): TeamAcc => {
    const found = teamAcc.get(teamId);
    if (found) return found;
    const fresh: TeamAcc = { weighted: 0, hours: 0, charged: 0, upstream: 0 };
    teamAcc.set(teamId, fresh);
    return fresh;
  };
  for (const row of teamTotals) {
    const acc = ensure(row.teamId);
    acc.weighted += toNumber(row.weighted);
    acc.charged += toNumber(row.charged);
    acc.upstream += toNumber(row.upstream);
  }
  for (const row of computeTeamTotals) {
    const acc = ensure(row.teamId);
    acc.hours += toNumber(row.hours);
    acc.charged += toNumber(row.charged);
    acc.upstream += toNumber(row.upstream);
  }

  const teamIds = [...teamAcc.keys()];
  const teamMeta =
    teamIds.length > 0
      ? await db
          .select({
            id: teams.id,
            name: teams.name,
            slug: teams.slug,
            planName: plans.name,
            planTier: plans.tier,
          })
          .from(teams)
          .leftJoin(subscriptions, eq(subscriptions.teamId, teams.id))
          .leftJoin(plans, eq(plans.id, subscriptions.planId))
          .where(inArray(teams.id, teamIds))
      : [];

  const metaById = new Map(teamMeta.map((t) => [t.id, t]));

  const topTeams: TopTeamRow[] = teamIds
    .map((teamId) => {
      const acc = teamAcc.get(teamId)!;
      const meta = metaById.get(teamId);
      return {
        teamId,
        teamName: meta?.name ?? 'Deleted team',
        teamSlug: meta?.slug ?? teamId,
        planName: meta?.planName ?? 'Pay as you go',
        weightedTokens: acc.weighted,
        computeHours: acc.hours,
        chargedMicroUsd: acc.charged,
        upstreamMicroUsd: acc.upstream,
      };
    })
    .sort((a, b) => b.weightedTokens - a.weightedTokens)
    .slice(0, 20);

  /* ---- Plan tier roll-up ---------------------------------------------- */
  const tierAcc = new Map<string, UsageBreakdownRow>();
  for (const teamId of teamIds) {
    const acc = teamAcc.get(teamId)!;
    const tier = metaById.get(teamId)?.planTier ?? 'payg';
    const entry = tierAcc.get(tier) ?? {
      key: tier,
      label: tier === 'payg' ? 'Pay as you go' : tier,
      weightedTokens: 0,
      calls: 0,
      chargedMicroUsd: 0,
      upstreamMicroUsd: 0,
    };
    entry.weightedTokens += acc.weighted;
    entry.chargedMicroUsd += acc.charged;
    entry.upstreamMicroUsd += acc.upstream;
    entry.calls += 1;
    tierAcc.set(tier, entry);
  }

  return {
    daily,
    byModel: byModel
      .map((row) => ({
        key: row.modelId ?? row.modelSlug ?? 'unknown',
        label: row.displayName ?? row.modelSlug ?? 'Unknown model',
        sublabel: row.modelSlug ?? undefined,
        weightedTokens: toNumber(row.weighted),
        calls: toNumber(row.calls),
        chargedMicroUsd: toNumber(row.charged),
        upstreamMicroUsd: toNumber(row.upstream),
      }))
      .sort((a, b) => b.weightedTokens - a.weightedTokens),
    byProvider: byProvider
      .map((row) => ({
        key: row.providerKey,
        label: row.providerKey,
        weightedTokens: toNumber(row.weighted),
        calls: toNumber(row.calls),
        chargedMicroUsd: toNumber(row.charged),
        upstreamMicroUsd: toNumber(row.upstream),
      }))
      .sort((a, b) => b.weightedTokens - a.weightedTokens),
    byPlanTier: [...tierAcc.values()].sort((a, b) => b.weightedTokens - a.weightedTokens),
    topTeams,
    flags: await detectSuspiciousUsage(period, metaById),
    totals: {
      weightedTokens: daily.reduce((sum, d) => sum + d.weightedTokens, 0),
      computeHours: daily.reduce((sum, d) => sum + d.computeHours, 0),
      chargedMicroUsd: daily.reduce((sum, d) => sum + d.chargedMicroUsd, 0),
      upstreamMicroUsd: daily.reduce((sum, d) => sum + d.upstreamMicroUsd, 0),
      calls: byProvider.reduce((sum, p) => sum + toNumber(p.calls), 0),
    },
  };
}

/* ------------------------------------------------------------------ *
 *  Suspicious usage
 * ------------------------------------------------------------------ */

async function detectSuspiciousUsage(
  period: Period,
  metaById: ReadonlyMap<string, { name: string }>,
): Promise<UsageFlag[]> {
  const { from, to } = period;

  const [runRows, computeRows, spendRows] = await Promise.all([
    db
      .select({
        teamId: agentRuns.teamId,
        day: sql<string>`to_char(date_trunc('day', ${agentRuns.createdAt} at time zone 'UTC'), ${DAY})`,
        value: sql<string>`count(*)`,
      })
      .from(agentRuns)
      .where(and(gte(agentRuns.createdAt, from), lte(agentRuns.createdAt, to)))
      .groupBy(agentRuns.teamId, sql`2`),
    db
      .select({
        teamId: computeEvents.teamId,
        day: sql<string>`to_char(date_trunc('day', ${computeEvents.occurredAt} at time zone 'UTC'), ${DAY})`,
        value: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
      })
      .from(computeEvents)
      .where(and(gte(computeEvents.occurredAt, from), lte(computeEvents.occurredAt, to)))
      .groupBy(computeEvents.teamId, sql`2`),
    db
      .select({
        teamId: usageEvents.teamId,
        day: sql<string>`to_char(date_trunc('day', ${usageEvents.occurredAt} at time zone 'UTC'), ${DAY})`,
        value: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
      })
      .from(usageEvents)
      .where(and(gte(usageEvents.occurredAt, from), lte(usageEvents.occurredAt, to)))
      .groupBy(usageEvents.teamId, sql`2`),
  ]);

  const days = dayKeys(from, to);
  const flags: UsageFlag[] = [];

  const scan = (
    rows: Array<{ teamId: string; day: string; value: string }>,
    metric: UsageFlag['metric'],
    metricLabel: string,
    floor: number,
    format: (value: number) => string,
  ) => {
    const byTeam = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const bucket = byTeam.get(row.teamId) ?? new Map<string, number>();
      bucket.set(row.day, toNumber(row.value));
      byTeam.set(row.teamId, bucket);
    }

    for (const [teamId, series] of byTeam) {
      // Need a few days of history before "unusual" means anything.
      if (days.length < 4) continue;
      const latestDay = days[days.length - 1]!;
      const latest = series.get(latestDay) ?? 0;
      if (latest < floor) continue;

      const baseline = days.slice(0, -1).map((d) => series.get(d) ?? 0);
      const med = median(baseline);
      const ratio = med > 0 ? latest / med : Number.POSITIVE_INFINITY;
      if (med > 0 && ratio < SPIKE_RATIO) continue;

      flags.push({
        teamId,
        teamName: metaById.get(teamId)?.name ?? 'Unknown team',
        metric,
        metricLabel,
        latest,
        median: med,
        ratio: Number.isFinite(ratio) ? ratio : 0,
        reason:
          med > 0
            ? `${format(latest)} yesterday against a ${period.days}-day median of ${format(med)} — ${ratio.toFixed(1)}× this team's own baseline.`
            : `${format(latest)} yesterday with no prior activity in the last ${period.days} days.`,
      });
    }
  };

  scan(runRows, 'runs', 'Agent runs / day', FLOORS.runs, (v) => `${Math.round(v)} runs`);
  scan(
    computeRows,
    'compute',
    'Compute hours / day',
    FLOORS.compute,
    (v) => `${v.toFixed(1)} compute hours`,
  );
  scan(
    spendRows,
    'spend',
    'Charged / day',
    FLOORS.spend,
    (v) => `$${(v / 1_000_000).toFixed(2)}`,
  );

  return flags.sort((a, b) => b.ratio - a.ratio).slice(0, 25);
}
