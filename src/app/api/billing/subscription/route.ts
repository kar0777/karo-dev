import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { toBillingApiError } from '../_shared';

import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { getBillingProvider } from '@/lib/billing';
import { db } from '@/lib/db';
import { plans, subscriptions } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';
import { resolvePeriod } from '@/lib/usage/metering';

/**
 * Cancel / resume / change an existing subscription.
 *
 * Cancelling always means *at period end*: the team has already paid for the
 * current period and cutting their agents off mid-month would be theft.
 *
 * A downgrade is the same argument in a different shape, and the pricing page
 * and the Terms both say so out loud: the smaller allowance must not replace
 * the one that has been paid for until that period is over. So a downgrade is
 * parked in the `pending_*` columns and applied at the boundary by
 * `applyPendingPlanChange`; only upgrades reach the provider from here.
 */

const body = z.object({
  action: z.enum(['cancel', 'resume', 'change']),
  planId: z.string().min(1).optional(),
  interval: z.enum(['month', 'year']).optional(),
});

export const PATCH = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: AUDIT_ACTIONS.billingPlanChange, resourceType: 'subscription' },
  },
  async ({ user, body: input, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'billing.manage');

    const [row] = await db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.teamId, team.id))
      .limit(1);

    if (!row) {
      throw new NotFoundError('This team has no subscription.', {
        title: 'No subscription to change',
        description:
          'Pick a plan first — that starts a checkout and creates the subscription. Pay-as-you-go needs no subscription.',
      });
    }

    const subscription = row.subscription;
    const providerSubscriptionId = subscription.stripeSubscriptionId;
    if (!providerSubscriptionId) {
      throw new ConflictError('This subscription has no provider reference.', {
        title: 'Subscription is not linked to a payment provider',
        description:
          'It was created before billing was configured. Contact support so it can be reconnected — nothing is charged meanwhile.',
      });
    }

    const provider = getBillingProvider();

    try {
      if (input.action === 'cancel') {
        if (subscription.cancelAtPeriodEnd) {
          throw new ConflictError('This subscription is already set to cancel.', {
            title: 'Already scheduled to cancel',
            description:
              'It ends at the close of the current period. Choose Resume if you want to keep it.',
          });
        }
        await provider.cancelSubscription(providerSubscriptionId, true);
        setAudit({
          teamId: team.id,
          resourceId: subscription.id,
          severity: 'notice',
          summary: `Subscription to ${row.plan.name} set to cancel at period end`,
          metadata: { planKey: row.plan.key, provider: provider.key },
        });
        return json({
          ok: true,
          action: 'cancel',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
        });
      }

      if (input.action === 'resume') {
        if (!subscription.cancelAtPeriodEnd && subscription.status === 'active') {
          throw new ConflictError('This subscription is already active.', {
            title: 'Nothing to resume',
            description: 'The subscription is running and is not scheduled to end.',
          });
        }
        await provider.resumeSubscription(providerSubscriptionId);
        setAudit({
          teamId: team.id,
          resourceId: subscription.id,
          summary: `Subscription to ${row.plan.name} resumed`,
          metadata: { planKey: row.plan.key, provider: provider.key },
        });
        return json({ ok: true, action: 'resume', cancelAtPeriodEnd: false });
      }

      if (!input.planId) {
        throw new ValidationError('A plan is required to change a subscription.', [
          { path: 'planId', message: 'Choose the plan to move to.', code: 'required' },
        ]);
      }

      const [target] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);

      if (!target || !target.isActive) {
        throw new NotFoundError('That plan is not available.', {
          title: 'Plan not available',
          description: 'Reload the billing page to see the plans that are currently offered.',
        });
      }

      const interval = input.interval ?? (subscription.interval === 'year' ? 'year' : 'month');
      const hadScheduledChange = subscription.pendingPlanId !== null;

      if (target.id === subscription.planId && interval === subscription.interval) {
        // Asking for the plan you are already on is how the billing page cancels
        // a scheduled downgrade — there is nothing else it could mean.
        if (!hadScheduledChange) {
          throw new ConflictError('That is already your current plan.', {
            title: 'No change to make',
            description: 'You are already on this plan and billing interval.',
          });
        }

        await clearScheduledChange(subscription.id);

        setAudit({
          teamId: team.id,
          resourceId: subscription.id,
          severity: 'notice',
          summary: `Scheduled plan change cancelled; staying on ${row.plan.name}`,
          metadata: { planKey: row.plan.key, cancelledPlanId: subscription.pendingPlanId },
        });

        return json({
          ok: true,
          action: 'change',
          planId: row.plan.id,
          planName: row.plan.name,
          interval,
          direction: 'none',
          scheduled: false,
          effectiveAt: null,
          clearedScheduledChange: true,
        });
      }

      const upgrading = target.priceMicroUsdMonthly > row.plan.priceMicroUsdMonthly;
      // Only a cheaper plan takes an allowance away, so only that has to wait.
      // Swapping interval on the same plan changes nothing the team is using.
      const downgrading = target.priceMicroUsdMonthly < row.plan.priceMicroUsdMonthly;

      if (downgrading) {
        if (subscription.cancelAtPeriodEnd) {
          throw new ConflictError('This subscription is already set to end.', {
            title: 'Subscription is ending',
            description:
              'A downgrade lands at the close of the current period, and there is no period after this one while the subscription is set to end. Resume it first, then pick the smaller plan.',
          });
        }

        // The metered period end rather than `currentPeriodEnd`: that column is
        // only refreshed by a provider webhook, so on the simulator — and on
        // Stripe for as long as a renewal notification is in flight — it can
        // already be in the past. `applyPendingPlanChange` measures the parked
        // change against this same rolled-forward window, so quoting anything
        // else here would promise a date the sweep does not honour.
        const { periodEnd } = resolvePeriod(
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
        );

        // Overwrites whatever was parked before, so a second downgrade replaces
        // the first rather than queueing behind it.
        await db
          .update(subscriptions)
          .set({
            pendingPlanId: target.id,
            pendingInterval: interval,
            pendingRequestedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, subscription.id));

        setAudit({
          teamId: team.id,
          resourceId: subscription.id,
          severity: 'notice',
          summary: `Downgrade to ${target.name} scheduled for the end of the period`,
          metadata: {
            fromPlanKey: row.plan.key,
            toPlanKey: target.key,
            interval,
            direction: 'downgrade',
            effectiveAt: periodEnd.toISOString(),
          },
        });

        return json({
          ok: true,
          action: 'change',
          planId: target.id,
          planName: target.name,
          interval,
          direction: 'downgrade',
          scheduled: true,
          effectiveAt: periodEnd.toISOString(),
        });
      }

      // The mock provider resolves a plan id too, so a deployment without
      // Stripe prices configured still exercises the whole flow.
      const newPriceId =
        (interval === 'year' ? target.stripePriceIdYearly : target.stripePriceIdMonthly) ??
        target.id;

      await provider.changePlan({
        subscriptionId: providerSubscriptionId,
        newPriceId,
        // Upgrades prorate immediately so the new allowance is usable now; an
        // interval swap on the same plan buys no new allowance to prorate.
        prorate: upgrading,
      });

      if (hadScheduledChange) {
        // Otherwise the parked downgrade would quietly undo this change at the
        // period boundary, without anyone asking for it twice.
        await clearScheduledChange(subscription.id);
      }

      setAudit({
        teamId: team.id,
        resourceId: subscription.id,
        severity: 'notice',
        summary: `Plan changed from ${row.plan.name} to ${target.name}`,
        metadata: {
          fromPlanKey: row.plan.key,
          toPlanKey: target.key,
          interval,
          direction: upgrading ? 'upgrade' : 'downgrade',
          provider: provider.key,
          clearedScheduledChange: hadScheduledChange,
        },
      });

      return json({
        ok: true,
        action: 'change',
        planId: target.id,
        planName: target.name,
        interval,
        direction: upgrading ? 'upgrade' : 'downgrade',
        scheduled: false,
        effectiveAt: null,
      });
    } catch (error) {
      // Our own thrown ApiErrors must pass through untouched.
      if (
        error instanceof ConflictError ||
        error instanceof NotFoundError ||
        error instanceof ValidationError
      ) {
        throw error;
      }
      throw toBillingApiError(error);
    }
  },
);

async function clearScheduledChange(subscriptionId: string): Promise<void> {
  await db
    .update(subscriptions)
    .set({
      pendingPlanId: null,
      pendingInterval: null,
      pendingRequestedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscriptionId));
}
