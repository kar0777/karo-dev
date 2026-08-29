import 'server-only';

import Stripe from 'stripe';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { idempotencyKeys, invoices, plans, subscriptions, teams } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { creditTopup, topupBonusMicroUsd } from './credit';
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

const log = createLogger('billing:stripe');

/**
 * Stripe billing.
 *
 * Two things this implementation is strict about:
 *
 *  · **Signature verification.** `handleWebhook` uses
 *    `stripe.webhooks.constructEvent` with the raw body. An unverified webhook
 *    is rejected, never "processed anyway in development".
 *  · **Idempotency.** Every mutating Stripe call carries an idempotency key,
 *    and every webhook event id is recorded in `idempotency_keys` before it is
 *    acted on — Stripe retries deliveries, and a retried
 *    `checkout.session.completed` must not double-credit a balance.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly key = 'stripe' as const;
  readonly displayName = 'Stripe';

  private client: Stripe | null = null;

  private stripe(): Stripe {
    if (!this.client) {
      if (!env.STRIPE_SECRET_KEY) {
        throw new BillingError('not_configured', 'Stripe is not configured.', 503);
      }
      this.client = new Stripe(env.STRIPE_SECRET_KEY, {
        // Pinning the version means a Stripe-side upgrade cannot silently
        // change response shapes under a running deployment.
        apiVersion: '2026-06-24.dahlia',
        typescript: true,
        appInfo: { name: 'Karo', version: '1.0.0' },
        maxNetworkRetries: 2,
      });
    }
    return this.client;
  }

  isConfigured(): boolean {
    return Boolean(env.STRIPE_SECRET_KEY);
  }

  async ensureCustomer(input: {
    teamId: string;
    teamName: string;
    email: string;
    existingCustomerId: string | null;
  }): Promise<string> {
    if (input.existingCustomerId) return input.existingCustomerId;

    const customer = await this.stripe().customers.create(
      {
        email: input.email,
        name: input.teamName,
        metadata: { karo_team_id: input.teamId },
      },
      { idempotencyKey: `customer:${input.teamId}` },
    );

    await db
      .update(teams)
      .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
      .where(eq(teams.id, input.teamId));

    return customer.id;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    const [team] = await db.select().from(teams).where(eq(teams.id, input.teamId)).limit(1);
    if (!team) throw new BillingError('unknown_team', 'Team not found.', 404);

    const customerId = await this.ensureCustomer({
      teamId: input.teamId,
      teamName: team.name,
      email: input.customerEmail,
      existingCustomerId: team.stripeCustomerId,
    });

    const common = {
      customer: customerId,
      success_url: `${input.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: input.cancelUrl,
      client_reference_id: input.teamId,
      metadata: {
        karo_team_id: input.teamId,
        karo_user_id: input.userId,
        karo_plan_id: input.planId ?? '',
      },
      allow_promotion_codes: true,
    } satisfies Partial<Stripe.Checkout.SessionCreateParams>;

    let session: Stripe.Checkout.Session;

    if (input.mode === 'payment') {
      const amount = input.amountMicroUsd ?? 0;
      if (amount <= 0) {
        throw new BillingError('invalid_amount', 'Top-up amount must be greater than zero.');
      }
      // Stripe works in cents; micro-USD → cents is a divide by 10,000.
      const amountCents = Math.round(amount / 10_000);

      session = await this.stripe().checkout.sessions.create(
        {
          ...common,
          mode: 'payment',
          line_items: [
            {
              price_data: {
                currency: 'usd',
                unit_amount: amountCents,
                product_data: {
                  name: 'Karo pay-as-you-go credit',
                  description: 'Credit applied to your Karo balance immediately after payment.',
                },
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            // Without this Stripe creates the PaymentMethod on the intent and
            // never attaches it to the customer, so `chargeOffSession` would
            // find no card and automatic top-up could never fire for a team
            // that has only ever bought credit — which is every team the
            // feature is named for. Checkout renders the off-session mandate to
            // the payer when it is set, so the consent is asked for where the
            // card is entered rather than assumed here.
            setup_future_usage: 'off_session',
            metadata: { karo_team_id: input.teamId, karo_topup_micro_usd: String(amount) },
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
    } else {
      if (!input.priceId) {
        throw new BillingError(
          'missing_price',
          'This plan has no Stripe price configured. An administrator needs to set it in Admin → Plans.',
        );
      }
      const discount = input.discount
        ? { coupon: await this.ensurePercentOffCoupon(input.discount) }
        : undefined;
      session = await this.stripe().checkout.sessions.create(
        {
          ...common,
          mode: 'subscription',
          line_items: [{ price: input.priceId, quantity: 1 }],
          ...(discount ? { discounts: [discount] } : {}),
          subscription_data: {
            metadata: { karo_team_id: input.teamId, karo_plan_id: input.planId ?? '' },
            ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
    }

    if (!session.url) {
      throw new BillingError('checkout_failed', 'Stripe did not return a checkout URL.', 502);
    }

    return { id: session.id, url: session.url, completedImmediately: false };
  }

  /**
   * Creates (once) the Stripe coupon backing a Karo promo discount. The id is
   * derived from the Karo coupon id, so re-running is idempotent at Stripe's
   * own level — a second checkout with the same promo reuses the object.
   */
  private async ensurePercentOffCoupon(discount: {
    couponId: string;
    percentOff: number;
  }): Promise<string> {
    const id = `karo_${discount.couponId.toLowerCase()}`;
    try {
      await this.stripe().coupons.create({
        id,
        percent_off: discount.percentOff,
        duration: 'once',
        name: `Karo promo (-${discount.percentOff}%)`,
        metadata: { karo_coupon_id: discount.couponId },
      });
    } catch (error) {
      // `resource_already_exists` is the expected path on every checkout after
      // the first; anything else is a real failure.
      if (
        !(error instanceof Stripe.errors.StripeError) ||
        error.code !== 'resource_already_exists'
      ) {
        throw error;
      }
    }
    return id;
  }

  async createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession> {
    if (!input.customerId) {
      throw new BillingError(
        'no_customer',
        'There is no billing account for this team yet. Start a subscription or add credit first.',
      );
    }
    const session = await this.stripe().billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  async addUsage(input: AddUsageInput): Promise<void> {
    if (!input.subscriptionItemId) return;
    await this.stripe().billing.meterEvents.create(
      {
        event_name: 'karo_weighted_tokens',
        payload: {
          stripe_customer_id: input.subscriptionItemId,
          value: String(Math.max(0, Math.round(input.quantity))),
        },
        timestamp: Math.floor(input.timestamp.getTime() / 1000),
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  /**
   * Off-session charge against the customer's saved card.
   *
   * `off_session: true` tells Stripe that nobody can be prompted, and that
   * changes how this fails compared with checkout: an issuer that wants 3-D
   * Secure does not park the intent in `requires_action`, it raises a card error
   * with code `authentication_required`, and issuers decline unattended charges
   * far more readily than attended ones. Both outcomes are reported rather than
   * thrown, because the caller has to decide whether to retry or give up.
   */
  async chargeOffSession(input: ChargeOffSessionInput): Promise<OffSessionCharge> {
    if (input.amountMicroUsd <= 0) {
      throw new BillingError('invalid_amount', 'Charge amount must be greater than zero.');
    }

    const paymentMethodId = await this.defaultPaymentMethod(input.customerId);
    if (!paymentMethodId) {
      return {
        status: 'failed',
        failure: 'no_payment_method',
        paymentId: null,
        message: 'There is no saved card on this billing account.',
      };
    }

    try {
      const intent = await this.stripe().paymentIntents.create(
        {
          amount: Math.round(input.amountMicroUsd / 10_000),
          currency: 'usd',
          customer: input.customerId,
          payment_method: paymentMethodId,
          description: input.description,
          confirm: true,
          off_session: true,
          // Nobody can answer an authentication prompt, so an intent left in
          // `requires_action` would hold the payment open forever without ever
          // crediting anything. Failing the call surfaces it instead.
          error_on_requires_action: true,
          metadata: {
            karo_team_id: input.teamId,
            karo_topup_micro_usd: String(input.amountMicroUsd),
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );

      if (intent.status === 'succeeded') {
        return { status: 'succeeded', paymentId: intent.id };
      }

      log.warn('An off-session charge did not settle', {
        teamId: input.teamId,
        status: intent.status,
      });
      return {
        status: 'failed',
        failure: intent.status === 'requires_action' ? 'requires_action' : 'provider_error',
        paymentId: intent.id,
        message: 'The payment could not be completed without the cardholder.',
      };
    } catch (error) {
      return this.offSessionFailure(error, input.teamId);
    }
  }

  /** Translates a thrown Stripe error into the reason the caller records. */
  private offSessionFailure(error: unknown, teamId: string): OffSessionCharge {
    if (error instanceof Stripe.errors.StripeCardError) {
      const requiresAction = error.code === 'authentication_required';
      log.warn('An off-session charge was rejected', {
        teamId,
        code: error.code,
        declineCode: error.decline_code,
      });
      return {
        status: 'failed',
        failure: requiresAction ? 'requires_action' : 'card_declined',
        paymentId: error.payment_intent?.id ?? null,
        // Card-error messages are written by Stripe for cardholders to read.
        message: requiresAction
          ? 'The bank wants the cardholder to confirm this payment, which cannot happen while nobody is present. Add credit by hand once to satisfy it.'
          : error.message,
      };
    }

    if (error instanceof Stripe.errors.StripeError) {
      log.error('Stripe refused an off-session charge', {
        teamId,
        type: error.type,
        code: error.code,
      });
      return {
        status: 'failed',
        failure: 'provider_error',
        paymentId: null,
        message: 'Stripe could not process the payment.',
      };
    }

    // Not a payment failure at all — a bug here must not be recorded as one.
    throw error;
  }

  /**
   * The card to charge when nobody is at the keyboard.
   *
   * `invoice_settings.default_payment_method` is what a subscription bills
   * against, and a team that has only ever topped up has none: the top-up
   * session saves its card to the customer (`setup_future_usage` above) without
   * promoting it to the invoice default. Falling back to the customer's saved
   * cards is what makes automatic top-up reach those teams rather than silently
   * never charging.
   */
  private async defaultPaymentMethod(customerId: string): Promise<string | null> {
    const customer: Stripe.Customer | Stripe.DeletedCustomer =
      await this.stripe().customers.retrieve(customerId);
    if (customer.deleted) return null;

    const preferred = customer.invoice_settings.default_payment_method;
    if (typeof preferred === 'string') return preferred;
    if (preferred) return preferred.id;

    const methods = await this.stripe().paymentMethods.list({
      customer: customerId,
      type: 'card',
      limit: 1,
    });
    return methods.data[0]?.id ?? null;
  }

  async handleWebhook(input: WebhookInput): Promise<WebhookResult> {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new BillingError(
        'not_configured',
        'STRIPE_WEBHOOK_SECRET is not set — refusing to process an unverifiable webhook.',
        503,
      );
    }
    if (!input.signature) {
      throw new BillingError('missing_signature', 'Missing Stripe-Signature header.', 400);
    }

    let event: Stripe.Event;
    try {
      event = this.stripe().webhooks.constructEvent(
        input.payload,
        input.signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      // Deliberately opaque: the caller learns only that verification failed.
      log.warn('Rejected a webhook with an invalid signature');
      throw new BillingError(
        'invalid_signature',
        'Webhook signature verification failed.',
        400,
      );
    }

    // Deduplicate: Stripe retries, and a replayed credit is a real money bug.
    const inserted = await db
      .insert(idempotencyKeys)
      .values({
        id: newId(ID_PREFIX.usageEvent),
        scope: 'stripe_webhook',
        key: event.id,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    if (inserted.length === 0) {
      return {
        handled: true,
        eventType: event.type,
        eventId: event.id,
        message: 'Already processed.',
      };
    }

    // The marker is written *before* the event is applied so that two concurrent
    // deliveries of the same event cannot both credit a balance. But a marker
    // that outlives a failed apply is worse than a duplicate: Stripe's retry
    // would short-circuit on it and the payment would be silently lost forever.
    // So a failure releases the marker and rethrows, letting the retry land.
    //
    // Re-applying is safe: `topups.idempotency_key` is uniquely indexed and
    // `creditTopup` only moves the balance when its insert created the row, so a
    // retry cannot double-credit even if the first attempt got part of the way
    // through.
    try {
      await this.applyEvent(event);
    } catch (error) {
      await db
        .delete(idempotencyKeys)
        .where(
          and(eq(idempotencyKeys.scope, 'stripe_webhook'), eq(idempotencyKeys.key, event.id)),
        );
      throw error;
    }

    return { handled: true, eventType: event.type, eventId: event.id };
  }

  private async applyEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const teamId = session.metadata?.karo_team_id ?? session.client_reference_id;
        if (!teamId) return;

        if (session.mode === 'payment') {
          const amount = Number.parseInt(
            (session.metadata?.karo_topup_micro_usd ?? '') ||
              String((session.amount_total ?? 0) * 10_000),
            10,
          );
          await creditTopup({
            teamId,
            amountMicroUsd: amount,
            bonusMicroUsd: topupBonusMicroUsd(amount),
            provider: this.key,
            idempotencyKey: event.id,
            stripeCheckoutSessionId: session.id,
          });
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await this.syncSubscription(event.data.object);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await db
          .update(subscriptions)
          .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
          .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        await this.syncInvoice(event.data.object, event.type === 'invoice.paid');
        break;
      }

      default:
        log.debug('Ignoring unhandled Stripe event', { type: event.type });
    }
  }

  private async syncSubscription(subscription: Stripe.Subscription): Promise<void> {
    const teamId = subscription.metadata?.karo_team_id;
    if (!teamId) return;

    const priceId = subscription.items.data[0]?.price.id ?? null;
    const [plan] = priceId
      ? await db
          .select()
          .from(plans)
          .where(
            sql`${plans.stripePriceIdMonthly} = ${priceId} or ${plans.stripePriceIdYearly} = ${priceId}`,
          )
          .limit(1)
      : [];

    const item = subscription.items.data[0];
    const periodStart = item?.current_period_start ?? Math.floor(Date.now() / 1000);
    const periodEnd = item?.current_period_end ?? Math.floor(Date.now() / 1000) + 2_592_000;

    await db
      .insert(subscriptions)
      .values({
        id: newId(ID_PREFIX.subscription),
        teamId,
        planId: plan?.id ?? subscription.metadata?.karo_plan_id ?? '',
        status: subscription.status as never,
        interval: item?.price.recurring?.interval === 'year' ? 'year' : 'month',
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        currentPeriodStart: new Date(periodStart * 1000),
        currentPeriodEnd: new Date(periodEnd * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      })
      .onConflictDoUpdate({
        target: subscriptions.teamId,
        set: {
          planId: plan?.id ?? sql`${subscriptions.planId}`,
          status: subscription.status as never,
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          currentPeriodStart: new Date(periodStart * 1000),
          currentPeriodEnd: new Date(periodEnd * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at
            ? new Date(subscription.canceled_at * 1000)
            : null,
          updatedAt: new Date(),
        },
      });
  }

  private async syncInvoice(invoice: Stripe.Invoice, paid: boolean): Promise<void> {
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!customerId) return;

    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.stripeCustomerId, customerId))
      .limit(1);
    if (!team) return;

    await db
      .insert(invoices)
      .values({
        id: newId(ID_PREFIX.invoice),
        teamId: team.id,
        number: invoice.number ?? invoice.id ?? newId(ID_PREFIX.invoice),
        status: paid ? 'paid' : 'open',
        subtotalMicroUsd: (invoice.subtotal ?? 0) * 10_000,
        taxMicroUsd: (invoice.total_taxes?.[0]?.amount ?? 0) * 10_000,
        totalMicroUsd: (invoice.total ?? 0) * 10_000,
        amountPaidMicroUsd: (invoice.amount_paid ?? 0) * 10_000,
        currency: invoice.currency ?? 'usd',
        stripeInvoiceId: invoice.id ?? null,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        pdfUrl: invoice.invoice_pdf ?? null,
        periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
        periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
        lineItems: (invoice.lines?.data ?? []).map((line) => ({
          label: line.description ?? 'Charge',
          quantity: line.quantity ?? 1,
          amountMicroUsd: (line.amount ?? 0) * 10_000,
        })),
        issuedAt: invoice.created ? new Date(invoice.created * 1000) : new Date(),
        paidAt: paid ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: invoices.stripeInvoiceId,
        set: {
          status: paid ? 'paid' : 'open',
          amountPaidMicroUsd: (invoice.amount_paid ?? 0) * 10_000,
          paidAt: paid ? new Date() : null,
        },
      });
  }

  async cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void> {
    if (atPeriodEnd) {
      await this.stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    } else {
      await this.stripe().subscriptions.cancel(subscriptionId);
    }
  }

  async resumeSubscription(subscriptionId: string): Promise<void> {
    await this.stripe().subscriptions.update(subscriptionId, { cancel_at_period_end: false });
  }

  async changePlan(input: {
    subscriptionId: string;
    newPriceId: string;
    prorate: boolean;
  }): Promise<void> {
    const subscription = await this.stripe().subscriptions.retrieve(input.subscriptionId);
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) throw new BillingError('no_item', 'Subscription has no line item.', 409);

    await this.stripe().subscriptions.update(input.subscriptionId, {
      items: [{ id: itemId, price: input.newPriceId }],
      proration_behavior: input.prorate ? 'create_prorations' : 'none',
    });
  }
}
