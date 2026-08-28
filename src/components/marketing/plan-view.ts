/**
 * Serialisable plan shape shared by the marketing server components and the
 * interactive pricing client components.
 *
 * Deliberately free of any Drizzle or `server-only` import: the pricing table,
 * the interval toggle and the cost estimator all run in the browser and would
 * otherwise drag the whole database layer into the client bundle. The mapping
 * from a `plans` row (or from `PLAN_SEEDS`) lives in `./catalog.server`.
 */

export type PlanTier = 'payg' | 'lite' | 'pro' | 'scale' | 'ultra';

export type PlanView = {
  key: string;
  tier: PlanTier;
  name: string;
  tagline: string;
  description: string;
  priceMicroUsdMonthly: number;
  priceMicroUsdYearly: number;

  includedWeightedTokens: number;
  includedComputeHours: number;
  maxActiveSandboxes: number;
  maxSandboxMemoryMb: number;
  maxSandboxCpuCores: number;
  storageGb: number;
  maxTeamMembers: number;
  maxProjects: number;
  maxSkills: number;
  maxPlugins: number;
  maxMcpServers: number;
  maxConcurrentRuns: number;
  queuePriority: number;
  auditRetentionDays: number;
  autoSleepMinutes: number;
  autoDestroyHours: number;

  allowByok: boolean;
  allowDocker: boolean;
  allowOwnServer: boolean;
  allowExternalSandbox: boolean;
  allowCustomSandboxSize: boolean;
  allowPreviewDeployments: boolean;
  allowPrivateSkills: boolean;
  allowApiAccess: boolean;
  allowSso: boolean;
  allowDedicatedWorker: boolean;
  allowCustomModelRouting: boolean;
  allowedShells: string[];
  supportLevel: string;

  marginBps: number;
  overageMicroUsdPerMWeighted: number;
  overageMicroUsdPerComputeHour: number;

  trialDays: number;
  isActive: boolean;
  /** Advertised but not purchasable yet — badged "Coming soon", refused at checkout. */
  comingSoon: boolean;
  highlight: boolean;
  features: string[];
  sortOrder: number;
};

/** Price sheet for one model, in micro-USD per 1,000,000 tokens. */
export type ModelPriceView = {
  slug: string;
  displayName: string;
  family: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  minPlanTier: PlanTier;
  inputMicroUsdPerMtok: number;
  outputMicroUsdPerMtok: number;
  cachedInputMicroUsdPerMtok: number;
  cacheWriteMicroUsdPerMtok: number;
};

export type BillingInterval = 'month' | 'year';

/**
 * Where a page's plan numbers came from. Marketing pages must render even with
 * the database down, so they say so rather than pretending the catalogue is live.
 */
export type CatalogSource = 'database' | 'fallback';

/**
 * `999` is the schema's "effectively unlimited" sentinel for skills and
 * plugins — showing it verbatim would read like a real cap.
 */
export const UNLIMITED_SENTINEL = 999;

export function formatPlanLimit(value: number): string {
  if (value >= UNLIMITED_SENTINEL) return 'Unlimited';
  return value.toLocaleString('en-US');
}

export const SUPPORT_LEVEL_LABELS: Record<string, string> = {
  community: 'Community',
  email: 'Email, 1 business day',
  priority: 'Priority, 4 business hours',
  premium: 'Premium, 1 hour',
};

export function supportLabel(level: string): string {
  return SUPPORT_LEVEL_LABELS[level] ?? level;
}

/** `payg` has no subscription price, so the pricing UI treats it separately. */
export function isSubscriptionPlan(plan: PlanView): boolean {
  return plan.priceMicroUsdMonthly > 0;
}

/** What the plan costs per month on the chosen interval. */
export function monthlyPriceMicroUsd(plan: PlanView, interval: BillingInterval): number {
  if (interval === 'month') return plan.priceMicroUsdMonthly;
  return Math.round(plan.priceMicroUsdYearly / 12);
}

/** Money kept by paying yearly, in micro-USD. Zero for free/PAYG plans. */
export function yearlySavingMicroUsd(plan: PlanView): number {
  const twelveMonths = plan.priceMicroUsdMonthly * 12;
  if (twelveMonths <= 0 || plan.priceMicroUsdYearly <= 0) return 0;
  return Math.max(0, twelveMonths - plan.priceMicroUsdYearly);
}

/** "2 months free" is only honest when the yearly price really is 10×. */
export function yearlyFreeMonths(plan: PlanView): number {
  if (plan.priceMicroUsdMonthly <= 0 || plan.priceMicroUsdYearly <= 0) return 0;
  return Math.round(
    (plan.priceMicroUsdMonthly * 12 - plan.priceMicroUsdYearly) / plan.priceMicroUsdMonthly,
  );
}

export function planByKey(plans: readonly PlanView[], key: string): PlanView | undefined {
  return plans.find((plan) => plan.key === key);
}

/** The three plans the landing page previews, in display order. */
export const LANDING_PLAN_KEYS = ['lite', 'pro', 'scale'] as const;
