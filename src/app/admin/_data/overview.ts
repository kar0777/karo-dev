import 'server-only';

import { and, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  agentRuns,
  incidents,
  invoices,
  plans,
  subscriptions,
  teams,
  topups,
  usageEvents,
  computeEvents,
  users,
  type Incident,
} from '@/lib/db/schema';

import {
  estimateStripeFees,
  grossMargin,
  monthlyPriceMicroUsd,
  proratedSubscriptionRevenue,
  type MarginResult,
} from './finance';
import { dayKeys, toNumber, type Period } from './period';

/**
 * The business at a glance.
 *
 * Everything here is one round trip per question rather than one clever query,
 * because the shapes are genuinely different and a single query would have to
 * be read three times before anyone trusted the margin number on it.
 */

export type PlanBreakdownRow = {
  planId: string;
  planKey: string;
  planName: string;
  tier: string;
  subscriptions: number;
  mrrMicroUsd: number;
};

export type TrendPoint = {
  date: string;
  signups: number;
  activeTeams: number;
  runs: number;
};

export type LossMakingTeam = {
  teamId: string;
  teamName: string;
  teamSlug: string;
  planName: string;
  planTier: string;
  /** Subscription revenue attributed to this window, prorated. */
  subscriptionRevenueMicroUsd: number;
  /** Metered charges: overage and pay-as-you-go. */
  meteredChargedMicroUsd: number;
  revenueMicroUsd: number;
  modelUpstreamMicroUsd: number;
  computeUpstreamMicroUsd: number;
  upstreamMicroUsd: number;
  /** Positive means Karo is losing money on this team over the window. */
  deficitMicroUsd: number;
  weightedTokens: number;
  computeHours: number;
};

export type OverviewData = {
  mrrMicroUsd: number;
  activeSubscriptions: number;
  planBreakdown: PlanBreakdownRow[];
  trialingSubscriptions: number;

  modelChargedMicroUsd: number;
  modelUpstreamMicroUsd: number;
  computeChargedMicroUsd: number;
  computeUpstreamMicroUsd: number;
  computeHours: number;
  weightedTokens: number;

  subscriptionRevenueMicroUsd: number;
  meteredRevenueMicroUsd: number;
  cashCollectedMicroUsd: number;
  cashChargeCount: number;
  stripeFeesMicroUsd: number;
  margin: MarginResult;

  previousMargin: MarginResult;

  trend: TrendPoint[];
  providerCalls: number;
  providerFailures: number;
  providerFailureRate: number;

  openIncidents: Incident[];
  totalUsers: number;
  totalTeams: number;
  newUsers: number;

  lossMaking: LossMakingTeam[];
};

type UsageTotals = {
  charged: number;
  upstream: number;
  weighted: number;
  calls: number;
  failures: number;
};

async function usageTotals(from: Date, to: Date): Promise<UsageTotals> {
  const rows = await db
    .select({
      charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
      upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
      weighted: sql<string>`coalesce(sum(${usageEvents.weightedTokens}), 0)`,
      calls: sql<string>`count(*)`,
      failures: sql<string>`count(*) filter (where ${usageEvents.status} <> 'success')`,
    })
    .from(usageEvents)
    .where(and(gte(usageEvents.occurredAt, from), lte(usageEvents.occurredAt, to)));

  const row = rows[0];
  return {
    charged: toNumber(row?.charged),
    upstream: toNumber(row?.upstream),
    weighted: toNumber(row?.weighted),
    calls: toNumber(row?.calls),
    failures: toNumber(row?.failures),
  };
}

type ComputeTotals = { charged: number; upstream: number; hours: number };

async function computeTotals(from: Date, to: Date): Promise<ComputeTotals> {
  const rows = await db
    .select({
      charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
      upstream: sql<string>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)`,
      hours: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
    })
    .from(computeEvents)
    .where(and(gte(computeEvents.occurredAt, from), lte(computeEvents.occurredAt, to)));

  const row = rows[0];
  return {
    charged: toNumber(row?.charged),
    upstream: toNumber(row?.upstream),
    hours: toNumber(row?.hours),
  };
}

async function cashCollected(from: Date, to: Date) {
  const [topupRows, invoiceRows] = await Promise.all([
    db
      .select({
        total: sql<string>`coalesce(sum(${topups.amountMicroUsd}), 0)`,
        count: sql<string>`count(*)`,
      })
      .from(topups)
      .where(
        and(
          eq(topups.status, 'succeeded'),
          gte(topups.createdAt, from),
          lte(topups.createdAt, to),
        ),
      ),
    db
      .select({
        total: sql<string>`coalesce(sum(${invoices.amountPaidMicroUsd}), 0)`,
        count: sql<string>`count(*)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, 'paid'),
          gte(invoices.createdAt, from),
          lte(invoices.createdAt, to),
        ),
      ),
  ]);

  return {
    topupsMicroUsd: toNumber(topupRows[0]?.total),
    topupCount: toNumber(topupRows[0]?.count),
    invoicesMicroUsd: toNumber(invoiceRows[0]?.total),
    invoiceCount: toNumber(invoiceRows[0]?.count),
  };
}

async function activeSubscriptionRows() {
  return db
    .select({
      planId: plans.id,
      planKey: plans.key,
      planName: plans.name,
      tier: plans.tier,
      interval: subscriptions.interval,
      status: subscriptions.status,
      teamId: subscriptions.teamId,
      priceMicroUsdMonthly: plans.priceMicroUsdMonthly,
      priceMicroUsdYearly: plans.priceMicroUsdYearly,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(subscriptions.status, ['active', 'trialing']));
}

async function buildTrend(period: Period): Promise<TrendPoint[]> {
  const { from, to } = period;

  const [signupRows, teamRows, runRows] = await Promise.all([
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${users.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        count: sql<string>`count(*)`,
      })
      .from(users)
      .where(and(gte(users.createdAt, from), lte(users.createdAt, to)))
      .groupBy(sql`1`),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${usageEvents.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        count: sql<string>`count(distinct ${usageEvents.teamId})`,
      })
      .from(usageEvents)
      .where(and(gte(usageEvents.occurredAt, from), lte(usageEvents.occurredAt, to)))
      .groupBy(sql`1`),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${agentRuns.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        count: sql<string>`count(*)`,
      })
      .from(agentRuns)
      .where(and(gte(agentRuns.createdAt, from), lte(agentRuns.createdAt, to)))
      .groupBy(sql`1`),
  ]);

  const signups = new Map(signupRows.map((r) => [r.day, toNumber(r.count)]));
  const activeTeams = new Map(teamRows.map((r) => [r.day, toNumber(r.count)]));
  const runs = new Map(runRows.map((r) => [r.day, toNumber(r.count)]));

  return dayKeys(from, to).map((date) => ({
    date,
    signups: signups.get(date) ?? 0,
    activeTeams: activeTeams.get(date) ?? 0,
    runs: runs.get(date) ?? 0,
  }));
}

async function buildLossMaking(period: Period, limit = 20): Promise<LossMakingTeam[]> {
  const { from, to, days } = period;

  const [modelRows, computeRows] = await Promise.all([
    db
      .select({
        teamId: usageEvents.teamId,
        charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
        upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
        weighted: sql<string>`coalesce(sum(${usageEvents.weightedTokens}), 0)`,
      })
      .from(usageEvents)
      .where(and(gte(usageEvents.occurredAt, from), lte(usageEvents.occurredAt, to)))
      .groupBy(usageEvents.teamId),
    db
      .select({
        teamId: computeEvents.teamId,
        charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
        upstream: sql<string>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)`,
        hours: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
      })
      .from(computeEvents)
      .where(and(gte(computeEvents.occurredAt, from), lte(computeEvents.occurredAt, to)))
      .groupBy(computeEvents.teamId),
  ]);

  type Accumulator = {
    metered: number;
    modelUpstream: number;
    computeUpstream: number;
    weighted: number;
    hours: number;
  };
  const byTeam = new Map<string, Accumulator>();

  const ensure = (teamId: string): Accumulator => {
    const existing = byTeam.get(teamId);
    if (existing) return existing;
    const fresh: Accumulator = {
      metered: 0,
      modelUpstream: 0,
      computeUpstream: 0,
      weighted: 0,
      hours: 0,
    };
    byTeam.set(teamId, fresh);
    return fresh;
  };

  for (const row of modelRows) {
    const acc = ensure(row.teamId);
    acc.metered += toNumber(row.charged);
    acc.modelUpstream += toNumber(row.upstream);
    acc.weighted += toNumber(row.weighted);
  }
  for (const row of computeRows) {
    const acc = ensure(row.teamId);
    acc.metered += toNumber(row.charged);
    acc.computeUpstream += toNumber(row.upstream);
    acc.hours += toNumber(row.hours);
  }

  const teamIds = [...byTeam.keys()];
  if (teamIds.length === 0) return [];

  const teamRows = await db
    .select({
      id: teams.id,
      name: teams.name,
      slug: teams.slug,
      planName: plans.name,
      planTier: plans.tier,
      priceMicroUsdMonthly: plans.priceMicroUsdMonthly,
      priceMicroUsdYearly: plans.priceMicroUsdYearly,
      interval: subscriptions.interval,
      status: subscriptions.status,
    })
    .from(teams)
    .leftJoin(subscriptions, eq(subscriptions.teamId, teams.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(teams.id, teamIds));

  const rows: LossMakingTeam[] = teamRows.map((team) => {
    const acc = byTeam.get(team.id) ?? {
      metered: 0,
      modelUpstream: 0,
      computeUpstream: 0,
      weighted: 0,
      hours: 0,
    };

    const billable =
      team.status === 'active' || team.status === 'trialing'
        ? monthlyPriceMicroUsd(
            {
              priceMicroUsdMonthly: team.priceMicroUsdMonthly ?? 0,
              priceMicroUsdYearly: team.priceMicroUsdYearly ?? 0,
            },
            team.interval ?? 'month',
          )
        : 0;

    const subscriptionRevenueMicroUsd = proratedSubscriptionRevenue(billable, days);
    const upstream = acc.modelUpstream + acc.computeUpstream;
    const revenue = subscriptionRevenueMicroUsd + acc.metered;

    return {
      teamId: team.id,
      teamName: team.name,
      teamSlug: team.slug,
      planName: team.planName ?? 'Pay as you go',
      planTier: team.planTier ?? 'payg',
      subscriptionRevenueMicroUsd,
      meteredChargedMicroUsd: acc.metered,
      revenueMicroUsd: revenue,
      modelUpstreamMicroUsd: acc.modelUpstream,
      computeUpstreamMicroUsd: acc.computeUpstream,
      upstreamMicroUsd: upstream,
      deficitMicroUsd: upstream - revenue,
      weightedTokens: acc.weighted,
      computeHours: acc.hours,
    };
  });

  return rows
    .filter((row) => row.deficitMicroUsd > 0)
    .sort((a, b) => b.deficitMicroUsd - a.deficitMicroUsd)
    .slice(0, limit);
}

export async function loadOverview(period: Period): Promise<OverviewData> {
  const { from, to, previousFrom, days } = period;

  const [
    usageNow,
    usagePrev,
    computeNow,
    computePrev,
    cash,
    cashPrev,
    subscriptionRows,
    trend,
    openIncidents,
    counts,
    lossMaking,
  ] = await Promise.all([
    usageTotals(from, to),
    usageTotals(previousFrom, from),
    computeTotals(from, to),
    computeTotals(previousFrom, from),
    cashCollected(from, to),
    cashCollected(previousFrom, from),
    activeSubscriptionRows(),
    buildTrend(period),
    db
      .select()
      .from(incidents)
      .where(ne(incidents.status, 'resolved'))
      .orderBy(desc(incidents.detectedAt))
      .limit(10),
    db
      .select({
        totalUsers: sql<string>`(select count(*) from ${users})`,
        totalTeams: sql<string>`(select count(*) from ${teams})`,
        newUsers: sql<string>`(select count(*) from ${users} where ${users.createdAt} >= ${from})`,
      })
      .from(sql`(select 1) as one`),
    buildLossMaking(period),
  ]);

  /* ---- MRR and plan mix ------------------------------------------------ */
  const planMap = new Map<string, PlanBreakdownRow>();
  let mrrMicroUsd = 0;
  let trialing = 0;

  for (const row of subscriptionRows) {
    const monthly = monthlyPriceMicroUsd(row, row.interval);
    if (row.status === 'trialing') trialing += 1;
    else mrrMicroUsd += monthly;

    const entry = planMap.get(row.planId) ?? {
      planId: row.planId,
      planKey: row.planKey,
      planName: row.planName,
      tier: row.tier,
      subscriptions: 0,
      mrrMicroUsd: 0,
    };
    entry.subscriptions += 1;
    if (row.status !== 'trialing') entry.mrrMicroUsd += monthly;
    planMap.set(row.planId, entry);
  }

  const subscriptionRevenueMicroUsd = proratedSubscriptionRevenue(mrrMicroUsd, days);
  const meteredRevenueMicroUsd = usageNow.charged + computeNow.charged;

  const cashCollectedMicroUsd = cash.topupsMicroUsd + cash.invoicesMicroUsd;
  const cashChargeCount = cash.topupCount + cash.invoiceCount;

  const stripeFeesMicroUsd = estimateStripeFees({
    cashMicroUsd: cashCollectedMicroUsd,
    chargeCount: cashChargeCount,
  });

  const margin = grossMargin({
    revenueMicroUsd: subscriptionRevenueMicroUsd + meteredRevenueMicroUsd,
    modelUpstreamMicroUsd: usageNow.upstream,
    computeUpstreamMicroUsd: computeNow.upstream,
    stripeFeesMicroUsd,
  });

  const previousMargin = grossMargin({
    revenueMicroUsd: subscriptionRevenueMicroUsd + usagePrev.charged + computePrev.charged,
    modelUpstreamMicroUsd: usagePrev.upstream,
    computeUpstreamMicroUsd: computePrev.upstream,
    stripeFeesMicroUsd: estimateStripeFees({
      cashMicroUsd: cashPrev.topupsMicroUsd + cashPrev.invoicesMicroUsd,
      chargeCount: cashPrev.topupCount + cashPrev.invoiceCount,
    }),
  });

  const countRow = counts[0];

  return {
    mrrMicroUsd,
    activeSubscriptions: subscriptionRows.length,
    trialingSubscriptions: trialing,
    planBreakdown: [...planMap.values()].sort((a, b) => b.mrrMicroUsd - a.mrrMicroUsd),

    modelChargedMicroUsd: usageNow.charged,
    modelUpstreamMicroUsd: usageNow.upstream,
    computeChargedMicroUsd: computeNow.charged,
    computeUpstreamMicroUsd: computeNow.upstream,
    computeHours: computeNow.hours,
    weightedTokens: usageNow.weighted,

    subscriptionRevenueMicroUsd,
    meteredRevenueMicroUsd,
    cashCollectedMicroUsd,
    cashChargeCount,
    stripeFeesMicroUsd,
    margin,
    previousMargin,

    trend,
    providerCalls: usageNow.calls,
    providerFailures: usageNow.failures,
    providerFailureRate: usageNow.calls > 0 ? usageNow.failures / usageNow.calls : 0,

    openIncidents,
    totalUsers: toNumber(countRow?.totalUsers),
    totalTeams: toNumber(countRow?.totalTeams),
    newUsers: toNumber(countRow?.newUsers),

    lossMaking,
  };
}
