import 'server-only';

import { and, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';

import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { getBillingProvider } from '@/lib/billing';
import { db } from '@/lib/db';
import {
  notifications,
  plans,
  subscriptions,
  teamMembers,
  type Subscription,
} from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { TEAM_ROLES, can } from '@/lib/rbac/permissions';
import { resolvePeriod } from '@/lib/usage/metering';

/**
 * Downgrades that were parked until the period boundary.
 *
 * The pricing page and the Terms both promise that a downgrade applies at the
 * end of the current period, so `/api/billing/subscription` writes the target
 * plan into the `pending_*` columns instead of calling the provider. This
 * module is the other half: it carries the change out once the period the team
 * already paid for has actually closed, and `/api/cron/billing/apply-pending`
 * is what calls it.
 *
 * Two concurrent runs are safe. The provider call happens first and is only
 * ever a repeat of the same price change — the second one finds the item
 * already on the new price, so it moves nothing and prorates nothing — and the
 * write that clears the parked change matches the row only while it still holds
 * exactly the change that was read, so the loser of a race writes no second
 * audit event and no second notification. Ordering it that way also means a
 * crash mid-flight leaves the parked change in place and the next tick retries
 * it, rather than silently dropping a downgrade.
 */

const log = createLogger('billing:plan-changes');

/** Whoever can see billing hears about a change nobody clicked in that moment. */
const BILLING_ROLES = TEAM_ROLES.filter((role) => can(role, 'billing.read'));

export type PendingPlanChangeResult =
  /** No subscription, or nothing parked on it. */
  | { status: 'none' }
  /** Parked, but the period the team paid for is still running. */
  | { status: 'not_due'; effectiveAt: Date }
  | { status: 'applied'; planId: string; planName: string; interval: 'month' | 'year' }
  /** The change can never happen now, so it was discarded. */
  | { status: 'dropped'; reason: string }
  /** Another run, or the team itself, changed the parked request first. */
  | { status: 'superseded' }
  | { status: 'failed'; message: string };

export type DuePlanChangesResult = {
  applied: string[];
  dropped: string[];
  failed: string[];
};

export async function applyPendingPlanChange(teamId: string): Promise<PendingPlanChangeResult> {
  const [row] = await db
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.teamId, teamId))
    .limit(1);

  if (!row) return { status: 'none' };

  const subscription = row.subscription;
  const pendingPlanId = subscription.pendingPlanId;
  if (!pendingPlanId) return { status: 'none' };

  const schedule = scheduleOf(subscription);
  if (!schedule.due) return { status: 'not_due', effectiveAt: schedule.effectiveAt };

  const requestedAt = subscription.pendingRequestedAt;
  const guard = stillParked(subscription.id, pendingPlanId, requestedAt);

  // A subscription that is ending, or that has already ended, has no next
  // period to move into. Leaving the request parked would make every later run
  // pick the same row up again, so it is discarded with a trail instead. A
  // subscription that is merely late on payment is left alone: the team asked
  // for a cheaper plan and taking that away from them would be backwards.
  if (subscription.cancelAtPeriodEnd || isTerminal(subscription.status)) {
    const reason = subscription.cancelAtPeriodEnd
      ? 'the subscription is set to end at the period close'
      : `the subscription is ${subscription.status}`;

    const cleared = await db
      .update(subscriptions)
      .set({ ...CLEARED, updatedAt: new Date() })
      .where(guard)
      .returning({ id: subscriptions.id });

    if (cleared.length === 0) return { status: 'superseded' };

    await recordAudit({
      action: AUDIT_ACTIONS.billingPlanChange,
      teamId,
      actorType: 'system',
      resourceType: 'subscription',
      resourceId: subscription.id,
      severity: 'notice',
      summary: `Scheduled plan change discarded because ${reason}`,
      metadata: { fromPlanKey: row.plan.key, toPlanId: pendingPlanId, reason },
    });

    return { status: 'dropped', reason };
  }

  const providerSubscriptionId = subscription.stripeSubscriptionId;
  if (!providerSubscriptionId) {
    // The route refuses to park a change on an unlinked subscription, so this
    // only happens if the reference was removed in between. Left parked so a
    // reconnect picks it up.
    log.warn('A plan change is due on a subscription with no provider reference', { teamId });
    return {
      status: 'failed',
      message: 'The subscription is not linked to a payment provider.',
    };
  }

  const [target] = await db.select().from(plans).where(eq(plans.id, pendingPlanId)).limit(1);
  if (!target) {
    // The foreign key is `on delete set null`, so a missing plan here means the
    // row was already cleared underneath us.
    return { status: 'superseded' };
  }

  const interval: 'month' | 'year' = subscription.pendingInterval === 'year' ? 'year' : 'month';
  const newPriceId =
    (interval === 'year' ? target.stripePriceIdYearly : target.stripePriceIdMonthly) ??
    target.id;

  const provider = getBillingProvider();

  try {
    await provider.changePlan({
      subscriptionId: providerSubscriptionId,
      newPriceId,
      // A change is only due once the period it was requested in has closed,
      // which on Stripe means the renewal invoice for the period now running
      // has already gone out at the price the team asked to leave. Prorating
      // hands that difference back; `none` would bill them the old rate for a
      // period they spend on the new plan's smaller allowance.
      prorate: true,
    });
  } catch (error) {
    log.warn('Could not apply a scheduled plan change', { teamId, error: String(error) });
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const applied = await db
    .update(subscriptions)
    .set({ ...CLEARED, planId: target.id, interval, updatedAt: new Date() })
    .where(guard)
    .returning({ id: subscriptions.id });

  if (applied.length === 0) return { status: 'superseded' };

  await recordAudit({
    action: AUDIT_ACTIONS.billingPlanChange,
    teamId,
    actorType: 'system',
    resourceType: 'subscription',
    resourceId: subscription.id,
    severity: 'notice',
    summary: `Scheduled change applied: ${row.plan.name} → ${target.name}`,
    metadata: {
      fromPlanKey: row.plan.key,
      toPlanKey: target.key,
      interval,
      requestedAt: requestedAt?.toISOString() ?? null,
      provider: provider.key,
    },
  });

  await notifyPlanChanged(teamId, row.plan.name, target.name);

  log.info('Applied a scheduled plan change', {
    teamId,
    fromPlanKey: row.plan.key,
    toPlanKey: target.key,
  });

  return { status: 'applied', planId: target.id, planName: target.name, interval };
}

/**
 * Applies every parked change whose period has closed. Called by the cron
 * route; the batch is bounded so one tick cannot run for an unbounded time —
 * whatever is left over is picked up by the next one.
 */
export async function applyDuePlanChanges(): Promise<DuePlanChangesResult> {
  const now = new Date();

  // A deliberately loose superset of `scheduleOf`, because that predicate rolls
  // a stale period anchor forward in JavaScript and there is no cheap way to say
  // that in SQL. Every row it lets through is re-tested exactly by
  // `applyPendingPlanChange`, which answers `not_due` for the extras at the cost
  // of one indexed read.
  const candidates = await db
    .select({ teamId: subscriptions.teamId })
    .from(subscriptions)
    .where(
      and(
        isNotNull(subscriptions.pendingPlanId),
        or(
          isNull(subscriptions.pendingRequestedAt),
          gt(subscriptions.currentPeriodStart, subscriptions.pendingRequestedAt),
          lte(subscriptions.currentPeriodEnd, now),
        ),
      ),
    )
    .limit(200);

  const result: DuePlanChangesResult = { applied: [], dropped: [], failed: [] };

  // Sequential on purpose: these are provider round trips, and a month boundary
  // makes many of them fall due at once.
  for (const { teamId } of candidates) {
    const outcome = await applyPendingPlanChange(teamId);
    if (outcome.status === 'applied') result.applied.push(teamId);
    else if (outcome.status === 'dropped') result.dropped.push(teamId);
    else if (outcome.status === 'failed') result.failed.push(teamId);
  }

  if (result.applied.length > 0 || result.dropped.length > 0 || result.failed.length > 0) {
    log.info('Swept due plan changes', {
      candidates: candidates.length,
      applied: result.applied.length,
      dropped: result.dropped.length,
      failed: result.failed.length,
    });
  }

  return result;
}

/* ------------------------------------------------------------------ *
 *  Internals
 * ------------------------------------------------------------------ */

const CLEARED = {
  pendingPlanId: null,
  pendingInterval: null,
  pendingRequestedAt: null,
} as const;

/** Statuses a subscription never comes back from. */
function isTerminal(status: string): boolean {
  return status === 'canceled' || status === 'incomplete_expired';
}

/**
 * Whether the period the team was paying for when they asked has closed, and
 * the date the change lands on if it has not.
 *
 * Deliberately *not* `currentPeriodEnd <= now`. Stripe's renewal webhook moves
 * that column forward within seconds of the boundary (`syncSubscription`), so
 * an hourly sweep would find the row un-due again and defer the downgrade by
 * another whole period — at every boundary, indefinitely, while the team keeps
 * paying the price they asked to leave. The simulator has the opposite problem:
 * it never renews the column at all, so it sits permanently in the past and the
 * change would land the moment it was parked.
 *
 * `resolvePeriod` is the window usage is already metered against, rolled
 * forward over a stale anchor exactly as the allowance is. Comparing its start
 * against the request timestamp — the one column no provider sync touches —
 * asks the question the promise is actually about, and survives both.
 */
function scheduleOf(subscription: Subscription): { due: boolean; effectiveAt: Date } {
  const { periodStart, periodEnd } = resolvePeriod(
    subscription.currentPeriodStart,
    subscription.currentPeriodEnd,
  );
  const requestedAt = subscription.pendingRequestedAt;

  // The route writes the timestamp with the plan and clears them together, so a
  // parked change without one cannot be dated. Honouring it on the next sweep
  // beats leaving it parked forever under a card that keeps promising it.
  if (!requestedAt) return { due: true, effectiveAt: periodEnd };

  return { due: periodStart > requestedAt, effectiveAt: periodEnd };
}

/**
 * Matches the subscription only while it still holds the exact change that was
 * read — same plan, same request timestamp. That is what makes the clearing
 * write a one-winner operation: whoever writes first replaces the timestamp
 * with `null`, and every other run stops matching.
 */
function stillParked(subscriptionId: string, pendingPlanId: string, requestedAt: Date | null) {
  return and(
    eq(subscriptions.id, subscriptionId),
    eq(subscriptions.pendingPlanId, pendingPlanId),
    requestedAt
      ? eq(subscriptions.pendingRequestedAt, requestedAt)
      : isNull(subscriptions.pendingRequestedAt),
  );
}

/**
 * Nobody was at the keyboard when this happened, so the people who pay for the
 * team are told. A failure here must not be reported as a failed plan change:
 * the plan has already moved and a retry would call the provider again.
 */
async function notifyPlanChanged(
  teamId: string,
  fromPlanName: string,
  toPlanName: string,
): Promise<void> {
  try {
    const recipients = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.role, BILLING_ROLES)));

    if (recipients.length === 0) return;

    await db.insert(notifications).values(
      recipients.map((member) => ({
        id: newId(ID_PREFIX.notification),
        userId: member.userId,
        teamId,
        level: 'info' as const,
        title: `Your plan is now ${toPlanName}`,
        body: `The change from ${fromPlanName} you scheduled has taken effect now that the period you had already paid for has ended. Allowances and rates are ${toPlanName}'s from here.`,
        actionLabel: 'View billing',
        actionHref: '/app/billing',
      })),
    );
  } catch (error) {
    log.warn('Could not notify a team about its applied plan change', {
      teamId,
      error: String(error),
    });
  }
}
