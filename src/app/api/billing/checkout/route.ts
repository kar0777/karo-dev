import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { absoluteUrl, billingIdempotencyKey, toBillingApiError } from '../_shared';

import { defineHandler } from '@/lib/api/handler';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { getBillingProvider } from '@/lib/billing';
import { db } from '@/lib/db';
import { plans, subscriptions } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';

/**
 * Starts a subscription checkout.
 *
 * The route never trusts a price from the client — only a plan id. Prices come
 * from the `plans` row, which is the single place a tier's numbers exist.
 */

const body = z.object({
  planId: z.string().min(1, 'Choose a plan.'),
  interval: z.enum(['month', 'year']).default('month'),
});

export const POST = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: AUDIT_ACTIONS.billingCheckout, resourceType: 'subscription' },
  },
  async ({ user, body: input, req, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'billing.manage');

    const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);

    if (!plan || !plan.isActive) {
      throw new NotFoundError('That plan is not available.', {
        title: 'Plan not available',
        description:
          'This plan no longer exists or was retired. Reload the billing page to see the current plans.',
      });
    }

    if (plan.tier === 'payg') {
      throw new ConflictError('Pay-as-you-go does not require a checkout.', {
        title: 'Nothing to check out',
        description:
          'Pay-as-you-go is the default. Cancel your current subscription to move back to it, or add credit to your balance.',
      });
    }

    const [existing] = await db
      .select({ id: subscriptions.id, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.teamId, team.id))
      .limit(1);

    if (existing && ['active', 'trialing'].includes(existing.status)) {
      throw new ConflictError('This team already has an active subscription.', {
        title: 'Already subscribed',
        description:
          'Use "Change plan" to switch tiers — that keeps your billing period and prorates the difference.',
      });
    }

    const priceId =
      input.interval === 'year' ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly;

    const provider = getBillingProvider();
    const idempotencyKey = billingIdempotencyKey('checkout', [
      team.id,
      plan.id,
      input.interval,
    ]);

    let session;
    try {
      session = await provider.createCheckoutSession({
        teamId: team.id,
        userId: user.id,
        customerEmail: user.email,
        mode: 'subscription',
        planId: plan.id,
        priceId,
        interval: input.interval,
        trialDays: plan.trialDays > 0 ? plan.trialDays : undefined,
        successUrl: absoluteUrl(req, '/app/billing'),
        cancelUrl: absoluteUrl(req, '/app/billing?checkout=cancelled'),
        idempotencyKey,
      });
    } catch (error) {
      throw toBillingApiError(error);
    }

    setAudit({
      teamId: team.id,
      resourceId: plan.id,
      summary: `Checkout started for ${plan.name} (${input.interval}ly)`,
      metadata: {
        planKey: plan.key,
        interval: input.interval,
        provider: provider.key,
        completedImmediately: session.completedImmediately,
      },
    });

    return json({
      url: session.url,
      simulated: session.completedImmediately,
    });
  },
);
