import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/lib/db';
import {
  paygBalances,
  plans,
  projects,
  subscriptions,
  teamMembers,
  teams,
  usageEvents,
  usagePeriods,
  users,
} from '@/lib/db/schema';
import { newId } from '@/lib/ids';
import type { TokenPrices } from '@/lib/pricing/weighted-tokens';
import {
  loadBillingContext,
  recordComputeUsage,
  recordModelUsage,
  projectPeriodTotal,
} from '@/lib/usage/metering';

/**
 * Metering integration tests.
 *
 * These run against a real Postgres because the thing under test *is* the
 * database transaction: an event row, a period rollup and a balance movement
 * either all land or none do. Mocking the driver would test nothing.
 *
 * Set DATABASE_URL to a throwaway database — the suite creates its own rows
 * under a unique team and removes them afterwards, but it is not something to
 * point at production.
 */

const SONNET: TokenPrices = {
  inputMicroUsdPerMtok: 600_000,
  outputMicroUsdPerMtok: 3_000_000,
  cachedInputMicroUsdPerMtok: 60_000,
  cacheWriteMicroUsdPerMtok: 750_000,
};

let reachable = false;
const ids = {
  user: newId('user'),
  team: newId('team'),
  proPlan: newId('plan'),
  paygPlan: newId('plan'),
  project: newId('project'),
};

beforeAll(async () => {
  try {
    await pg`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  await db.insert(users).values({
    id: ids.user,
    email: `metering-${ids.user}@karo.test`,
    name: 'Metering Fixture',
    emailVerifiedAt: new Date(),
  });

  await db.insert(teams).values({
    id: ids.team,
    name: 'Metering Fixture Team',
    slug: `metering-${ids.team.slice(-8)}`,
    ownerId: ids.user,
  });

  await db.insert(teamMembers).values({
    id: newId('teamMember'),
    teamId: ids.team,
    userId: ids.user,
    role: 'owner',
  });

  // Pay-as-you-go must exist: loadBillingContext falls back to it when a team
  // has no subscription, and throws a helpful error if it is missing.
  await db
    .insert(plans)
    .values({
      id: ids.paygPlan,
      key: `payg-fixture-${ids.paygPlan.slice(-6)}`,
      tier: 'payg',
      name: 'PAYG Fixture',
      marginBps: 2_000,
    })
    .onConflictDoNothing();

  await db.insert(plans).values({
    id: ids.proPlan,
    key: `pro-fixture-${ids.proPlan.slice(-6)}`,
    tier: 'pro',
    name: 'Pro Fixture',
    marginBps: 2_000,
    includedWeightedTokens: 100_000,
    includedComputeHours: 10,
    overageMicroUsdPerMWeighted: 4_000_000,
    overageMicroUsdPerComputeHour: 15_000,
  });

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 86_400_000);

  await db.insert(subscriptions).values({
    id: newId('subscription'),
    teamId: ids.team,
    planId: ids.proPlan,
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
  });

  await db.insert(paygBalances).values({
    id: newId('paygBalance'),
    teamId: ids.team,
    balanceMicroUsd: 10_000_000, // $10
  });

  await db.insert(projects).values({
    id: ids.project,
    teamId: ids.team,
    createdById: ids.user,
    name: 'Metering Fixture Project',
    slug: 'metering-fixture',
  });
});

afterAll(async () => {
  if (!reachable) return;
  // Cascades clear usage_events, usage_periods, subscriptions and balances.
  await db.delete(teams).where(eq(teams.id, ids.team));
  await db.delete(users).where(eq(users.id, ids.user));
  await db.delete(plans).where(eq(plans.id, ids.proPlan));
  await pg.end({ timeout: 5 });
});

describe.runIf(process.env.SKIP_DB_TESTS !== '1')('metering against a real database', () => {
  it('is connected — otherwise these assertions prove nothing', () => {
    expect(reachable, 'DATABASE_URL is not reachable; start Postgres first').toBe(true);
  });

  it('loads a billing context that reflects the subscription', async () => {
    const context = await loadBillingContext(ids.team);
    expect(context.teamId).toBe(ids.team);
    expect(context.hasActiveSubscription).toBe(true);
    expect(context.plan.tier).toBe('pro');
    expect(context.quotaRemainingWeighted).toBe(100_000);
    expect(context.quotaRemainingComputeHours).toBe(10);
    expect(context.balanceMicroUsd).toBe(10_000_000);
  });

  it('records a within-quota request without charging the balance', async () => {
    const context = await loadBillingContext(ids.team);
    const balanceBefore = context.balanceMicroUsd;

    const settlement = await recordModelUsage({
      context,
      userId: ids.user,
      projectId: ids.project,
      providerKey: 'omniakey',
      modelId: null,
      modelSlug: 'claude-sonnet-5',
      counts: { inputTokens: 10_000, outputTokens: 2_000 },
      prices: SONNET,
      usedByok: false,
      latencyMs: 1_200,
    });

    expect(settlement.weightedTokens).toBe(20_000);
    expect(settlement.settlement).toBe('quota');
    expect(settlement.chargedMicroUsd).toBe(0);

    // The in-memory context is kept truthful for the rest of the run.
    expect(context.quotaRemainingWeighted).toBe(80_000);
    expect(context.balanceMicroUsd).toBe(balanceBefore);

    const reloaded = await loadBillingContext(ids.team);
    expect(reloaded.weightedTokensUsed).toBe(20_000);
    expect(reloaded.quotaRemainingWeighted).toBe(80_000);
    expect(reloaded.balanceMicroUsd).toBe(balanceBefore);
  });

  it('writes exactly one usage event per recorded request', async () => {
    const before = await db.select().from(usageEvents).where(eq(usageEvents.teamId, ids.team));

    const context = await loadBillingContext(ids.team);
    await recordModelUsage({
      context,
      userId: ids.user,
      projectId: ids.project,
      providerKey: 'omniakey',
      modelId: null,
      modelSlug: 'claude-sonnet-5',
      counts: { inputTokens: 1_000, outputTokens: 100 },
      prices: SONNET,
      usedByok: false,
      latencyMs: 800,
    });

    const after = await db.select().from(usageEvents).where(eq(usageEvents.teamId, ids.team));

    expect(after.length).toBe(before.length + 1);

    const newest = after.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0]!;
    expect(newest.weightedTokens).toBe(1_500);
    expect(newest.inputTokens).toBe(1_000);
    expect(newest.outputTokens).toBe(100);
    expect(newest.upstreamCostMicroUsd).toBeGreaterThan(0);
  });

  it('debits the balance and rolls up the period when a request overflows quota', async () => {
    const context = await loadBillingContext(ids.team);
    const balanceBefore = context.balanceMicroUsd;
    const remaining = context.quotaRemainingWeighted;

    // Deliberately request more weighted tokens than remain.
    const inputTokens = remaining + 50_000;
    const settlement = await recordModelUsage({
      context,
      userId: ids.user,
      projectId: ids.project,
      providerKey: 'omniakey',
      modelId: null,
      modelSlug: 'claude-sonnet-5',
      counts: { inputTokens, outputTokens: 0 },
      prices: SONNET,
      usedByok: false,
      latencyMs: 4_000,
    });

    expect(settlement.quotaConsumed).toBe(remaining);
    expect(settlement.overageWeighted).toBe(50_000);
    expect(settlement.chargedMicroUsd).toBe(200_000); // 50k weighted at $4/M

    const reloaded = await loadBillingContext(ids.team);
    expect(reloaded.quotaRemainingWeighted).toBe(0);
    expect(reloaded.balanceMicroUsd).toBe(balanceBefore - 200_000);

    const [period] = await db
      .select()
      .from(usagePeriods)
      .where(eq(usagePeriods.teamId, ids.team));
    expect(period!.modelChargedMicroUsd).toBe(200_000);
    expect(period!.upstreamCostMicroUsd).toBeGreaterThan(0);
  });

  it('never charges for a BYOK request, and never consumes quota', async () => {
    const context = await loadBillingContext(ids.team);
    const balanceBefore = context.balanceMicroUsd;
    const usedBefore = context.weightedTokensUsed;

    const settlement = await recordModelUsage({
      context,
      userId: ids.user,
      projectId: ids.project,
      providerKey: 'omniakey',
      modelId: null,
      modelSlug: 'claude-sonnet-5',
      counts: { inputTokens: 500_000, outputTokens: 100_000 },
      prices: SONNET,
      usedByok: true,
      latencyMs: 9_000,
    });

    expect(settlement.chargedMicroUsd).toBe(0);
    expect(settlement.settlement).toBe('byok');

    const reloaded = await loadBillingContext(ids.team);
    expect(reloaded.balanceMicroUsd).toBe(balanceBefore);
    expect(reloaded.weightedTokensUsed).toBe(usedBefore);
  });

  it('records a failed request without charging for it', async () => {
    const context = await loadBillingContext(ids.team);
    const balanceBefore = context.balanceMicroUsd;

    const settlement = await recordModelUsage({
      context,
      userId: ids.user,
      projectId: ids.project,
      providerKey: 'omniakey',
      modelId: null,
      modelSlug: 'claude-sonnet-5',
      counts: { inputTokens: 20_000, outputTokens: 0 },
      prices: SONNET,
      usedByok: false,
      latencyMs: 300,
      status: 'error',
      errorCode: 'provider_unavailable',
    });

    expect(settlement.chargedMicroUsd).toBe(0);

    const reloaded = await loadBillingContext(ids.team);
    expect(reloaded.balanceMicroUsd).toBe(balanceBefore);

    const events = await db.select().from(usageEvents).where(eq(usageEvents.teamId, ids.team));
    expect(events.some((e) => e.status === 'error')).toBe(true);
  });

  it('meters compute and debits overage past the included hours', async () => {
    const context = await loadBillingContext(ids.team);
    const balanceBefore = context.balanceMicroUsd;
    const startedAt = new Date(Date.now() - 3_600_000);

    const settlement = await recordComputeUsage({
      context,
      userId: ids.user,
      projectId: ids.project,
      sandboxId: null as unknown as string,
      providerKey: 'mock',
      cpuCores: 0.5,
      memoryMb: 1024,
      diskGb: 20,
      computeMultiplier: 4,
      startedAt,
      stoppedAt: new Date(),
      activeSeconds: 3600,
      upstreamMicroUsdPerBaseHour: 9_000,
    });

    // 1 wall-clock hour on a 4x machine = 4 compute hours.
    expect(settlement.billedComputeHours).toBe(4);
    expect(settlement.quotaConsumedHours).toBe(4);
    expect(settlement.chargedMicroUsd).toBe(0);

    const reloaded = await loadBillingContext(ids.team);
    expect(reloaded.computeHoursUsed).toBe(4);
    expect(reloaded.balanceMicroUsd).toBe(balanceBefore);
  });

  it('never bills compute that ran on the user own server', async () => {
    const context = await loadBillingContext(ids.team);
    const settlement = await recordComputeUsage({
      context,
      userId: ids.user,
      projectId: ids.project,
      sandboxId: null as unknown as string,
      providerKey: 'remote-docker',
      cpuCores: 4,
      memoryMb: 8192,
      diskGb: 100,
      computeMultiplier: 0,
      startedAt: new Date(Date.now() - 7_200_000),
      stoppedAt: new Date(),
      activeSeconds: 7200,
      upstreamMicroUsdPerBaseHour: 0,
      isOwnServer: true,
    });

    expect(settlement.chargedMicroUsd).toBe(0);
    expect(settlement.settlement).toBe('byok');
  });

  it('keeps the period rollup consistent with the sum of its events', async () => {
    const events = await db.select().from(usageEvents).where(eq(usageEvents.teamId, ids.team));

    const chargedFromEvents = events
      .filter((e) => e.status !== 'error')
      .reduce((sum, e) => sum + e.chargedMicroUsd, 0);

    const [period] = await db
      .select()
      .from(usagePeriods)
      .where(eq(usagePeriods.teamId, ids.team));

    expect(period!.modelChargedMicroUsd).toBe(chargedFromEvents);
  });
});

describe('projectPeriodTotal', () => {
  it('extrapolates linearly through the period', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-02-01T00:00:00Z');
    const halfway = new Date('2026-01-16T12:00:00Z');
    expect(projectPeriodTotal(500, start, end, halfway)).toBeCloseTo(1_000, -1);
  });

  it('does not extrapolate from almost no data', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-02-01T00:00:00Z');
    const barelyStarted = new Date('2026-01-01T06:00:00Z');
    expect(projectPeriodTotal(10, start, end, barelyStarted)).toBe(10);
  });
});
