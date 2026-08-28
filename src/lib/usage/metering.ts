import 'server-only';

import { and, eq, gt, gte, lt, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  computeEvents,
  paygBalances,
  plans,
  subscriptions,
  teams,
  usageEvents,
  usagePeriods,
  usageReservations,
  type Plan,
} from '@/lib/db/schema';
import { maybeAutoTopup } from '@/lib/billing/auto-topup';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import {
  type ComputeSettlement,
  type ModelSettlement,
  type PlanPricingConfig,
  type SpendGuardResult,
  checkSpendGuard,
  settleComputeUsage,
  settleModelUsage,
} from '@/lib/pricing/calculator';
import type { TokenCounts, TokenPrices } from '@/lib/pricing/weighted-tokens';
import { SETTING_KEYS, getSetting } from '@/lib/settings';

const log = createLogger('usage');

/**
 * Metering: the single place where usage becomes money.
 *
 * Two invariants:
 *  1. Every AI request and every second of compute produces exactly one event
 *     row, even when the charge is zero (BYOK, demo mode, own server). Usage
 *     you cannot see is usage you cannot trust.
 *  2. Quota, balance and the period rollup move in the same transaction as the
 *     event row, so a crash can never leave a charge without a record or a
 *     record without a charge.
 */

export type BillingContext = {
  teamId: string;
  plan: Plan;
  planPricing: PlanPricingConfig;
  hasActiveSubscription: boolean;
  subscriptionStatus: string | null;
  periodStart: Date;
  periodEnd: Date;
  weightedTokensUsed: number;
  computeHoursUsed: number;
  quotaRemainingWeighted: number;
  quotaRemainingComputeHours: number;
  balanceMicroUsd: number;
  creditLimitMicroUsd: number;
  spendCapMicroUsd: number;
  periodSpendMicroUsd: number;
};

/** Loads everything needed to price and authorise a run, in one round trip set. */
export async function loadBillingContext(teamId: string): Promise<BillingContext> {
  const [teamRow] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!teamRow) throw new Error(`Team ${teamId} not found`);

  const [subRow] = await db
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.teamId, teamId))
    .limit(1);

  const plan = subRow?.plan ?? (await loadPaygPlan());
  const subscription = subRow?.subscription ?? null;

  const { periodStart, periodEnd } = resolvePeriod(
    subscription?.currentPeriodStart ?? null,
    subscription?.currentPeriodEnd ?? null,
  );
  const period = await ensurePeriod(teamId, periodStart, periodEnd);
  const [balance] = await db
    .select()
    .from(paygBalances)
    .where(eq(paygBalances.teamId, teamId))
    .limit(1);

  const hasActiveSubscription =
    Boolean(subscription) &&
    ['active', 'trialing'].includes(subscription?.status ?? '') &&
    plan.tier !== 'payg';

  const planPricing: PlanPricingConfig = {
    tier: plan.tier,
    marginBps: plan.marginBps,
    includedWeightedTokens: plan.includedWeightedTokens,
    includedComputeHours: plan.includedComputeHours,
    overageMicroUsdPerMWeighted: plan.overageMicroUsdPerMWeighted,
    overageMicroUsdPerComputeHour: plan.overageMicroUsdPerComputeHour,
  };

  const defaultCreditLimit = await getSetting<number>(
    SETTING_KEYS.billingPaygCreditLimitMicroUsd,
    0,
  );

  return {
    teamId,
    plan,
    planPricing,
    hasActiveSubscription,
    subscriptionStatus: subscription?.status ?? null,
    periodStart,
    periodEnd,
    weightedTokensUsed: period.weightedTokensUsed,
    computeHoursUsed: period.computeHoursUsed,
    quotaRemainingWeighted: hasActiveSubscription
      ? Math.max(0, plan.includedWeightedTokens - period.weightedTokensUsed)
      : 0,
    quotaRemainingComputeHours: hasActiveSubscription
      ? Math.max(0, plan.includedComputeHours - period.computeHoursUsed)
      : 0,
    balanceMicroUsd: balance?.balanceMicroUsd ?? 0,
    creditLimitMicroUsd: balance?.creditLimitMicroUsd ?? defaultCreditLimit,
    spendCapMicroUsd: teamRow.spendCapMicroUsd,
    periodSpendMicroUsd: period.modelChargedMicroUsd + period.computeChargedMicroUsd,
  };
}

async function loadPaygPlan(): Promise<Plan> {
  const [row] = await db.select().from(plans).where(eq(plans.tier, 'payg')).limit(1);
  if (!row) {
    throw new Error('No pay-as-you-go plan is configured. Run `npm run db:seed`.');
  }
  return row;
}

/**
 * The usage window to meter against.
 *
 * A subscription anchors the window; the calendar month is only the fallback for
 * a team with no subscription at all.
 *
 * The subtlety is what to do when a subscription's stored period has already
 * ended — which happens routinely for the minutes or hours between a renewal
 * and the `customer.subscription.updated` webhook that moves the dates forward.
 * Falling through to the calendar month there **minted a brand-new
 * `usage_periods` row**, and therefore a second full monthly allowance, at every
 * renewal boundary. So instead the stored anchor is rolled forward by whole
 * intervals until it contains `now`, keeping the team on one window per cycle
 * whether or not the webhook has landed yet.
 */
export function resolvePeriod(
  start: Date | null,
  end: Date | null,
): { periodStart: Date; periodEnd: Date } {
  const now = Date.now();

  if (start && end) {
    if (end.getTime() > now) return { periodStart: start, periodEnd: end };

    const length = end.getTime() - start.getTime();
    // A zero or negative length would loop forever; treat it as unusable and
    // fall through to the calendar month below.
    if (length > 0) {
      const elapsed = now - start.getTime();
      const cycles = Math.floor(elapsed / length);
      return {
        periodStart: new Date(start.getTime() + cycles * length),
        periodEnd: new Date(start.getTime() + (cycles + 1) * length),
      };
    }
  }

  const today = new Date(now);
  return {
    periodStart: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    periodEnd: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)),
  };
}

async function ensurePeriod(teamId: string, periodStart: Date, periodEnd: Date) {
  const [existing] = await db
    .select()
    .from(usagePeriods)
    .where(and(eq(usagePeriods.teamId, teamId), eq(usagePeriods.periodStart, periodStart)))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(usagePeriods)
    .values({ id: newId(ID_PREFIX.usageEvent), teamId, periodStart, periodEnd })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [row] = await db
    .select()
    .from(usagePeriods)
    .where(and(eq(usagePeriods.teamId, teamId), eq(usagePeriods.periodStart, periodStart)))
    .limit(1);

  if (!row) throw new Error('Could not create the usage period row.');
  return row;
}

/* ------------------------------------------------------------------ *
 *  Admission
 * ------------------------------------------------------------------ */

/**
 * How long a hold survives without being released.
 *
 * Only a process that dies mid-run leaves a hold behind — every ordinary exit
 * path releases it — so this is the blast radius of a crash, and both directions
 * hurt. Too short and a long run's own hold evaporates while it is still
 * spending, re-opening the race it exists to close. Too long and a crashed run
 * keeps a slice of its team's cap locked away. 30 minutes comfortably outlives
 * the longest plausible run (24 iterations against a 120 s tool timeout, in
 * practice far less) while keeping the worst case to one quiet period.
 */
const HOLD_TTL_MS = 30 * 60 * 1000;

export type BudgetHold = { id: string };

export type ReserveRunBudgetInput = {
  context: BillingContext;
  runId?: string | null;
  estimatedChargeMicroUsd: number;
  estimatedWeightedTokens: number;
};

export type ReserveRunBudgetResult =
  { allowed: true; hold: BudgetHold } | { allowed: false; guard: SpendGuardResult };

/**
 * Decides whether a run may start, and if so holds its estimated cost.
 *
 * The spend guard on its own reads `usage_periods`, which only moves when a run
 * *finishes*. That makes it blind to the question it is actually being asked:
 * counting everything already in flight, can this team afford one more run?
 * Ten runs started in the same second each saw the same un-debited counters,
 * each concluded there was room, and the team sailed through its spending cap
 * and PAYG credit limit by a factor of ten. Serialising the check alone would
 * not have helped — the counters do not move until settlement, so ten *ordered*
 * checks still read the same numbers.
 *
 * So admission takes a row in `usage_reservations` and the guard is evaluated
 * against `settled + held + this estimate`. Concurrent admissions for one team
 * serialise on the period row, so the second caller sees the first caller's hold.
 *
 * The hold is deliberately *not* drawn down as the run spends: for its lifetime
 * a run counts as both its full estimate and its actual usage so far. That
 * over-counts, which can only ever deny a borderline run that might have fit —
 * the safe direction for a limit whose whole purpose is to be a hard stop.
 */
export async function reserveRunBudget(
  input: ReserveRunBudgetInput,
): Promise<ReserveRunBudgetResult> {
  const ctx = input.context;
  const now = new Date();

  const decide = (heldMicroUsd: number, heldWeighted: number): SpendGuardResult =>
    checkSpendGuard({
      estimatedChargeMicroUsd: input.estimatedChargeMicroUsd,
      // Money already promised to in-flight runs is money this run cannot have.
      balanceMicroUsd: ctx.balanceMicroUsd - heldMicroUsd,
      creditLimitMicroUsd: ctx.creditLimitMicroUsd,
      quotaRemainingWeighted: Math.max(0, ctx.quotaRemainingWeighted - heldWeighted),
      estimatedWeightedTokens: input.estimatedWeightedTokens,
      spendCapMicroUsd: ctx.spendCapMicroUsd,
      periodSpendMicroUsd: ctx.periodSpendMicroUsd + heldMicroUsd,
      hasActiveSubscription: ctx.hasActiveSubscription,
      subscriptionStatus: ctx.subscriptionStatus ?? undefined,
    });

  try {
    return await db.transaction(async (tx) => {
      // Lock the period row so concurrent admissions for this team queue up here
      // and each one observes the holds taken by the callers ahead of it.
      // `loadBillingContext` has already created the row via `ensurePeriod`.
      const [periodRow] = await tx
        .select({ id: usagePeriods.id })
        .from(usagePeriods)
        .where(
          and(
            eq(usagePeriods.teamId, ctx.teamId),
            eq(usagePeriods.periodStart, ctx.periodStart),
          ),
        )
        .for('update')
        .limit(1);

      if (!periodRow) {
        // Nothing to serialise on. Denying here would break runs over a missing
        // rollup row, so fall back to the un-serialised guard: no worse than the
        // behaviour this function replaces.
        log.warn('No usage period row to lock; admitting without a hold', {
          teamId: ctx.teamId,
        });
        const guard = decide(0, 0);
        return guard.allowed
          ? { allowed: true as const, hold: { id: '' } }
          : { allowed: false as const, guard };
      }

      // Sweep this team's dead holds. Deliberately *not* narrowed to the current
      // period: an expired hold is unusable whatever period it belongs to, and
      // narrowing it would strand every row a crashed run left in an earlier
      // period, since nothing would ever match them again. Still scoped to one
      // team, so this DELETE can never take locks that deadlock against another
      // team's admission.
      await tx
        .delete(usageReservations)
        .where(
          and(eq(usageReservations.teamId, ctx.teamId), lt(usageReservations.expiresAt, now)),
        );

      const [held] = await tx
        .select({
          microUsd: sql<string>`coalesce(sum(${usageReservations.microUsd}), 0)`,
          weightedTokens: sql<string>`coalesce(sum(${usageReservations.weightedTokens}), 0)`,
        })
        .from(usageReservations)
        .where(
          and(
            eq(usageReservations.teamId, ctx.teamId),
            eq(usageReservations.periodStart, ctx.periodStart),
            gt(usageReservations.expiresAt, now),
          ),
        );

      const guard = decide(Number(held?.microUsd ?? 0), Number(held?.weightedTokens ?? 0));
      if (!guard.allowed) return { allowed: false as const, guard };

      const id = newId(ID_PREFIX.usageReservation);
      await tx.insert(usageReservations).values({
        id,
        teamId: ctx.teamId,
        periodStart: ctx.periodStart,
        runId: input.runId ?? null,
        weightedTokens: Math.max(0, Math.round(input.estimatedWeightedTokens)),
        microUsd: Math.max(0, Math.round(input.estimatedChargeMicroUsd)),
        expiresAt: new Date(now.getTime() + HOLD_TTL_MS),
      });

      return { allowed: true as const, hold: { id } };
    });
  } catch (error) {
    // A metering outage must not become an outage of the product. Admitting on
    // the un-serialised guard restores exactly the previous behaviour, which is
    // weaker than this one but not weaker than shipping nothing.
    log.error('Could not reserve run budget; falling back to the plain guard', {
      teamId: ctx.teamId,
      error: String(error),
    });
    const guard = decide(0, 0);
    return guard.allowed ? { allowed: true, hold: { id: '' } } : { allowed: false, guard };
  }
}

/**
 * Refills the balance if the team asked for that and this charge took them under
 * their threshold.
 *
 * Settlement is the only moment the platform knows a balance just moved, so it
 * is the natural trigger — the cron sweep exists for the opposite case, a team
 * that has already run dry and therefore meters nothing. Cheap to call: the
 * ordinary path is one indexed read and no writes, and it never throws.
 *
 * The in-memory context is updated on success because a run in flight keeps
 * checking `balanceMicroUsd` between iterations. Leaving it stale would stop the
 * very run whose charge triggered the top-up, on the grounds that it could not
 * afford the money it now has.
 */
async function refillAfterCharge(
  context: BillingContext,
  chargedMicroUsd: number,
): Promise<void> {
  if (chargedMicroUsd <= 0) return;

  const outcome = await maybeAutoTopup(context.teamId);
  if (outcome.status === 'charged') {
    context.balanceMicroUsd += outcome.amountMicroUsd;
  }
}

/** Gives a hold back. Safe to call with a hold that was never really taken. */
export async function releaseRunBudget(hold: BudgetHold | null | undefined): Promise<void> {
  if (!hold?.id) return;
  try {
    await db.delete(usageReservations).where(eq(usageReservations.id, hold.id));
  } catch (error) {
    // The hold expires on its own, so a failure here costs the team a little
    // headroom for a while rather than anything permanent.
    log.error('Could not release run budget hold', { holdId: hold.id, error: String(error) });
  }
}

/* ------------------------------------------------------------------ *
 *  Recording
 * ------------------------------------------------------------------ */

export type RecordModelUsageInput = {
  context: BillingContext;
  userId: string;
  projectId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  runId?: string | null;
  providerKey: string;
  modelId: string | null;
  modelSlug: string;
  modelPriceId?: string | null;
  counts: TokenCounts;
  prices: TokenPrices;
  usedByok: boolean;
  latencyMs: number;
  status?: 'success' | 'error' | 'cancelled';
  errorCode?: string | null;
};

export async function recordModelUsage(input: RecordModelUsageInput): Promise<ModelSettlement> {
  const settlement = settleModelUsage({
    counts: input.counts,
    prices: input.prices,
    plan: input.context.planPricing,
    quotaRemainingWeighted: input.context.quotaRemainingWeighted,
    usedByok: input.usedByok,
    hasActiveSubscription: input.context.hasActiveSubscription,
  });

  // A failed request must never be charged, but it is still recorded so the
  // provider-failure rate is visible in the admin dashboard.
  const charged = input.status === 'error' ? 0 : settlement.chargedMicroUsd;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(usageEvents).values({
        id: newId(ID_PREFIX.usageEvent),
        teamId: input.context.teamId,
        userId: input.userId,
        projectId: input.projectId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        runId: input.runId ?? null,
        kind: 'model',
        providerKey: input.providerKey,
        modelId: input.modelId,
        modelSlug: input.modelSlug,
        modelPriceId: input.modelPriceId ?? null,
        inputTokens: input.counts.inputTokens,
        outputTokens: input.counts.outputTokens,
        cachedInputTokens: input.counts.cachedInputTokens ?? 0,
        cacheWriteTokens: input.counts.cacheWriteTokens ?? 0,
        weightedTokens: settlement.weightedTokens,
        outputMultiplier:
          input.prices.inputMicroUsdPerMtok > 0
            ? input.prices.outputMicroUsdPerMtok / input.prices.inputMicroUsdPerMtok
            : 4,
        upstreamCostMicroUsd: settlement.upstreamCostMicroUsd,
        chargedMicroUsd: charged,
        grossMarginMicroUsd: charged - settlement.upstreamCostMicroUsd,
        settlement: settlement.settlement,
        usedByok: input.usedByok,
        latencyMs: input.latencyMs,
        status: input.status ?? 'success',
        errorCode: input.errorCode ?? null,
      });

      if (input.status === 'error') return;

      await tx
        .update(usagePeriods)
        .set({
          weightedTokensUsed: sql`${usagePeriods.weightedTokensUsed} + ${settlement.quotaConsumed}`,
          modelChargedMicroUsd: sql`${usagePeriods.modelChargedMicroUsd} + ${charged}`,
          upstreamCostMicroUsd: sql`${usagePeriods.upstreamCostMicroUsd} + ${settlement.upstreamCostMicroUsd}`,
          overageMicroUsd: sql`${usagePeriods.overageMicroUsd} + ${settlement.overageWeighted > 0 ? charged : 0}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(usagePeriods.teamId, input.context.teamId),
            eq(usagePeriods.periodStart, input.context.periodStart),
          ),
        );

      if (charged > 0) {
        await tx
          .update(paygBalances)
          .set({
            balanceMicroUsd: sql`${paygBalances.balanceMicroUsd} - ${charged}`,
            lifetimeSpentMicroUsd: sql`${paygBalances.lifetimeSpentMicroUsd} + ${charged}`,
            updatedAt: new Date(),
          })
          .where(eq(paygBalances.teamId, input.context.teamId));
      }
    });

    // Keep the in-memory context truthful for the rest of this run.
    input.context.quotaRemainingWeighted = Math.max(
      0,
      input.context.quotaRemainingWeighted - settlement.quotaConsumed,
    );
    input.context.balanceMicroUsd -= charged;
    input.context.periodSpendMicroUsd += charged;

    await refillAfterCharge(input.context, charged);
  } catch (error) {
    // Metering must not take down a run that already succeeded for the user.
    log.error('Failed to record model usage', { error: String(error) });
  }

  return { ...settlement, chargedMicroUsd: charged };
}

export type RecordComputeUsageInput = {
  context: BillingContext;
  userId?: string | null;
  projectId?: string | null;
  sandboxId: string;
  sandboxSessionId?: string | null;
  providerKey: string;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  computeMultiplier: number;
  startedAt: Date;
  stoppedAt: Date;
  activeSeconds: number;
  isOwnServer?: boolean;
  upstreamMicroUsdPerBaseHour: number;
};

export async function recordComputeUsage(
  input: RecordComputeUsageInput,
): Promise<ComputeSettlement> {
  const billedHours =
    Math.round((input.activeSeconds / 3600) * input.computeMultiplier * 10_000) / 10_000;

  const settlement = settleComputeUsage({
    billedComputeHours: billedHours,
    upstreamMicroUsdPerBaseHour: input.upstreamMicroUsdPerBaseHour,
    plan: input.context.planPricing,
    quotaRemainingHours: input.context.quotaRemainingComputeHours,
    hasActiveSubscription: input.context.hasActiveSubscription,
    isOwnServer: input.isOwnServer,
  });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(computeEvents).values({
        id: newId(ID_PREFIX.computeEvent),
        teamId: input.context.teamId,
        userId: input.userId ?? null,
        projectId: input.projectId ?? null,
        sandboxId: input.sandboxId,
        sandboxSessionId: input.sandboxSessionId ?? null,
        providerKey: input.providerKey,
        cpuCores: input.cpuCores,
        memoryMb: input.memoryMb,
        diskGb: input.diskGb,
        computeMultiplier: input.computeMultiplier,
        startedAt: input.startedAt,
        stoppedAt: input.stoppedAt,
        activeSeconds: input.activeSeconds,
        billedComputeHours: settlement.billedComputeHours,
        upstreamCostMicroUsd: settlement.upstreamCostMicroUsd,
        chargedMicroUsd: settlement.chargedMicroUsd,
        grossMarginMicroUsd: settlement.grossMarginMicroUsd,
        settlement: settlement.settlement,
      });

      await tx
        .update(usagePeriods)
        .set({
          computeHoursUsed: sql`${usagePeriods.computeHoursUsed} + ${settlement.quotaConsumedHours}`,
          computeChargedMicroUsd: sql`${usagePeriods.computeChargedMicroUsd} + ${settlement.chargedMicroUsd}`,
          upstreamCostMicroUsd: sql`${usagePeriods.upstreamCostMicroUsd} + ${settlement.upstreamCostMicroUsd}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(usagePeriods.teamId, input.context.teamId),
            eq(usagePeriods.periodStart, input.context.periodStart),
          ),
        );

      if (settlement.chargedMicroUsd > 0) {
        await tx
          .update(paygBalances)
          .set({
            balanceMicroUsd: sql`${paygBalances.balanceMicroUsd} - ${settlement.chargedMicroUsd}`,
            lifetimeSpentMicroUsd: sql`${paygBalances.lifetimeSpentMicroUsd} + ${settlement.chargedMicroUsd}`,
            updatedAt: new Date(),
          })
          .where(eq(paygBalances.teamId, input.context.teamId));
      }
    });

    input.context.quotaRemainingComputeHours = Math.max(
      0,
      input.context.quotaRemainingComputeHours - settlement.quotaConsumedHours,
    );
    input.context.balanceMicroUsd -= settlement.chargedMicroUsd;

    await refillAfterCharge(input.context, settlement.chargedMicroUsd);
  } catch (error) {
    log.error('Failed to record compute usage', { error: String(error) });
  }

  return settlement;
}

/* ------------------------------------------------------------------ *
 *  Reporting
 * ------------------------------------------------------------------ */

export type DailyUsagePoint = {
  date: string;
  weightedTokens: number;
  computeHours: number;
  chargedMicroUsd: number;
  upstreamCostMicroUsd: number;
  requests: number;
};

export async function getDailyUsage(teamId: string, since: Date): Promise<DailyUsagePoint[]> {
  const modelRows = await db
    .select({
      date: sql<string>`to_char(${usageEvents.occurredAt}, 'YYYY-MM-DD')`,
      weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
      chargedMicroUsd: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      upstreamCostMicroUsd: sql<number>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)::bigint`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.teamId, teamId), gte(usageEvents.occurredAt, since)))
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
    .where(and(eq(computeEvents.teamId, teamId), gte(computeEvents.occurredAt, since)))
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

export async function getUsageByModel(teamId: string, since: Date) {
  return db
    .select({
      modelSlug: usageEvents.modelSlug,
      weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
      chargedMicroUsd: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.teamId, teamId), gte(usageEvents.occurredAt, since)))
    .groupBy(usageEvents.modelSlug)
    .orderBy(sql`2 desc`)
    .limit(12);
}

export async function getUsageByProject(teamId: string, since: Date) {
  return db
    .select({
      projectId: usageEvents.projectId,
      weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
      chargedMicroUsd: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      requests: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.teamId, teamId), gte(usageEvents.occurredAt, since)))
    .groupBy(usageEvents.projectId)
    .orderBy(sql`2 desc`)
    .limit(12);
}

/**
 * Straight-line projection of period spend. Deliberately simple — a fancier
 * model would look more precise than the data justifies.
 */
export function projectPeriodTotal(
  used: number,
  periodStart: Date,
  periodEnd: Date,
  now = new Date(),
): number {
  const elapsed = now.getTime() - periodStart.getTime();
  const total = periodEnd.getTime() - periodStart.getTime();
  if (elapsed <= 0 || total <= 0) return used;
  const fraction = Math.min(1, elapsed / total);
  if (fraction < 0.05) return used;
  return Math.round(used / fraction);
}
