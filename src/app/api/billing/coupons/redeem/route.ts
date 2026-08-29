import { z } from 'zod';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { redeemCoupon } from '@/lib/billing/coupons';
import { assertCan } from '@/lib/rbac/permissions';
import { ConflictError } from '@/lib/api/errors';
import { formatMicroUsd } from '@/lib/utils';

/**
 * `POST /api/billing/coupons/redeem` — apply an admin-minted promo code.
 *
 * Redeemed here, in Billing, never at the Stripe checkout: a Karo coupon is
 * an operator's statement about this workspace (bonus credit, or a personal
 * discount on a plan), and it settles against Karo's own ledger. A credit
 * lands on the balance immediately; a plan discount is recorded and prices
 * the team's next subscription checkout for that tier.
 */

const body = z.object({
  code: z.string().trim().min(1, 'Enter a code.').max(60),
});

export const POST = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: AUDIT_ACTIONS.billingCouponRedeem, resourceType: 'coupon' },
  },
  async ({ user, body: input, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'billing.manage');

    const outcome = await redeemCoupon({
      teamId: team.id,
      userId: user.id,
      rawCode: input.code,
    });

    if (!outcome.ok) {
      throw new ConflictError(outcome.reason, {
        title: outcome.title,
        description: outcome.reason,
      });
    }

    if (outcome.kind === 'credit') {
      setAudit({
        teamId: team.id,
        summary: `Redeemed ${outcome.code}: ${formatMicroUsd(outcome.amountMicroUsd)} bonus balance (${outcome.creditFor})`,
        metadata: { code: outcome.code, amountMicroUsd: outcome.amountMicroUsd },
      });
      return json({
        ok: true,
        kind: 'credit' as const,
        amountMicroUsd: outcome.amountMicroUsd,
        creditFor: outcome.creditFor,
      });
    }

    setAudit({
      teamId: team.id,
      summary: `Redeemed ${outcome.code}: ${outcome.percentOff}% off the ${outcome.planTier} plan`,
      metadata: {
        code: outcome.code,
        percentOff: outcome.percentOff,
        planTier: outcome.planTier,
      },
    });
    return json({
      ok: true,
      kind: 'plan_discount' as const,
      percentOff: outcome.percentOff,
      planTier: outcome.planTier,
    });
  },
);
