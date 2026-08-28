/**
 * Billing provider abstraction.
 *
 * Karo ships with two implementations: Stripe, and a mock that simulates the
 * whole flow locally. The mock is not a stub — it creates real rows, moves real
 * balances and drives the same webhook handler, so `npm run dev` with no Stripe
 * account exercises every billing code path.
 */

export type CheckoutMode = 'subscription' | 'payment';

export type CreateCheckoutSessionInput = {
  teamId: string;
  userId: string;
  customerEmail: string;
  mode: CheckoutMode;
  /** Subscription checkout. */
  planId?: string;
  priceId?: string | null;
  interval?: 'month' | 'year';
  trialDays?: number;
  /** One-off top-up, integer micro-USD. */
  amountMicroUsd?: number;
  /**
   * An admin-minted plan discount locked in by a redeemed promo code, priced
   * into THIS checkout session. (Codes typed on the payment page itself are
   * Stripe promotion codes, governed by `allow_promotion_codes`.)
   */
  discount?: { couponId: string; percentOff: number } | null;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export type CheckoutSession = {
  id: string;
  url: string;
  /** True when the mock provider completed the purchase inline. */
  completedImmediately: boolean;
};

export type CreatePortalSessionInput = {
  teamId: string;
  customerId: string | null;
  returnUrl: string;
};

export type PortalSession = { url: string };

export type AddUsageInput = {
  teamId: string;
  subscriptionItemId?: string | null;
  /** Metered quantity, in whatever unit the price is denominated in. */
  quantity: number;
  timestamp: Date;
  idempotencyKey: string;
};

export type ChargeOffSessionInput = {
  teamId: string;
  /** Provider customer id — the caller has already ensured one exists. */
  customerId: string;
  /** Integer micro-USD. */
  amountMicroUsd: number;
  /** Shown on the cardholder's statement and in the provider's dashboard. */
  description: string;
  idempotencyKey: string;
};

/**
 * Why an off-session charge did not go through.
 *
 * The split matters because the answers differ: `requires_action` is only fixed
 * by the cardholder paying once interactively, `no_payment_method` by them
 * adding a card, and `card_declined` by their bank. `requires_action` is also
 * the failure an on-session checkout can never produce, which is why an
 * off-session charge needs its own vocabulary rather than a boolean.
 */
export type OffSessionFailure =
  'no_payment_method' | 'requires_action' | 'card_declined' | 'provider_error';

/** Payment outcomes are returned rather than thrown — the caller counts them. */
export type OffSessionCharge =
  | { status: 'succeeded'; paymentId: string }
  | {
      status: 'failed';
      failure: OffSessionFailure;
      /** Null when the provider never got as far as creating a payment. */
      paymentId: string | null;
      /** Safe to show to a team owner. */
      message: string;
    };

export type WebhookInput = {
  payload: string;
  signature: string | null;
  headers: Headers;
};

export type WebhookResult = {
  handled: boolean;
  eventType: string;
  eventId: string;
  message?: string;
};

export interface BillingProvider {
  readonly key: 'stripe' | 'mock';
  readonly displayName: string;
  isConfigured(): boolean;

  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;
  createPortalSession(input: CreatePortalSessionInput): Promise<PortalSession>;
  addUsage(input: AddUsageInput): Promise<void>;
  handleWebhook(input: WebhookInput): Promise<WebhookResult>;

  /**
   * Charges the customer's saved default payment method with nobody at the
   * keyboard. Only a broken configuration throws; a payment that simply did not
   * go through comes back as `status: 'failed'` so the caller can count it.
   */
  chargeOffSession(input: ChargeOffSessionInput): Promise<OffSessionCharge>;

  /** Ensures a customer record exists and returns its provider id. */
  ensureCustomer(input: {
    teamId: string;
    teamName: string;
    email: string;
    existingCustomerId: string | null;
  }): Promise<string>;

  cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  resumeSubscription(subscriptionId: string): Promise<void>;
  changePlan(input: {
    subscriptionId: string;
    newPriceId: string;
    prorate: boolean;
  }): Promise<void>;
}

export class BillingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.status = status;
  }
}
