import 'server-only';

import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  computeEvents,
  models,
  modelPrices,
  plans,
  providers,
  subscriptions,
  teams,
  usageEvents,
} from '@/lib/db/schema';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';

import { monthlyPriceMicroUsd, proratedSubscriptionRevenue } from './finance';
import { toNumber, type Period } from './period';

/**
 * Unit economics.
 *
 * The question this page answers is "which of these lines actually makes
 * money?" — so every row carries upstream cost, what was charged, and the
 * margin between them rather than a single blended number that hides the one
 * loss-making model.
 */

export type ModelEconomics = {
  modelId: string | null;
  modelSlug: string;
  displayName: string;
  providerKey: string;
  calls: number;
  weightedTokens: number;
  inputTokens: number;
  outputTokens: number;
  upstreamMicroUsd: number;
  chargedMicroUsd: number;
  marginMicroUsd: number;
  marginFraction: number | null;
  /** Upstream cost of one million weighted tokens, as actually observed. */
  upstreamPerMWeighted: number;
};

export type TierEconomics = {
  tier: string;
  label: string;
  teams: number;
  subscriptionRevenueMicroUsd: number;
  meteredChargedMicroUsd: number;
  revenueMicroUsd: number;
  modelUpstreamMicroUsd: number;
  computeUpstreamMicroUsd: number;
  upstreamMicroUsd: number;
  marginMicroUsd: number;
  marginFraction: number | null;
};

export type ComputeEconomics = {
  providerKey: string;
  hours: number;
  upstreamMicroUsd: number;
  chargedMicroUsd: number;
  marginMicroUsd: number;
  marginFraction: number | null;
};

export type BreakEvenRow = {
  planId: string;
  planKey: string;
  planName: string;
  tier: string;
  priceMicroUsdMonthly: number;
  includedWeightedTokens: number;
  includedComputeHours: number;
  /** Upstream cost if a subscriber consumed the entire allowance. */
  fullAllowanceCostMicroUsd: number;
  marginAtFullAllowanceMicroUsd: number;
  /** Weighted tokens at which the plan's monthly price is exactly consumed. */
  breakEvenWeightedTokens: number;
  /** Break-even expressed as a share of the included allowance. */
  breakEvenFractionOfAllowance: number | null;
  /** Compute hours at break-even when the subscriber only ran sandboxes. */
  breakEvenComputeHours: number;
  verdict: 'healthy' | 'thin' | 'loss';
};

export type CostsData = {
  blendedUpstreamPerMWeighted: number;
  computeUpstreamPerBaseHour: number;
  byModel: ModelEconomics[];
  byTier: TierEconomics[];
  compute: ComputeEconomics[];
  breakEven: BreakEvenRow[];
  totals: {
    revenueMicroUsd: number;
    upstreamMicroUsd: number;
    marginMicroUsd: number;
    marginFraction: number | null;
  };
};

function fraction(margin: number, revenue: number): number | null {
  return revenue > 0 ? margin / revenue : null;
}

/**
 * Blended upstream cost per million weighted tokens. Observed usage is the
 * truth when it exists; otherwise the current price list is the best estimate
 * available, which keeps the break-even table useful on a fresh install.
 */
async function blendedUpstreamRate(observed: {
  weighted: number;
  upstream: number;
}): Promise<number> {
  if (observed.weighted > 0) {
    return Math.round((observed.upstream / observed.weighted) * 1_000_000);
  }

  const rows = await db
    .select({ input: modelPrices.inputMicroUsdPerMtok })
    .from(modelPrices)
    .innerJoin(models, eq(models.id, modelPrices.modelId))
    .where(and(isNull(modelPrices.effectiveTo), eq(models.isEnabled, true)))
    .orderBy(asc(modelPrices.inputMicroUsdPerMtok));

  if (rows.length === 0) return 0;
  const middle = rows[Math.floor(rows.length / 2)];
  return middle?.input ?? 0;
}

export async function loadCosts(period: Period): Promise<CostsData> {
  const { from, to, days } = period;
  const window = and(gte(usageEvents.occurredAt, from), lte(usageEvents.occurredAt, to));
  const computeWindow = and(
    gte(computeEvents.occurredAt, from),
    lte(computeEvents.occurredAt, to),
  );

  const [
    modelRows,
    computeRows,
    teamUsage,
    teamCompute,
    subscribedTeams,
    planRows,
    computeUpstreamPerBaseHour,
  ] = await Promise.all([
    db
      .select({
        modelId: usageEvents.modelId,
        modelSlug: usageEvents.modelSlug,
        providerKey: usageEvents.providerKey,
        displayName: models.displayName,
        calls: sql<string>`count(*)`,
        weighted: sql<string>`coalesce(sum(${usageEvents.weightedTokens}), 0)`,
        input: sql<string>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
        output: sql<string>`coalesce(sum(${usageEvents.outputTokens}), 0)`,
        upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
        charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
      })
      .from(usageEvents)
      .leftJoin(models, eq(models.id, usageEvents.modelId))
      .where(window)
      .groupBy(
        usageEvents.modelId,
        usageEvents.modelSlug,
        usageEvents.providerKey,
        models.displayName,
      ),
    db
      .select({
        providerKey: computeEvents.providerKey,
        hours: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
        upstream: sql<string>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)`,
        charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
      })
      .from(computeEvents)
      .where(computeWindow)
      .groupBy(computeEvents.providerKey),
    db
      .select({
        teamId: usageEvents.teamId,
        upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
        charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
      })
      .from(usageEvents)
      .where(window)
      .groupBy(usageEvents.teamId),
    db
      .select({
        teamId: computeEvents.teamId,
        upstream: sql<string>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)`,
        charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
      })
      .from(computeEvents)
      .where(computeWindow)
      .groupBy(computeEvents.teamId),
    // Every live subscriber, not only the ones that ran something. The same
    // set backs the overview page's MRR, so the two tabs agree on revenue.
    db
      .select({ teamId: subscriptions.teamId })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ['active', 'trialing'])),
    db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder)),
    getSetting(
      SETTING_KEYS.computeUpstreamMicroUsdPerBaseHour,
      settingDefault(SETTING_KEYS.computeUpstreamMicroUsdPerBaseHour),
    ),
  ]);

  const byModel: ModelEconomics[] = modelRows
    .map((row) => {
      const upstream = toNumber(row.upstream);
      const charged = toNumber(row.charged);
      const weighted = toNumber(row.weighted);
      return {
        modelId: row.modelId,
        modelSlug: row.modelSlug || 'unknown',
        displayName: row.displayName ?? row.modelSlug ?? 'Unknown model',
        providerKey: row.providerKey,
        calls: toNumber(row.calls),
        weightedTokens: weighted,
        inputTokens: toNumber(row.input),
        outputTokens: toNumber(row.output),
        upstreamMicroUsd: upstream,
        chargedMicroUsd: charged,
        marginMicroUsd: charged - upstream,
        marginFraction: fraction(charged - upstream, charged),
        upstreamPerMWeighted: weighted > 0 ? Math.round((upstream / weighted) * 1_000_000) : 0,
      };
    })
    .sort((a, b) => b.upstreamMicroUsd - a.upstreamMicroUsd);

  const compute: ComputeEconomics[] = computeRows
    .map((row) => {
      const upstream = toNumber(row.upstream);
      const charged = toNumber(row.charged);
      return {
        providerKey: row.providerKey,
        hours: toNumber(row.hours),
        upstreamMicroUsd: upstream,
        chargedMicroUsd: charged,
        marginMicroUsd: charged - upstream,
        marginFraction: fraction(charged - upstream, charged),
      };
    })
    .sort((a, b) => b.upstreamMicroUsd - a.upstreamMicroUsd);

  /* ---- Per plan tier --------------------------------------------------- */
  type TeamAcc = { modelUpstream: number; computeUpstream: number; charged: number };
  const teamAcc = new Map<string, TeamAcc>();
  const ensure = (teamId: string): TeamAcc => {
    const found = teamAcc.get(teamId);
    if (found) return found;
    const fresh: TeamAcc = { modelUpstream: 0, computeUpstream: 0, charged: 0 };
    teamAcc.set(teamId, fresh);
    return fresh;
  };
  // An idle subscriber still pays, so the tier rollup starts from every team
  // holding a subscription. Building the set from usage alone booked those
  // teams at zero revenue and left them out of the per-tier team counts.
  for (const row of subscribedTeams) ensure(row.teamId);

  for (const row of teamUsage) {
    const acc = ensure(row.teamId);
    acc.modelUpstream += toNumber(row.upstream);
    acc.charged += toNumber(row.charged);
  }
  for (const row of teamCompute) {
    const acc = ensure(row.teamId);
    acc.computeUpstream += toNumber(row.upstream);
    acc.charged += toNumber(row.charged);
  }

  const teamIds = [...teamAcc.keys()];
  const teamMeta =
    teamIds.length > 0
      ? await db
          .select({
            id: teams.id,
            tier: plans.tier,
            planName: plans.name,
            status: subscriptions.status,
            interval: subscriptions.interval,
            priceMicroUsdMonthly: plans.priceMicroUsdMonthly,
            priceMicroUsdYearly: plans.priceMicroUsdYearly,
          })
          .from(teams)
          .leftJoin(subscriptions, eq(subscriptions.teamId, teams.id))
          .leftJoin(plans, eq(plans.id, subscriptions.planId))
          .where(inArray(teams.id, teamIds))
      : [];

  const tierAcc = new Map<string, TierEconomics>();
  for (const meta of teamMeta) {
    const acc = teamAcc.get(meta.id);
    if (!acc) continue;
    const tier = meta.tier ?? 'payg';
    const entry = tierAcc.get(tier) ?? {
      tier,
      label: meta.planName ?? 'Pay as you go',
      teams: 0,
      subscriptionRevenueMicroUsd: 0,
      meteredChargedMicroUsd: 0,
      revenueMicroUsd: 0,
      modelUpstreamMicroUsd: 0,
      computeUpstreamMicroUsd: 0,
      upstreamMicroUsd: 0,
      marginMicroUsd: 0,
      marginFraction: null,
    };

    const monthly =
      meta.status === 'active' || meta.status === 'trialing'
        ? monthlyPriceMicroUsd(
            {
              priceMicroUsdMonthly: meta.priceMicroUsdMonthly ?? 0,
              priceMicroUsdYearly: meta.priceMicroUsdYearly ?? 0,
            },
            meta.interval ?? 'month',
          )
        : 0;

    entry.teams += 1;
    entry.subscriptionRevenueMicroUsd += proratedSubscriptionRevenue(monthly, days);
    entry.meteredChargedMicroUsd += acc.charged;
    entry.modelUpstreamMicroUsd += acc.modelUpstream;
    entry.computeUpstreamMicroUsd += acc.computeUpstream;
    tierAcc.set(tier, entry);
  }

  const byTier = [...tierAcc.values()]
    .map((row) => {
      const revenue = row.subscriptionRevenueMicroUsd + row.meteredChargedMicroUsd;
      const upstream = row.modelUpstreamMicroUsd + row.computeUpstreamMicroUsd;
      return {
        ...row,
        revenueMicroUsd: revenue,
        upstreamMicroUsd: upstream,
        marginMicroUsd: revenue - upstream,
        marginFraction: fraction(revenue - upstream, revenue),
      };
    })
    .sort((a, b) => b.revenueMicroUsd - a.revenueMicroUsd);

  /* ---- Break-even ------------------------------------------------------ */
  const observedWeighted = byModel.reduce((sum, m) => sum + m.weightedTokens, 0);
  const observedUpstream = byModel.reduce((sum, m) => sum + m.upstreamMicroUsd, 0);
  const blendedUpstreamPerMWeighted = await blendedUpstreamRate({
    weighted: observedWeighted,
    upstream: observedUpstream,
  });

  const breakEven: BreakEvenRow[] = planRows
    .filter((plan) => plan.priceMicroUsdMonthly > 0)
    .map((plan) => {
      const tokenCost = Math.round(
        (plan.includedWeightedTokens / 1_000_000) * blendedUpstreamPerMWeighted,
      );
      const computeCost = Math.round(plan.includedComputeHours * computeUpstreamPerBaseHour);
      const fullCost = tokenCost + computeCost;
      const margin = plan.priceMicroUsdMonthly - fullCost;

      const breakEvenWeightedTokens =
        blendedUpstreamPerMWeighted > 0
          ? Math.round((plan.priceMicroUsdMonthly / blendedUpstreamPerMWeighted) * 1_000_000)
          : 0;

      const breakEvenComputeHours =
        computeUpstreamPerBaseHour > 0
          ? plan.priceMicroUsdMonthly / computeUpstreamPerBaseHour
          : 0;

      const marginRatio =
        plan.priceMicroUsdMonthly > 0 ? margin / plan.priceMicroUsdMonthly : 0;

      return {
        planId: plan.id,
        planKey: plan.key,
        planName: plan.name,
        tier: plan.tier,
        priceMicroUsdMonthly: plan.priceMicroUsdMonthly,
        includedWeightedTokens: plan.includedWeightedTokens,
        includedComputeHours: plan.includedComputeHours,
        fullAllowanceCostMicroUsd: fullCost,
        marginAtFullAllowanceMicroUsd: margin,
        breakEvenWeightedTokens,
        breakEvenFractionOfAllowance:
          plan.includedWeightedTokens > 0
            ? breakEvenWeightedTokens / plan.includedWeightedTokens
            : null,
        breakEvenComputeHours,
        verdict: margin < 0 ? 'loss' : marginRatio < 0.2 ? 'thin' : 'healthy',
      };
    });

  const totalRevenue = byTier.reduce((sum, t) => sum + t.revenueMicroUsd, 0);
  const totalUpstream = byTier.reduce((sum, t) => sum + t.upstreamMicroUsd, 0);

  return {
    blendedUpstreamPerMWeighted,
    computeUpstreamPerBaseHour,
    byModel,
    byTier,
    compute,
    breakEven,
    totals: {
      revenueMicroUsd: totalRevenue,
      upstreamMicroUsd: totalUpstream,
      marginMicroUsd: totalRevenue - totalUpstream,
      marginFraction: fraction(totalRevenue - totalUpstream, totalRevenue),
    },
  };
}

/** Provider keys with their display names, for the compute economics table. */
export async function providerLabels(): Promise<Map<string, string>> {
  const rows = await db.select({ key: providers.key, name: providers.name }).from(providers);
  return new Map(rows.map((r) => [r.key, r.name]));
}
