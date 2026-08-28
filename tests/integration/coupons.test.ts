import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db, sql as pg } from '@/lib/db';
import {
  couponRedemptions,
  coupons,
  paygBalances,
  teams,
  teamMembers,
  topups,
  users,
} from '@/lib/db/schema';
import { newId } from '@/lib/ids';
import { redeemCoupon } from '@/lib/billing/coupons';

/**
 * Coupon redemption against a real database.
 *
 * The redemption limits (total activations, per-workspace cap, expiry) only
 * mean anything under concurrency, which is exactly what a unit test with a
 * mocked store cannot show. The suite runs against a throwaway database and
 * cleans up its own rows.
 */

const ids = {
  user: newId('user'),
  secondUser: newId('user'),
  team: newId('team'),
  secondTeam: newId('team'),
};

let reachable = false;
const createdCoupons: string[] = [];

async function mint(values: Partial<typeof coupons.$inferInsert> & { code: string }) {
  const id = newId('cpn');
  createdCoupons.push(id);
  await db.insert(coupons).values({
    id,
    name: `fixture ${values.code}`,
    kind: 'credit',
    maxRedemptions: 10,
    maxPerTeam: 1,
    createdById: ids.user,
    ...values,
  });
  return id;
}

beforeAll(async () => {
  try {
    await pg`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  for (const [userId, email] of [
    [ids.user, 'coupon-a'],
    [ids.secondUser, 'coupon-b'],
  ] as const) {
    await db.insert(users).values({
      id: userId,
      email: `${email}-${userId}@karo.test`,
      name: 'Coupon Fixture',
      emailVerifiedAt: new Date(),
    });
  }
  for (const teamId of [ids.team, ids.secondTeam]) {
    await db.insert(teams).values({
      id: teamId,
      name: 'Coupon Fixture Team',
      slug: `coupon-${teamId.slice(-8)}`,
      ownerId: ids.user,
    });
    await db.insert(teamMembers).values({
      id: newId('teamMember'),
      teamId,
      userId: ids.user,
      role: 'owner',
    });
    await db.insert(paygBalances).values({ id: newId('paygBalance'), teamId });
  }
});

afterAll(async () => {
  if (!reachable) return;
  // Coupons reference their creator with ON DELETE RESTRICT, so they go first.
  await db.delete(coupons);
  for (const teamId of [ids.team, ids.secondTeam]) {
    await db.delete(topups).where(eq(topups.teamId, teamId));
    await db.delete(paygBalances).where(eq(paygBalances.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
  }
  await db.delete(users).where(eq(users.id, ids.user));
  await db.delete(users).where(eq(users.id, ids.secondUser));
});

describe('coupon redemption against a real database', () => {
  it('is connected — otherwise these assertions prove nothing', () => {
    expect(reachable).toBe(true);
  });

  it('credits the balance as bonus, never as topped-up cash', async () => {
    await mint({ code: 'FIXCRED1', kind: 'credit', amountMicroUsd: 5_000_000 });

    const outcome = await redeemCoupon({
      teamId: ids.team,
      userId: ids.user,
      rawCode: '  fixcred1 ', // case- and whitespace-insensitive on purpose
    });

    expect(outcome).toMatchObject({ ok: true, kind: 'credit', amountMicroUsd: 5_000_000 });

    const [balance] = await db
      .select()
      .from(paygBalances)
      .where(eq(paygBalances.teamId, ids.team));
    expect(balance?.balanceMicroUsd).toBe(5_000_000);
    // Bonus credit must not inflate real money in.
    expect(balance?.lifetimeToppedUpMicroUsd).toBe(0);

    const [topup] = await db.select().from(topups).where(eq(topups.teamId, ids.team));
    expect(topup).toMatchObject({ bonusMicroUsd: 5_000_000, amountMicroUsd: 0, provider: 'coupon' });
  });

  it('refuses a second redemption from the same workspace (per-team cap)', async () => {
    await mint({ code: 'FIXTEAM1', kind: 'credit', amountMicroUsd: 1_000_000, maxPerTeam: 1 });

    const first = await redeemCoupon({ teamId: ids.team, userId: ids.user, rawCode: 'FIXTEAM1' });
    expect(first.ok).toBe(true);

    const second = await redeemCoupon({
      teamId: ids.team,
      userId: ids.user,
      rawCode: 'FIXTEAM1',
    });
    expect(second).toMatchObject({ ok: false, title: 'Already used' });
  });

  it('stops at the global activation limit across workspaces', async () => {
    await mint({ code: 'FIXGLOB1', kind: 'credit', amountMicroUsd: 1_000_000, maxRedemptions: 1 });

    const first = await redeemCoupon({ teamId: ids.team, userId: ids.user, rawCode: 'FIXGLOB1' });
    expect(first.ok).toBe(true);

    const second = await redeemCoupon({
      teamId: ids.secondTeam,
      userId: ids.secondUser,
      rawCode: 'FIXGLOB1',
    });
    expect(second).toMatchObject({ ok: false, title: 'Fully redeemed' });
  });

  it('records a plan discount once per tier and refuses duplicates', async () => {
    await mint({
      code: 'FIXDISC1',
      kind: 'plan_discount',
      percentOff: 50,
      planTier: 'lite',
    });

    const first = await redeemCoupon({ teamId: ids.team, userId: ids.user, rawCode: 'FIXDISC1' });
    expect(first).toMatchObject({ ok: true, kind: 'plan_discount', percentOff: 50 });

    const rows = await db
      .select({ status: couponRedemptions.status })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, createdCoupons.at(-1)!));
    expect(rows).toEqual([{ status: 'active' }]);

    const other = await mint({
      code: 'FIXDISC2',
      kind: 'plan_discount',
      percentOff: 30,
      planTier: 'lite',
    });
    const second = await redeemCoupon({ teamId: ids.team, userId: ids.user, rawCode: 'FIXDISC2' });
    expect(second).toMatchObject({ ok: false, title: 'Discount already active' });
    await db.delete(coupons).where(eq(coupons.id, other));
  });

  it('rejects an expired code', async () => {
    await mint({
      code: 'FIXEXPD1',
      kind: 'credit',
      amountMicroUsd: 1_000_000,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const outcome = await redeemCoupon({ teamId: ids.team, userId: ids.user, rawCode: 'FIXEXPD1' });
    expect(outcome).toMatchObject({ ok: false, title: 'Code expired' });
  });
});
