import { describe, expect, it } from 'vitest';

import {
  applyMargin,
  checkSpendGuard,
  estimateTaskCost,
  type PlanPricingConfig,
  settleComputeUsage,
  settleModelUsage,
} from '@/lib/pricing/calculator';
import type { TokenPrices } from '@/lib/pricing/weighted-tokens';

const SONNET: TokenPrices = {
  inputMicroUsdPerMtok: 600_000,
  outputMicroUsdPerMtok: 3_000_000,
  cachedInputMicroUsdPerMtok: 60_000,
  cacheWriteMicroUsdPerMtok: 750_000,
};

const PRO: PlanPricingConfig = {
  tier: 'pro',
  marginBps: 2_000,
  includedWeightedTokens: 6_000_000,
  includedComputeHours: 100,
  overageMicroUsdPerMWeighted: 4_000_000, // $4 per 1M weighted
  overageMicroUsdPerComputeHour: 15_000,
};

const PAYG: PlanPricingConfig = {
  tier: 'payg',
  marginBps: 2_000,
  includedWeightedTokens: 0,
  includedComputeHours: 0,
  overageMicroUsdPerMWeighted: 0,
  overageMicroUsdPerComputeHour: 0,
};

describe('applyMargin', () => {
  it('adds the configured margin in basis points', () => {
    expect(applyMargin(100_000, 2_000)).toBe(120_000);
    expect(applyMargin(100_000, 0)).toBe(100_000);
    expect(applyMargin(100_000, 10_000)).toBe(200_000);
  });

  it('treats a negative margin as zero rather than charging below cost', () => {
    expect(applyMargin(100_000, -5_000)).toBe(100_000);
  });

  it('returns an integer micro-USD amount', () => {
    expect(Number.isInteger(applyMargin(333, 1_750))).toBe(true);
  });
});

describe('settleModelUsage — BYOK', () => {
  it('charges nothing and consumes no included credits', () => {
    const result = settleModelUsage({
      counts: { inputTokens: 500_000, outputTokens: 100_000 },
      prices: SONNET,
      plan: PRO,
      quotaRemainingWeighted: 6_000_000,
      usedByok: true,
    });

    expect(result.chargedMicroUsd).toBe(0);
    expect(result.upstreamCostMicroUsd).toBe(0);
    expect(result.quotaConsumed).toBe(0);
    expect(result.settlement).toBe('byok');
    expect(result.balanceDeltaMicroUsd).toBe(0);
    expect(result.explanation).toContain('did not use your included Karo model credits');
  });

  it('still reports the weighted token count, so usage stays visible', () => {
    const result = settleModelUsage({
      counts: { inputTokens: 10_000, outputTokens: 1_000 },
      prices: SONNET,
      plan: PRO,
      quotaRemainingWeighted: 6_000_000,
      usedByok: true,
    });
    expect(result.weightedTokens).toBe(15_000);
  });
});

describe('settleModelUsage — pay as you go', () => {
  it('charges upstream cost plus margin and draws it from the balance', () => {
    const result = settleModelUsage({
      counts: { inputTokens: 1_000_000, outputTokens: 0 },
      prices: SONNET,
      plan: PAYG,
      quotaRemainingWeighted: 0,
    });

    expect(result.upstreamCostMicroUsd).toBe(600_000);
    expect(result.chargedMicroUsd).toBe(720_000);
    expect(result.grossMarginMicroUsd).toBe(120_000);
    expect(result.settlement).toBe('payg');
    expect(result.balanceDeltaMicroUsd).toBe(-720_000);
  });

  it('never consumes quota, because there is none', () => {
    const result = settleModelUsage({
      counts: { inputTokens: 5_000, outputTokens: 500 },
      prices: SONNET,
      plan: PAYG,
      quotaRemainingWeighted: 0,
    });
    expect(result.quotaConsumed).toBe(0);
    expect(result.overageWeighted).toBe(result.weightedTokens);
  });
});

describe('settleModelUsage — subscription quota', () => {
  it('charges nothing while the allowance covers the request', () => {
    const result = settleModelUsage({
      counts: { inputTokens: 10_000, outputTokens: 2_000 },
      prices: SONNET,
      plan: PRO,
      quotaRemainingWeighted: 6_000_000,
      hasActiveSubscription: true,
    });

    expect(result.weightedTokens).toBe(20_000);
    expect(result.quotaConsumed).toBe(20_000);
    expect(result.chargedMicroUsd).toBe(0);
    expect(result.settlement).toBe('quota');
    // Quota usage is a real cost to Karo even though the customer pays nothing
    // extra — margin on this request is negative, and the model says so.
    expect(result.grossMarginMicroUsd).toBeLessThan(0);
  });

  it('splits a request that straddles the end of the allowance', () => {
    const result = settleModelUsage({
      counts: { inputTokens: 10_000, outputTokens: 2_000 }, // 20_000 weighted
      prices: SONNET,
      plan: PRO,
      quotaRemainingWeighted: 5_000,
      hasActiveSubscription: true,
    });

    expect(result.quotaConsumed).toBe(5_000);
    expect(result.overageWeighted).toBe(15_000);
    expect(result.settlement).toBe('mixed');
    // 15_000 weighted at $4 per 1M
    expect(result.chargedMicroUsd).toBe(60_000);
    expect(result.explanation).toContain('finished your monthly allowance');
  });

  it('bills entirely as overage once the allowance is gone', () => {
    const result = settleModelUsage({
      counts: { inputTokens: 10_000, outputTokens: 2_000 },
      prices: SONNET,
      plan: PRO,
      quotaRemainingWeighted: 0,
      hasActiveSubscription: true,
    });

    expect(result.quotaConsumed).toBe(0);
    expect(result.settlement).toBe('overage');
    expect(result.chargedMicroUsd).toBe(80_000); // 20_000 weighted at $4/M
  });

  it('falls back to cost-plus when the plan publishes no overage rate', () => {
    const result = settleModelUsage({
      counts: { inputTokens: 1_000_000, outputTokens: 0 },
      prices: SONNET,
      plan: { ...PRO, overageMicroUsdPerMWeighted: 0 },
      quotaRemainingWeighted: 0,
      hasActiveSubscription: true,
    });
    expect(result.chargedMicroUsd).toBe(applyMargin(600_000, PRO.marginBps));
  });

  it('keeps the overage charge proportional to the overage share', () => {
    const half = settleModelUsage({
      counts: { inputTokens: 1_000_000, outputTokens: 0 },
      prices: SONNET,
      plan: { ...PRO, overageMicroUsdPerMWeighted: 0 },
      quotaRemainingWeighted: 500_000, // exactly half the 1M weighted tokens
      hasActiveSubscription: true,
    });
    // Only half the request is overage, so only half the upstream cost is
    // marked up.
    expect(half.chargedMicroUsd).toBe(applyMargin(300_000, PRO.marginBps));
  });
});

describe('settleComputeUsage', () => {
  it('never bills compute that ran on the user own server', () => {
    const result = settleComputeUsage({
      billedComputeHours: 12,
      upstreamMicroUsdPerBaseHour: 9_000,
      plan: PRO,
      quotaRemainingHours: 0,
      isOwnServer: true,
    });
    expect(result.chargedMicroUsd).toBe(0);
    expect(result.settlement).toBe('byok');
    expect(result.explanation).toContain('own server');
  });

  it('draws from the included compute hours first', () => {
    const result = settleComputeUsage({
      billedComputeHours: 2,
      upstreamMicroUsdPerBaseHour: 9_000,
      plan: PRO,
      quotaRemainingHours: 100,
      hasActiveSubscription: true,
    });
    expect(result.quotaConsumedHours).toBe(2);
    expect(result.chargedMicroUsd).toBe(0);
    expect(result.settlement).toBe('quota');
  });

  it('bills the excess at the published overage rate', () => {
    const result = settleComputeUsage({
      billedComputeHours: 10,
      upstreamMicroUsdPerBaseHour: 9_000,
      plan: PRO,
      quotaRemainingHours: 4,
      hasActiveSubscription: true,
    });
    expect(result.quotaConsumedHours).toBe(4);
    expect(result.overageHours).toBe(6);
    expect(result.chargedMicroUsd).toBe(6 * 15_000);
    expect(result.settlement).toBe('mixed');
  });

  it('bills PAYG compute per second from the balance', () => {
    const result = settleComputeUsage({
      billedComputeHours: 1,
      upstreamMicroUsdPerBaseHour: 9_000,
      plan: PAYG,
      quotaRemainingHours: 0,
    });
    expect(result.settlement).toBe('payg');
    expect(result.chargedMicroUsd).toBe(10_800);
    expect(result.balanceDeltaMicroUsd).toBe(-10_800);
  });
});

describe('estimateTaskCost', () => {
  it('grows the context every iteration, so the estimate is not naive', () => {
    const single = estimateTaskCost({
      promptTokens: 4_000,
      expectedIterations: 1,
      expectedOutputTokensPerIteration: 700,
      contextGrowthPerIteration: 900,
      prices: SONNET,
      plan: PAYG,
      quotaRemainingWeighted: 0,
      computeMultiplier: 1,
      expectedMinutes: 2,
      upstreamMicroUsdPerBaseHour: 9_000,
    });
    const many = estimateTaskCost({
      promptTokens: 4_000,
      expectedIterations: 6,
      expectedOutputTokensPerIteration: 700,
      contextGrowthPerIteration: 900,
      prices: SONNET,
      plan: PAYG,
      quotaRemainingWeighted: 0,
      computeMultiplier: 1,
      expectedMinutes: 8,
      upstreamMicroUsdPerBaseHour: 9_000,
    });

    // Six iterations cost far more than six times one, because the context
    // carried into each call keeps growing.
    expect(many.estimatedInputTokens).toBeGreaterThan(single.estimatedInputTokens * 6);
    expect(many.totalMicroUsd).toBeGreaterThan(single.totalMicroUsd);
  });

  it('lowers its stated confidence as the run gets longer', () => {
    const base = {
      promptTokens: 2_000,
      expectedOutputTokensPerIteration: 500,
      contextGrowthPerIteration: 800,
      prices: SONNET,
      plan: PAYG,
      quotaRemainingWeighted: 0,
      computeMultiplier: 1,
      expectedMinutes: 4,
      upstreamMicroUsdPerBaseHour: 9_000,
    };
    expect(estimateTaskCost({ ...base, expectedIterations: 2 }).confidence).toBe('high');
    expect(estimateTaskCost({ ...base, expectedIterations: 8 }).confidence).toBe('medium');
    expect(estimateTaskCost({ ...base, expectedIterations: 20 }).confidence).toBe('low');
  });

  it('flags an expensive task above the configured threshold', () => {
    const result = estimateTaskCost({
      promptTokens: 200_000,
      expectedIterations: 20,
      expectedOutputTokensPerIteration: 4_000,
      contextGrowthPerIteration: 8_000,
      prices: SONNET,
      plan: PAYG,
      quotaRemainingWeighted: 0,
      computeMultiplier: 16,
      expectedMinutes: 45,
      upstreamMicroUsdPerBaseHour: 9_000,
      expensiveThresholdMicroUsd: 1_000_000,
    });
    expect(result.isExpensive).toBe(true);
    expect(result.totalMicroUsd).toBeGreaterThan(1_000_000);
  });

  it('always runs at least one iteration', () => {
    const result = estimateTaskCost({
      promptTokens: 1_000,
      expectedIterations: 0,
      expectedOutputTokensPerIteration: 100,
      contextGrowthPerIteration: 0,
      prices: SONNET,
      plan: PAYG,
      quotaRemainingWeighted: 0,
      computeMultiplier: 1,
      expectedMinutes: 1,
      upstreamMicroUsdPerBaseHour: 9_000,
    });
    expect(result.estimatedInputTokens).toBe(1_000);
  });
});

describe('checkSpendGuard', () => {
  const base = {
    estimatedChargeMicroUsd: 100_000,
    balanceMicroUsd: 25_000_000,
    creditLimitMicroUsd: 0,
    quotaRemainingWeighted: 0,
    estimatedWeightedTokens: 50_000,
    spendCapMicroUsd: 0,
    periodSpendMicroUsd: 0,
    hasActiveSubscription: false,
  };

  it('allows a run the balance can cover', () => {
    expect(checkSpendGuard(base).allowed).toBe(true);
  });

  it('allows a run entirely covered by the included allowance, whatever the balance', () => {
    const result = checkSpendGuard({
      ...base,
      balanceMicroUsd: 0,
      quotaRemainingWeighted: 1_000_000,
      hasActiveSubscription: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks and asks for a top-up when the balance is too low', () => {
    const result = checkSpendGuard({ ...base, balanceMicroUsd: 1_000 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('payment_required');
    expect(result.actionHref).toBe('/app/billing');
  });

  it('blocks a subscriber whose allowance and balance are both exhausted', () => {
    const result = checkSpendGuard({
      ...base,
      hasActiveSubscription: true,
      subscriptionStatus: 'active',
      balanceMicroUsd: 0,
      quotaRemainingWeighted: 0,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('quota_exceeded');
  });

  it('honours the monthly spending cap', () => {
    const result = checkSpendGuard({
      ...base,
      spendCapMicroUsd: 1_000_000,
      periodSpendMicroUsd: 950_000,
      estimatedChargeMicroUsd: 100_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('spend_cap_reached');
  });

  it('lets a run through when it fits under the cap', () => {
    const result = checkSpendGuard({
      ...base,
      spendCapMicroUsd: 1_000_000,
      periodSpendMicroUsd: 500_000,
      estimatedChargeMicroUsd: 100_000,
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks a past-due subscription before anything else is considered', () => {
    const result = checkSpendGuard({
      ...base,
      hasActiveSubscription: true,
      subscriptionStatus: 'past_due',
      quotaRemainingWeighted: 10_000_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_inactive');
    expect(result.message).toContain('past due');
  });

  // The guard cannot lean on `hasActiveSubscription` here: callers derive that
  // flag from the status, so it is false for exactly the subscribers whose
  // payment failed. Before this case existed, a past-due team was quietly
  // re-priced as pay-as-you-go instead of being asked to fix its card.
  it('blocks a past-due subscriber even though that makes the subscription inactive', () => {
    const result = checkSpendGuard({
      ...base,
      hasActiveSubscription: false,
      subscriptionStatus: 'past_due',
      quotaRemainingWeighted: 0,
      balanceMicroUsd: 25_000_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('subscription_inactive');
    expect(result.actionHref).toBe('/app/billing');
  });

  it('blocks an unpaid or incomplete subscription for the same reason', () => {
    for (const status of ['unpaid', 'incomplete']) {
      const result = checkSpendGuard({ ...base, subscriptionStatus: status });
      expect(result.reason).toBe('subscription_inactive');
    }
  });

  // A cancelled or paused team has no payment to fix, so it falls through to
  // pay-as-you-go pricing rather than being locked out.
  it('lets a cancelled or paused team keep running on its balance', () => {
    for (const status of ['canceled', 'incomplete_expired', 'paused']) {
      const result = checkSpendGuard({ ...base, subscriptionStatus: status });
      expect(result.allowed).toBe(true);
    }
  });

  it('uses the credit limit as headroom below zero', () => {
    const result = checkSpendGuard({
      ...base,
      balanceMicroUsd: 0,
      creditLimitMicroUsd: 500_000,
      estimatedChargeMicroUsd: 100_000,
    });
    expect(result.allowed).toBe(true);
  });

  it('returns empty copy when it allows, so callers never render a stray message', () => {
    const result = checkSpendGuard(base);
    expect(result.title).toBe('');
    expect(result.message).toBe('');
  });
});
