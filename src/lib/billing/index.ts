import 'server-only';

import { env } from '@/lib/env';
import { MockBillingProvider } from './mock';
import { StripeBillingProvider } from './stripe';
import type { BillingProvider } from './types';

let stripe: StripeBillingProvider | null = null;
const mock = new MockBillingProvider();

/**
 * Resolves the billing provider. Stripe when it is configured, the simulator
 * otherwise — so a fresh clone has a complete, working billing surface without
 * a Stripe account.
 */
export function getBillingProvider(): BillingProvider {
  if (env.BILLING_PROVIDER === 'stripe') {
    stripe ??= new StripeBillingProvider();
    if (stripe.isConfigured()) return stripe;
  }
  return mock;
}

export function isSimulatedBilling(): boolean {
  return getBillingProvider().key === 'mock';
}

export { MockBillingProvider, StripeBillingProvider };
export * from './types';
