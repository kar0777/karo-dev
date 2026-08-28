import type { PlanTier } from '@/lib/db/schema';

/**
 * Plan-tier ordering.
 *
 * The *numbers* on a plan always come from the `plans` table — this module only
 * knows that `pro` is above `lite`, which is the one fact the table cannot
 * express and every "is this model available to me?" check needs.
 */

export const PLAN_TIERS: readonly PlanTier[] = ['payg', 'lite', 'pro', 'scale', 'ultra'];

const RANK: Record<PlanTier, number> = {
  payg: 0,
  lite: 1,
  pro: 2,
  scale: 3,
  ultra: 4,
};

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  payg: 'Pay as you go',
  lite: 'Lite',
  pro: 'Pro',
  scale: 'Scale',
  ultra: 'Ultra',
};

export function planTierRank(tier: PlanTier): number {
  return RANK[tier];
}

/** True when `tier` is at least `required` — the model/plugin availability gate. */
export function planTierAtLeast(tier: PlanTier, required: PlanTier): boolean {
  return RANK[tier] >= RANK[required];
}

/** The cheapest tier that unlocks `required`, for "upgrade to X" copy. */
export function nextTierLabel(required: PlanTier): string {
  return PLAN_TIER_LABELS[required];
}
