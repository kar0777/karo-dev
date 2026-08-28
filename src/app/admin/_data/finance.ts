import 'server-only';

/**
 * The money model behind every admin number.
 *
 * Two things are deliberately explicit here rather than buried in a query:
 *
 *  1. **Recognised revenue ≠ cash collected.** A pay-as-you-go top-up is cash
 *     that has not been earned yet; the charge that draws it down is. Counting
 *     both would double the top line, so the dashboards report recognised
 *     revenue (subscription, prorated over the window, plus metered charges)
 *     and show cash collected beside it as a separate figure.
 *  2. **Stripe fees are an estimate, not a fact.** Karo does not import Stripe's
 *     balance transactions, so the fee line is modelled from the standard
 *     online card rate. It is labelled "estimated" everywhere it appears.
 */

/** Stripe's standard online card rate: 2.9% + $0.30 per successful charge. */
export const STRIPE_PERCENT_BPS = 290;
export const STRIPE_FIXED_MICRO_USD = 300_000;

const DAYS_PER_MONTH = 30;

export type BillingInterval = 'month' | 'year';

/** Normalises a subscription to a monthly figure, whatever it is billed on. */
export function monthlyPriceMicroUsd(
  plan: { priceMicroUsdMonthly: number; priceMicroUsdYearly: number },
  interval: string,
): number {
  if (interval === 'year') {
    return plan.priceMicroUsdYearly > 0
      ? Math.round(plan.priceMicroUsdYearly / 12)
      : plan.priceMicroUsdMonthly;
  }
  return plan.priceMicroUsdMonthly;
}

/** Subscription revenue earned inside a window of `days` days. */
export function proratedSubscriptionRevenue(monthlyMicroUsd: number, days: number): number {
  return Math.round((monthlyMicroUsd * days) / DAYS_PER_MONTH);
}

export type StripeFeeInput = {
  /** Total value of card charges that actually settled in the window. */
  cashMicroUsd: number;
  /** How many separate charges that was. */
  chargeCount: number;
};

export function estimateStripeFees(input: StripeFeeInput): number {
  if (input.cashMicroUsd <= 0 && input.chargeCount <= 0) return 0;
  return Math.round(
    (input.cashMicroUsd * STRIPE_PERCENT_BPS) / 10_000 +
      input.chargeCount * STRIPE_FIXED_MICRO_USD,
  );
}

export type MarginInput = {
  revenueMicroUsd: number;
  modelUpstreamMicroUsd: number;
  computeUpstreamMicroUsd: number;
  stripeFeesMicroUsd: number;
};

export type MarginResult = {
  revenueMicroUsd: number;
  costMicroUsd: number;
  grossMarginMicroUsd: number;
  /** `null` when there is no revenue to divide by — never render 0% for that. */
  marginFraction: number | null;
};

export function grossMargin(input: MarginInput): MarginResult {
  const cost =
    input.modelUpstreamMicroUsd + input.computeUpstreamMicroUsd + input.stripeFeesMicroUsd;
  const margin = input.revenueMicroUsd - cost;
  return {
    revenueMicroUsd: input.revenueMicroUsd,
    costMicroUsd: cost,
    grossMarginMicroUsd: margin,
    marginFraction: input.revenueMicroUsd > 0 ? margin / input.revenueMicroUsd : null,
  };
}

/** Percentage change between two periods, or `undefined` when there is no base. */
export function deltaPercent(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return ((current - previous) / Math.abs(previous)) * 100;
}
