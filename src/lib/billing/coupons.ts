import 'server-only';

import { and, count, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  couponRedemptions,
  coupons,
  paygBalances,
  topups,
  type Coupon,
} from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * Admin-minted promo codes, redeemed in Billing.
 *
 * Deliberately NOT at the Stripe checkout: codes entered on a payment page are
 * Stripe's promotion codes, priced and constrained in Stripe's dashboard. A
 * Karo coupon is an operator decision — "this person gets $20 of agent time"
 * or "half price on Pro for this team" — so it is redeemed where the operator's
 * statement lives, in the billing page, and settles against Karo's own ledger.
 *
 * Everything runs inside one transaction with the coupon row locked, because
 * the interesting failure is two people redeeming the last activation at the
 * same moment: the lock plus the count check inside it makes the second one
 * wait and then refuse.
 */

export type RedeemOutcome =
  | {
      ok: true;
      kind: 'credit';
      code: string;
      amountMicroUsd: number;
      creditFor: string;
    }
  | {
      ok: true;
      kind: 'plan_discount';
      code: string;
      percentOff: number;
      planTier: Coupon['planTier'];
    }
  | { ok: false; title: string; reason: string };

/** The active plan-discount entitlement for a team, if any. */
export async function activePlanDiscount(
  teamId: string,
  planTier: NonNullable<Coupon['planTier']>,
): Promise<{ couponId: string; percentOff: number } | null> {
  const rows = await db
    .select({
      couponId: couponRedemptions.couponId,
      percentOff: couponRedemptions.percentOff,
    })
    .from(couponRedemptions)
    .innerJoin(coupons, eq(coupons.id, couponRedemptions.couponId))
    .where(
      and(
        eq(couponRedemptions.teamId, teamId),
        eq(couponRedemptions.kind, 'plan_discount'),
        eq(couponRedemptions.status, 'active'),
        eq(couponRedemptions.planTier, planTier),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.percentOff) return null;
  return { couponId: row.couponId, percentOff: row.percentOff };
}

export async function redeemCoupon(input: {
  teamId: string;
  userId: string;
  rawCode: string;
}): Promise<RedeemOutcome> {
  const code = input.rawCode.trim().toUpperCase();
  if (!code) return { ok: false, title: 'Enter a code', reason: 'The code field is empty.' };

  return db.transaction(async (tx) => {
    const [coupon] = await tx
      .select()
      .from(coupons)
      .where(eq(coupons.code, code))
      .limit(1)
      .for('update');

    if (!coupon) {
      return { ok: false, title: 'Unknown code', reason: `No promo code "${code}" exists.` };
    }
    if (!coupon.isActive) {
      return { ok: false, title: 'Code retired', reason: `"${code}" is no longer active.` };
    }
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      return { ok: false, title: 'Code expired', reason: `"${code}" expired.` };
    }

    const [total] = await tx
      .select({ value: count() })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, coupon.id));
    if (Number(total?.value ?? 0) >= coupon.maxRedemptions) {
      return {
        ok: false,
        title: 'Fully redeemed',
        reason: `"${code}" has reached its limit of ${coupon.maxRedemptions} activation${coupon.maxRedemptions === 1 ? '' : 's'}.`,
      };
    }

    const [forTeam] = await tx
      .select({ value: count() })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, coupon.id),
          eq(couponRedemptions.teamId, input.teamId),
        ),
      );
    if (Number(forTeam?.value ?? 0) >= coupon.maxPerTeam) {
      return {
        ok: false,
        title: 'Already used',
        reason: `This workspace has already redeemed "${code}".`,
      };
    }

    const redemptionId = newId(ID_PREFIX.couponRedemption);

    if (coupon.kind === 'credit') {
      const amount = coupon.amountMicroUsd ?? 0;
      if (amount <= 0) {
        return { ok: false, title: 'Broken code', reason: 'This credit code has no amount set.' };
      }

      // Bonus balance, not topped-up cash: `bonus_micro_usd` carries the value
      // so lifetime top-up (real money in) is never inflated by a promo.
      const [topup] = await tx
        .insert(topups)
        .values({
          id: newId(ID_PREFIX.topup),
          teamId: input.teamId,
          userId: input.userId,
          amountMicroUsd: 0,
          bonusMicroUsd: amount,
          status: 'succeeded',
          provider: 'coupon',
          idempotencyKey: `coupon-redemption:${redemptionId}`,
          completedAt: new Date(),
        })
        .returning({ id: topups.id });

      await tx
        .update(paygBalances)
        .set({
          balanceMicroUsd: sql`${paygBalances.balanceMicroUsd} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(paygBalances.teamId, input.teamId));

      await tx.insert(couponRedemptions).values({
        id: redemptionId,
        couponId: coupon.id,
        teamId: input.teamId,
        redeemedById: input.userId,
        kind: 'credit',
        valueMicroUsd: amount,
        status: 'used',
        topupId: topup?.id ?? null,
      });

      return {
        ok: true,
        kind: 'credit',
        code,
        amountMicroUsd: amount,
        creditFor: coupon.creditFor,
      };
    }

    // plan_discount
    const percentOff = coupon.percentOff ?? 0;
    if (!coupon.planTier || percentOff < 1 || percentOff > 100) {
      return {
        ok: false,
        title: 'Broken code',
        reason: 'This discount code has no plan or percentage set.',
      };
    }

    const [existingDiscount] = await tx
      .select({ id: couponRedemptions.id })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.teamId, input.teamId),
          eq(couponRedemptions.kind, 'plan_discount'),
          eq(couponRedemptions.status, 'active'),
          eq(couponRedemptions.planTier, coupon.planTier),
        ),
      )
      .limit(1);
    if (existingDiscount) {
      return {
        ok: false,
        title: 'Discount already active',
        reason: `This workspace already has an active discount for the ${coupon.planTier} plan.`,
      };
    }

    await tx.insert(couponRedemptions).values({
      id: redemptionId,
      couponId: coupon.id,
      teamId: input.teamId,
      redeemedById: input.userId,
      kind: 'plan_discount',
      percentOff,
      planTier: coupon.planTier,
      status: 'active',
    });

    return {
      ok: true,
      kind: 'plan_discount',
      code,
      percentOff,
      planTier: coupon.planTier,
    };
  });
}

/** Auto-generates a code that cannot be confused with a word. */
export function generateCouponCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const group = (length: number) =>
    Array.from(
      { length },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join('');
  return `KARO-${group(4)}-${group(4)}`;
}
