import {
  calculateUpstreamCostMicroUsd,
  calculateWeightedTokens,
  type TokenCounts,
  type TokenPrices,
} from './weighted-tokens';

/**
 * Settlement: turning "this request used N weighted tokens" into "this is what
 * the team is charged, and where it came from".
 *
 * Order of precedence:
 *   1. **BYOK** — the user paid the provider directly. Karo charges nothing and
 *      does not touch the included allowance.
 *   2. **Included quota** — subscription allowance, consumed first.
 *   3. **Overage / PAYG balance** — anything past the allowance, priced either
 *      at the plan's published overage rate or at upstream cost plus margin.
 */

export type PlanPricingConfig = {
  tier: 'payg' | 'lite' | 'pro' | 'scale' | 'ultra';
  marginBps: number;
  includedWeightedTokens: number;
  includedComputeHours: number;
  overageMicroUsdPerMWeighted: number;
  overageMicroUsdPerComputeHour: number;
};

export type SettlementSource = 'byok' | 'quota' | 'payg' | 'overage' | 'mixed';

export type ModelSettlement = {
  weightedTokens: number;
  upstreamCostMicroUsd: number;
  chargedMicroUsd: number;
  grossMarginMicroUsd: number;
  settlement: SettlementSource;
  /** Weighted tokens taken out of the subscription allowance. */
  quotaConsumed: number;
  /** Weighted tokens billed beyond the allowance. */
  overageWeighted: number;
  balanceDeltaMicroUsd: number;
  explanation: string;
};

export function applyMargin(upstreamMicroUsd: number, marginBps: number): number {
  return Math.round(upstreamMicroUsd * (1 + Math.max(0, marginBps) / 10_000));
}

export type SettleModelUsageInput = {
  counts: TokenCounts;
  prices: TokenPrices;
  plan: PlanPricingConfig;
  /** Remaining included weighted tokens in the current period. */
  quotaRemainingWeighted: number;
  usedByok?: boolean;
  hasActiveSubscription?: boolean;
};

export function settleModelUsage(input: SettleModelUsageInput): ModelSettlement {
  const { weightedTokens } = calculateWeightedTokens(input.counts, input.prices);
  const upstreamCostMicroUsd = calculateUpstreamCostMicroUsd(input.counts, input.prices);

  if (input.usedByok) {
    return {
      weightedTokens,
      upstreamCostMicroUsd: 0,
      chargedMicroUsd: 0,
      grossMarginMicroUsd: 0,
      settlement: 'byok',
      quotaConsumed: 0,
      overageWeighted: 0,
      balanceDeltaMicroUsd: 0,
      explanation:
        'Billed directly to your own API key. This request did not use your included Karo model credits.',
    };
  }

  const hasSubscription = input.hasActiveSubscription ?? input.plan.tier !== 'payg';

  if (!hasSubscription) {
    const chargedMicroUsd = applyMargin(upstreamCostMicroUsd, input.plan.marginBps);
    return {
      weightedTokens,
      upstreamCostMicroUsd,
      chargedMicroUsd,
      grossMarginMicroUsd: chargedMicroUsd - upstreamCostMicroUsd,
      settlement: 'payg',
      quotaConsumed: 0,
      overageWeighted: weightedTokens,
      balanceDeltaMicroUsd: -chargedMicroUsd,
      explanation: `Pay as you go: upstream cost plus a ${(input.plan.marginBps / 100).toFixed(0)}% platform margin, drawn from your balance.`,
    };
  }

  const quotaConsumed = Math.max(0, Math.min(weightedTokens, input.quotaRemainingWeighted));
  const overageWeighted = weightedTokens - quotaConsumed;

  if (overageWeighted === 0) {
    return {
      weightedTokens,
      upstreamCostMicroUsd,
      chargedMicroUsd: 0,
      grossMarginMicroUsd: -upstreamCostMicroUsd,
      settlement: 'quota',
      quotaConsumed,
      overageWeighted: 0,
      balanceDeltaMicroUsd: 0,
      explanation: `Covered by your plan: ${quotaConsumed.toLocaleString('en-US')} weighted tokens deducted from this month's allowance.`,
    };
  }

  // Overage: published rate if the plan sets one, otherwise cost-plus.
  const overageShare = weightedTokens > 0 ? overageWeighted / weightedTokens : 0;
  const overageUpstream = Math.round(upstreamCostMicroUsd * overageShare);

  const chargedMicroUsd =
    input.plan.overageMicroUsdPerMWeighted > 0
      ? Math.round((overageWeighted / 1_000_000) * input.plan.overageMicroUsdPerMWeighted)
      : applyMargin(overageUpstream, input.plan.marginBps);

  return {
    weightedTokens,
    upstreamCostMicroUsd,
    chargedMicroUsd,
    grossMarginMicroUsd: chargedMicroUsd - overageUpstream,
    settlement: quotaConsumed > 0 ? 'mixed' : 'overage',
    quotaConsumed,
    overageWeighted,
    balanceDeltaMicroUsd: -chargedMicroUsd,
    explanation:
      quotaConsumed > 0
        ? `${quotaConsumed.toLocaleString('en-US')} weighted tokens finished your monthly allowance; the remaining ${overageWeighted.toLocaleString('en-US')} were billed as overage.`
        : `Monthly allowance is spent — ${overageWeighted.toLocaleString('en-US')} weighted tokens billed as overage.`,
  };
}

/* ------------------------------------------------------------------ *
 *  Compute settlement
 * ------------------------------------------------------------------ */

export type ComputeSettlement = {
  billedComputeHours: number;
  upstreamCostMicroUsd: number;
  chargedMicroUsd: number;
  grossMarginMicroUsd: number;
  settlement: SettlementSource;
  quotaConsumedHours: number;
  overageHours: number;
  balanceDeltaMicroUsd: number;
  explanation: string;
};

export type SettleComputeInput = {
  billedComputeHours: number;
  upstreamMicroUsdPerBaseHour: number;
  plan: PlanPricingConfig;
  quotaRemainingHours: number;
  hasActiveSubscription?: boolean;
  /** BYOS runs on the user's own hardware: metered for visibility, never billed. */
  isOwnServer?: boolean;
};

export function settleComputeUsage(input: SettleComputeInput): ComputeSettlement {
  const hours = Math.max(0, input.billedComputeHours);
  const upstreamCostMicroUsd = Math.round(hours * input.upstreamMicroUsdPerBaseHour);

  if (input.isOwnServer) {
    return {
      billedComputeHours: hours,
      upstreamCostMicroUsd: 0,
      chargedMicroUsd: 0,
      grossMarginMicroUsd: 0,
      settlement: 'byok',
      quotaConsumedHours: 0,
      overageHours: 0,
      balanceDeltaMicroUsd: 0,
      explanation: 'Ran on your own server — metered for visibility, not billed.',
    };
  }

  const hasSubscription = input.hasActiveSubscription ?? input.plan.tier !== 'payg';

  if (!hasSubscription) {
    const chargedMicroUsd = applyMargin(upstreamCostMicroUsd, input.plan.marginBps);
    return {
      billedComputeHours: hours,
      upstreamCostMicroUsd,
      chargedMicroUsd,
      grossMarginMicroUsd: chargedMicroUsd - upstreamCostMicroUsd,
      settlement: 'payg',
      quotaConsumedHours: 0,
      overageHours: hours,
      balanceDeltaMicroUsd: -chargedMicroUsd,
      explanation: 'Compute billed per second from your pay-as-you-go balance.',
    };
  }

  const quotaConsumedHours = Math.min(hours, Math.max(0, input.quotaRemainingHours));
  const overageHours = Math.round((hours - quotaConsumedHours) * 10_000) / 10_000;

  if (overageHours <= 0) {
    return {
      billedComputeHours: hours,
      upstreamCostMicroUsd,
      chargedMicroUsd: 0,
      grossMarginMicroUsd: -upstreamCostMicroUsd,
      settlement: 'quota',
      quotaConsumedHours,
      overageHours: 0,
      balanceDeltaMicroUsd: 0,
      explanation: `${quotaConsumedHours.toFixed(2)} compute hours deducted from your plan allowance.`,
    };
  }

  const overageUpstream = Math.round(overageHours * input.upstreamMicroUsdPerBaseHour);
  const chargedMicroUsd =
    input.plan.overageMicroUsdPerComputeHour > 0
      ? Math.round(overageHours * input.plan.overageMicroUsdPerComputeHour)
      : applyMargin(overageUpstream, input.plan.marginBps);

  return {
    billedComputeHours: hours,
    upstreamCostMicroUsd,
    chargedMicroUsd,
    grossMarginMicroUsd: chargedMicroUsd - overageUpstream,
    settlement: quotaConsumedHours > 0 ? 'mixed' : 'overage',
    quotaConsumedHours,
    overageHours,
    balanceDeltaMicroUsd: -chargedMicroUsd,
    explanation: `${overageHours.toFixed(2)} compute hours past your allowance were billed as overage.`,
  };
}

/* ------------------------------------------------------------------ *
 *  Pre-flight estimation
 * ------------------------------------------------------------------ */

export type TaskEstimate = {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedWeightedTokens: number;
  estimatedChargedMicroUsd: number;
  estimatedComputeHours: number;
  estimatedComputeChargedMicroUsd: number;
  totalMicroUsd: number;
  /** `low` under a cent, `high` past the warn threshold. */
  confidence: 'low' | 'medium' | 'high';
  isExpensive: boolean;
  explanation: string;
};

export type EstimateTaskInput = {
  promptTokens: number;
  /** Historic mean for this project/mode, or a default per agent mode. */
  expectedIterations: number;
  expectedOutputTokensPerIteration: number;
  contextGrowthPerIteration: number;
  prices: TokenPrices;
  plan: PlanPricingConfig;
  quotaRemainingWeighted: number;
  computeMultiplier: number;
  expectedMinutes: number;
  upstreamMicroUsdPerBaseHour: number;
  /** Warn above this charged amount, micro-USD. Default $1.00. */
  expensiveThresholdMicroUsd?: number;
};

/**
 * Forecast shown before starting an expensive run. Deliberately conservative:
 * context is assumed to grow every iteration, because it does.
 */
export function estimateTaskCost(input: EstimateTaskInput): TaskEstimate {
  const iterations = Math.max(1, Math.round(input.expectedIterations));

  let inputTokens = 0;
  let context = Math.max(0, input.promptTokens);
  for (let i = 0; i < iterations; i += 1) {
    inputTokens += context;
    context += input.contextGrowthPerIteration + input.expectedOutputTokensPerIteration;
  }
  const outputTokens = iterations * Math.max(0, input.expectedOutputTokensPerIteration);

  const settlement = settleModelUsage({
    counts: { inputTokens, outputTokens },
    prices: input.prices,
    plan: input.plan,
    quotaRemainingWeighted: input.quotaRemainingWeighted,
  });

  const computeHours =
    Math.round((input.expectedMinutes / 60) * input.computeMultiplier * 10_000) / 10_000;
  const computeCharged = applyMargin(
    Math.round(computeHours * input.upstreamMicroUsdPerBaseHour),
    input.plan.marginBps,
  );

  const total = settlement.chargedMicroUsd + computeCharged;
  const threshold = input.expensiveThresholdMicroUsd ?? 1_000_000;

  const confidence: TaskEstimate['confidence'] =
    iterations <= 3 ? 'high' : iterations <= 10 ? 'medium' : 'low';

  return {
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedWeightedTokens: settlement.weightedTokens,
    estimatedChargedMicroUsd: settlement.chargedMicroUsd,
    estimatedComputeHours: computeHours,
    estimatedComputeChargedMicroUsd: computeCharged,
    totalMicroUsd: total,
    confidence,
    isExpensive: total >= threshold,
    explanation: `~${iterations} agent iterations · ~${settlement.weightedTokens.toLocaleString('en-US')} weighted tokens · ~${computeHours.toFixed(2)} compute hours. ${settlement.explanation}`,
  };
}

/* ------------------------------------------------------------------ *
 *  Guards
 * ------------------------------------------------------------------ */

export type SpendGuardReason =
  'ok' | 'quota_exceeded' | 'payment_required' | 'spend_cap_reached' | 'subscription_inactive';

export type SpendGuardResult = {
  allowed: boolean;
  reason: SpendGuardReason;
  title: string;
  message: string;
  actionLabel?: string;
  actionHref?: string;
};

export type SpendGuardInput = {
  estimatedChargeMicroUsd: number;
  balanceMicroUsd: number;
  creditLimitMicroUsd: number;
  quotaRemainingWeighted: number;
  estimatedWeightedTokens: number;
  spendCapMicroUsd: number;
  periodSpendMicroUsd: number;
  hasActiveSubscription: boolean;
  /**
   * The team's subscription status, or undefined when it has no subscription
   * at all. Note that this cannot be inferred from `hasActiveSubscription`:
   * callers derive that flag *from* the status, so it is false for precisely
   * the subscribers whose payment has failed.
   */
  subscriptionStatus?: string;
};

/**
 * Statuses where the team still holds a subscription but Karo could not
 * collect on it. `canceled`, `incomplete_expired` and `paused` are absent on
 * purpose: those teams have nothing left to fix, so they fall through to
 * pay-as-you-go pricing rather than being blocked.
 */
const PAYMENT_ATTENTION_STATUSES: readonly string[] = ['past_due', 'unpaid', 'incomplete'];

export function checkSpendGuard(input: SpendGuardInput): SpendGuardResult {
  if (
    input.subscriptionStatus &&
    PAYMENT_ATTENTION_STATUSES.includes(input.subscriptionStatus)
  ) {
    return {
      allowed: false,
      reason: 'subscription_inactive',
      title: 'Subscription needs attention',
      message: `Your subscription is ${input.subscriptionStatus.replace('_', ' ')}. Update your payment method to keep running agents.`,
      actionLabel: 'Open billing',
      actionHref: '/app/billing',
    };
  }

  if (
    input.spendCapMicroUsd > 0 &&
    input.periodSpendMicroUsd + input.estimatedChargeMicroUsd > input.spendCapMicroUsd
  ) {
    return {
      allowed: false,
      reason: 'spend_cap_reached',
      title: 'Monthly spending cap reached',
      message:
        'This run would exceed the spending cap set for your team. Raise the cap in billing settings, or wait for the next period.',
      actionLabel: 'Adjust cap',
      actionHref: '/app/billing',
    };
  }

  const coveredByQuota = input.quotaRemainingWeighted >= input.estimatedWeightedTokens;
  if (coveredByQuota) return okGuard();

  const available = input.balanceMicroUsd + input.creditLimitMicroUsd;
  if (available < input.estimatedChargeMicroUsd) {
    return {
      allowed: false,
      reason: input.hasActiveSubscription ? 'quota_exceeded' : 'payment_required',
      title: input.hasActiveSubscription ? 'Monthly allowance spent' : 'Balance too low',
      message: input.hasActiveSubscription
        ? 'Your included weighted tokens are used up and your balance cannot cover the overage. Top up or upgrade to continue.'
        : 'Add credit to your pay-as-you-go balance to start this run.',
      actionLabel: 'Add credit',
      actionHref: '/app/billing',
    };
  }

  return okGuard();
}

function okGuard(): SpendGuardResult {
  return { allowed: true, reason: 'ok', title: '', message: '' };
}
