import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { invoices, paygBalances, plans, subscriptions, teams, topups } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import {
  type AddUsageInput,
  BillingError,
  type BillingProvider,
  type ChargeOffSessionInput,
  type CheckoutSession,
  type CreateCheckoutSessionInput,
  type CreatePortalSessionInput,
  type OffSessionCharge,
  type PortalSession,
  type WebhookInput,
  type WebhookResult,
} from './types';

const log = createLogger('billing:mock');

/**
 * Simulated billing.
 *
 * This provider does the real database work — creates the subscription row,
 * moves the balance, writes the invoice — and simply skips the payment network.
 * That means the whole billing surface (upgrade, downgrade, cancel, top up,
 * overage, invoice history) is exercised in demo mode, and switching to Stripe
 * later changes one environment variable rather than a code path.
 *
 * Checkout "completes" immediately and redirects to a confirmation page that
 * makes the simulation obvious to the user.
 */
export class MockBillingProvider implements BillingProvider {
  readonly key = 'mock' as const;
  readonly displayName = 'Simulated billing';

  isConfigured(): boolean {
    return true;
  }

  async ensureCustomer(input: {
    teamId: string;
    existingCustomerId: string | null;
  }): Promise<string> {
    if (input.existingCustomerId) return input.existingCustomerId;
    const customerId = `cus_mock_${input.teamId.slice(-12)}`;
    await db
      .update(teams)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(teams.id, input.teamId));
    return customerId;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const sessionId = `cs_mock_${newId(ID_PREFIX.topup).slice(-16)}`;

    if (input.mode === 'payment') {
      await this.completeTopup(input, sessionId);
    } else {
      await this.completeSubscription(input);
    }

    const url = new URL(input.successUrl);
    url.searchParams.set('session_id', sessionId);
    url.searchParams.set('simulated', '1');

    return { id: sessionId, url: url.toString(), completedImmediately: true };
  }

  private async completeTopup(
    input: CreateCheckoutSessionInput,
    sessionId: string,
  ): Promise<void> {
    const amount = input.amountMicroUsd ?? 0;
    if (amount <= 0) {
      throw new BillingError('invalid_amount', 'Top-up amount must be greater than zero.');
    }

    await db.transaction(async (tx) => {
      await tx.insert(topups).values({
        id: newId(ID_PREFIX.topup),
        teamId: input.teamId,
        userId: input.userId,
        amountMicroUsd: amount,
        status: 'succeeded',
        provider: 'mock',
        stripeCheckoutSessionId: sessionId,
        idempotencyKey: input.idempotencyKey,
        completedAt: new Date(),
      });

      await tx
        .update(paygBalances)
        .set({
          balanceMicroUsd: sql`${paygBalances.balanceMicroUsd} + ${amount}`,
          lifetimeToppedUpMicroUsd: sql`${paygBalances.lifetimeToppedUpMicroUsd} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(paygBalances.teamId, input.teamId));

      await tx.insert(invoices).values({
        id: newId(ID_PREFIX.invoice),
        teamId: input.teamId,
        number: invoiceNumber(),
        status: 'paid',
        subtotalMicroUsd: amount,
        totalMicroUsd: amount,
        amountPaidMicroUsd: amount,
        lineItems: [{ label: 'Pay-as-you-go credit', quantity: 1, amountMicroUsd: amount }],
        issuedAt: new Date(),
        paidAt: new Date(),
      });
    });

    log.info('Simulated top-up completed', { teamId: input.teamId, amount });
  }

  private async completeSubscription(input: CreateCheckoutSessionInput): Promise<void> {
    if (!input.planId) {
      throw new BillingError('missing_plan', 'No plan was selected.');
    }
    const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
    if (!plan) throw new BillingError('unknown_plan', 'That plan no longer exists.', 404);

    const interval = input.interval ?? 'month';
    const now = new Date();
    const periodEnd = new Date(now);
    if (interval === 'year') periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
    else periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    const price = interval === 'year' ? plan.priceMicroUsdYearly : plan.priceMicroUsdMonthly;

    await db.transaction(async (tx) => {
      await tx
        .insert(subscriptions)
        .values({
          id: newId(ID_PREFIX.subscription),
          teamId: input.teamId,
          planId: plan.id,
          status: input.trialDays ? 'trialing' : 'active',
          interval,
          stripeSubscriptionId: `sub_mock_${input.teamId.slice(-12)}`,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialEndsAt: input.trialDays
            ? new Date(now.getTime() + input.trialDays * 86_400_000)
            : null,
          quotaSnapshot: {
            includedWeightedTokens: plan.includedWeightedTokens,
            includedComputeHours: plan.includedComputeHours,
            maxActiveSandboxes: plan.maxActiveSandboxes,
          },
        })
        .onConflictDoUpdate({
          target: subscriptions.teamId,
          set: {
            planId: plan.id,
            status: 'active',
            interval,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            updatedAt: new Date(),
          },
        });

      if (price > 0) {
        await tx.insert(invoices).values({
          id: newId(ID_PREFIX.invoice),
          teamId: input.teamId,
          number: invoiceNumber(),
          status: 'paid',
          subtotalMicroUsd: price,
          totalMicroUsd: price,
          amountPaidMicroUsd: price,
          periodStart: now,
          periodEnd,
          lineItems: [
            {
              label: `${plan.name} — ${interval === 'year' ? 'annual' : 'monthly'}`,
              quantity: 1,
              amountMicroUsd: price,
            },
          ],
          issuedAt: now,
          paidAt: now,
        });
      }
    });

    log.info('Simulated subscription activated', { teamId: input.teamId, plan: plan.key });
  }

  async createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession> {
    const url = new URL('/app/billing', input.returnUrl);
    url.searchParams.set('portal', 'simulated');
    return { url: url.toString() };
  }

  async addUsage(input: AddUsageInput): Promise<void> {
    // Usage is already recorded in `usageEvents`; there is no external meter to
    // push to in demo mode. Logged so the call path is observable in tests.
    log.debug('Simulated metered usage', {
      teamId: input.teamId,
      quantity: input.quantity,
    });
  }

  async chargeOffSession(input: ChargeOffSessionInput): Promise<OffSessionCharge> {
    if (input.amountMicroUsd <= 0) {
      throw new BillingError('invalid_amount', 'Charge amount must be greater than zero.');
    }

    // Deterministic success. The point of the simulator is that demo mode walks
    // the whole automatic top-up path — claim, charge, credit, notify — and a
    // randomised decline would only ever exercise the branch a real card
    // already covers.
    const paymentId = `pi_mock_${newId(ID_PREFIX.topup).slice(-16)}`;
    log.info('Simulated an off-session charge; no payment was taken', {
      teamId: input.teamId,
      amountMicroUsd: input.amountMicroUsd,
    });

    return { status: 'succeeded', paymentId };
  }

  async handleWebhook(input: WebhookInput): Promise<WebhookResult> {
    // The mock provider completes purchases inline, so no webhook is expected.
    // The endpoint still accepts and acknowledges, which keeps the route under
    // test even without Stripe.
    let eventType = 'mock.noop';
    try {
      const parsed = JSON.parse(input.payload) as { type?: string };
      eventType = parsed.type ?? eventType;
    } catch {
      // Not JSON — ignore.
    }
    return {
      handled: true,
      eventType,
      eventId: `evt_mock_${Date.now().toString(36)}`,
      message: 'Simulated billing acknowledged the event without acting on it.',
    };
  }

  async cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    await db
      .update(subscriptions)
      .set(
        atPeriodEnd
          ? { cancelAtPeriodEnd: true, updatedAt: new Date() }
          : { status: 'canceled', canceledAt: new Date(), updatedAt: new Date() },
      )
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
  }

  async resumeSubscription(subscriptionId: string): Promise<void> {
    await db
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: false,
        status: 'active',
        canceledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
  }

  async changePlan(input: { subscriptionId: string; newPriceId: string }): Promise<void> {
    const [plan] = await db
      .select()
      .from(plans)
      .where(
        and(
          eq(plans.isActive, true),
          sql`${plans.stripePriceIdMonthly} = ${input.newPriceId} or ${plans.stripePriceIdYearly} = ${input.newPriceId} or ${plans.id} = ${input.newPriceId}`,
        ),
      )
      .limit(1);

    if (!plan) throw new BillingError('unknown_plan', 'That plan no longer exists.', 404);

    await db
      .update(subscriptions)
      .set({ planId: plan.id, updatedAt: new Date() })
      .where(eq(subscriptions.stripeSubscriptionId, input.subscriptionId));
  }
}

let invoiceCounter = 0;

function invoiceNumber(): string {
  invoiceCounter += 1;
  const now = new Date();
  return `KARO-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
    Date.now() % 100_000,
  ).padStart(5, '0')}${invoiceCounter % 10}`;
}
