import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/lib/db';
import {
  paygBalances,
  plans,
  teamMembers,
  teams,
  usageReservations,
  users,
} from '@/lib/db/schema';
import { newId } from '@/lib/ids';
import { checkSpendGuard } from '@/lib/pricing/calculator';
import {
  loadBillingContext,
  releaseRunBudget,
  reserveRunBudget,
  type BillingContext,
} from '@/lib/usage/metering';

/**
 * Admission control against a real database.
 *
 * This suite exists for one defect: the spend guard used to *check* a team's
 * position without *holding* anything, and the counters it read only move when a
 * run finishes. Runs started together therefore each read the same untouched
 * numbers, each concluded there was room, and every one of them took it.
 *
 * That is a concurrency bug, so nothing short of genuine concurrency can prove
 * it is fixed. These tests fire real overlapping transactions through the real
 * pool; `DATABASE_MAX_CONNECTIONS` defaults to 10, so they genuinely overlap
 * rather than queueing behind a single connection.
 */

const ESTIMATE_MICRO_USD = 400_000; // $0.40 per run
const ESTIMATE_WEIGHTED = 5_000;
const CONCURRENT = 10;

let reachable = false;
const ids = {
  user: newId('user'),
  team: newId('team'),
  paygPlan: newId('plan'),
};

/** Ten simultaneous admissions sharing one snapshot — i.e. ten parallel requests. */
async function admitConcurrently(context: BillingContext, count = CONCURRENT) {
  return Promise.all(
    Array.from({ length: count }, () =>
      reserveRunBudget({
        context,
        estimatedChargeMicroUsd: ESTIMATE_MICRO_USD,
        estimatedWeightedTokens: ESTIMATE_WEIGHTED,
      }),
    ),
  );
}

/** What the old code did: the same guard, N times, against one snapshot. */
function guardOnly(context: BillingContext) {
  return checkSpendGuard({
    estimatedChargeMicroUsd: ESTIMATE_MICRO_USD,
    balanceMicroUsd: context.balanceMicroUsd,
    creditLimitMicroUsd: context.creditLimitMicroUsd,
    quotaRemainingWeighted: context.quotaRemainingWeighted,
    estimatedWeightedTokens: ESTIMATE_WEIGHTED,
    spendCapMicroUsd: context.spendCapMicroUsd,
    periodSpendMicroUsd: context.periodSpendMicroUsd,
    hasActiveSubscription: context.hasActiveSubscription,
    subscriptionStatus: context.subscriptionStatus ?? undefined,
  });
}

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
    email: `admission-${ids.user}@karo.test`,
    name: 'Admission Fixture',
    emailVerifiedAt: new Date(),
  });

  await db.insert(teams).values({
    id: ids.team,
    name: 'Admission Fixture Team',
    slug: `admission-${ids.team.slice(-8)}`,
    ownerId: ids.user,
  });

  await db.insert(teamMembers).values({
    id: newId('teamMember'),
    teamId: ids.team,
    userId: ids.user,
    role: 'owner',
  });

  // No subscription on purpose. A team with quota to spare short-circuits the
  // guard before it ever looks at money, and money is what this suite is about.
  await db
    .insert(plans)
    .values({
      id: ids.paygPlan,
      key: `payg-admission-${ids.paygPlan.slice(-6)}`,
      tier: 'payg',
      name: 'PAYG Admission Fixture',
      marginBps: 2_000,
    })
    .onConflictDoNothing();

  await db.insert(paygBalances).values({
    id: newId('paygBalance'),
    teamId: ids.team,
    balanceMicroUsd: 1_000_000, // $1.00 — exactly two runs' worth
    creditLimitMicroUsd: 0, // pinned, so the platform default cannot drift the maths
  });
});

afterEach(async () => {
  if (!reachable) return;
  // Holds are per-test; leaking one would silently shrink the next test's budget.
  await db.delete(usageReservations).where(eq(usageReservations.teamId, ids.team));
});

afterAll(async () => {
  if (!reachable) return;
  await db.delete(teams).where(eq(teams.id, ids.team));
  await db.delete(users).where(eq(users.id, ids.user));
  await db.delete(plans).where(eq(plans.id, ids.paygPlan));
  await pg.end({ timeout: 5 });
});

describe.runIf(process.env.SKIP_DB_TESTS !== '1')(
  'run admission against a real database',
  () => {
    it('is connected — otherwise these assertions prove nothing', () => {
      expect(reachable, 'DATABASE_URL is not reachable; start Postgres first').toBe(true);
    });

    it('admits only what the balance covers when ten runs start at once', async () => {
      await db
        .update(teams)
        .set({ spendCapMicroUsd: 0 }) // no cap; the balance is the only limit here
        .where(eq(teams.id, ids.team));

      const context = await loadBillingContext(ids.team);
      expect(context.hasActiveSubscription).toBe(false);
      expect(context.balanceMicroUsd).toBe(1_000_000);
      expect(context.creditLimitMicroUsd).toBe(0);

      // The regression, stated as an assertion: the bare guard says yes every time,
      // because the snapshot it reads does not move until a run settles.
      expect(guardOnly(context).allowed).toBe(true);
      expect(guardOnly(context).allowed).toBe(true);

      const results = await admitConcurrently(context);
      const admitted = results.filter((r) => r.allowed);

      // $1.00 of balance, $0.40 a run.
      expect(admitted).toHaveLength(2);

      for (const denied of results.filter((r) => !r.allowed)) {
        expect(denied.allowed).toBe(false);
        if (!denied.allowed) expect(denied.guard.reason).toBe('payment_required');
      }

      const holds = await db
        .select()
        .from(usageReservations)
        .where(eq(usageReservations.teamId, ids.team));
      expect(holds).toHaveLength(2);
      expect(holds.reduce((n, h) => n + h.microUsd, 0)).toBe(2 * ESTIMATE_MICRO_USD);
    });

    it('admits only what the spending cap covers when ten runs start at once', async () => {
      // Plenty of balance, so a failure here can only come from the cap.
      await db
        .update(paygBalances)
        .set({ balanceMicroUsd: 100_000_000 })
        .where(eq(paygBalances.teamId, ids.team));
      await db.update(teams).set({ spendCapMicroUsd: 1_000_000 }).where(eq(teams.id, ids.team));

      const context = await loadBillingContext(ids.team);
      expect(context.spendCapMicroUsd).toBe(1_000_000);
      expect(guardOnly(context).allowed).toBe(true);

      const results = await admitConcurrently(context);
      expect(results.filter((r) => r.allowed)).toHaveLength(2);

      const denied = results.find((r) => !r.allowed);
      expect(denied).toBeDefined();
      if (denied && !denied.allowed) expect(denied.guard.reason).toBe('spend_cap_reached');
    });

    it('gives the budget back when a run releases its hold', async () => {
      await db.update(teams).set({ spendCapMicroUsd: 1_000_000 }).where(eq(teams.id, ids.team));

      const context = await loadBillingContext(ids.team);
      const [first, second] = await admitConcurrently(context, 2);
      expect(first?.allowed).toBe(true);
      expect(second?.allowed).toBe(true);

      // A third would not fit while both are in flight.
      const blocked = await admitConcurrently(context, 1);
      expect(blocked[0]?.allowed).toBe(false);

      if (first?.allowed) await releaseRunBudget(first.hold);

      const afterRelease = await admitConcurrently(context, 1);
      expect(afterRelease[0]?.allowed).toBe(true);
    });

    it('ignores a hold left behind by a crashed run once it has expired', async () => {
      await db.update(teams).set({ spendCapMicroUsd: 1_000_000 }).where(eq(teams.id, ids.team));

      const context = await loadBillingContext(ids.team);

      // Two holds that no process will ever release, both already past their TTL.
      const stale = new Date(Date.now() - 60_000);
      await db.insert(usageReservations).values(
        [0, 1].map(() => ({
          id: newId('usageReservation'),
          teamId: ids.team,
          periodStart: context.periodStart,
          weightedTokens: ESTIMATE_WEIGHTED,
          microUsd: ESTIMATE_MICRO_USD,
          expiresAt: stale,
        })),
      );

      const results = await admitConcurrently(context, 1);
      expect(results[0]?.allowed).toBe(true);

      // Expired rows are cleared out rather than accumulating against the cap.
      const remaining = await db
        .select()
        .from(usageReservations)
        .where(eq(usageReservations.teamId, ids.team));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('clears expired holds left in an earlier period, not just the current one', async () => {
      await db.update(teams).set({ spendCapMicroUsd: 1_000_000 }).where(eq(teams.id, ids.team));

      const context = await loadBillingContext(ids.team);

      // Scoping the sweep to the current period would strand this row forever:
      // once the period rolls, nothing ever matches it again.
      await db.insert(usageReservations).values({
        id: newId('usageReservation'),
        teamId: ids.team,
        periodStart: new Date(context.periodStart.getTime() - 40 * 86_400_000),
        weightedTokens: ESTIMATE_WEIGHTED,
        microUsd: ESTIMATE_MICRO_USD,
        expiresAt: new Date(Date.now() - 60_000),
      });

      await admitConcurrently(context, 1);

      const remaining = await db
        .select()
        .from(usageReservations)
        .where(eq(usageReservations.teamId, ids.team));
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.periodStart.getTime()).toBe(context.periodStart.getTime());
    });

    it('holds nothing when it denies, so a refused run cannot shrink the next one', async () => {
      await db
        .update(teams)
        .set({ spendCapMicroUsd: 1 }) // one micro-dollar: nothing fits
        .where(eq(teams.id, ids.team));

      const context = await loadBillingContext(ids.team);
      const results = await admitConcurrently(context);
      expect(results.every((r) => !r.allowed)).toBe(true);

      const holds = await db
        .select()
        .from(usageReservations)
        .where(eq(usageReservations.teamId, ids.team));
      expect(holds).toHaveLength(0);
    });
  },
);
