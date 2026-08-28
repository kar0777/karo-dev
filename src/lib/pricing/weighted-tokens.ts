/**
 * Weighted tokens — Karo's plan-quota unit.
 *
 * Why a synthetic unit at all?
 * ---------------------------
 * Upstream providers charge different amounts for input, output, cached-read
 * and cache-write tokens, and those ratios move whenever a catalogue refresh
 * lands. If a plan promised "6M tokens", the same allowance would be worth
 * wildly different amounts of money on two different models. So a plan instead
 * promises *weighted* tokens, defined against one anchor:
 *
 *     1 input token = 1 weighted token
 *
 * Every other token class is converted at its **current price ratio** against
 * the input price of the same model. When a provider publishes new prices, the
 * multipliers recompute automatically — no plan edits, no migration.
 *
 * Everything here is pure and synchronous so it can be unit-tested and also
 * run in the browser to show a live estimate as the user types.
 */

/** Prices in micro-USD per 1,000,000 tokens (the usual "$/Mtok" number × 1e6). */
export type TokenPrices = {
  inputMicroUsdPerMtok: number;
  outputMicroUsdPerMtok: number;
  cachedInputMicroUsdPerMtok: number;
  cacheWriteMicroUsdPerMtok: number;
};

export type TokenCounts = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
};

export type WeightClass = 'input' | 'output' | 'cachedInput' | 'cacheWrite';

export type WeightComponent = {
  key: WeightClass;
  label: string;
  tokens: number;
  multiplier: number;
  weightedTokens: number;
};

export type WeightedTokenResult = {
  weightedTokens: number;
  multipliers: Record<WeightClass, number>;
  components: WeightComponent[];
  /** The input price the ratios were taken against, micro-USD per Mtok. */
  basisMicroUsdPerMtok: number;
  /**
   * True when the model has no published input price (free tier, mock provider
   * or a catalogue gap) and documented fallback ratios were used instead.
   */
  estimated: boolean;
  explanation: string;
};

/**
 * Ratios used when a model has no usable input price. They match the typical
 * shape of frontier-model pricing and are shown to the user as "estimated".
 */
export const FALLBACK_MULTIPLIERS: Record<WeightClass, number> = {
  input: 1,
  output: 4,
  cachedInput: 0.1,
  cacheWrite: 1.25,
};

const LABELS: Record<WeightClass, string> = {
  input: 'Input',
  output: 'Output',
  cachedInput: 'Cached input',
  cacheWrite: 'Cache write',
};

/** Multipliers are rounded so the UI does not flicker on tiny price noise. */
export function roundMultiplier(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Derives each token class's weight from the model's current price sheet.
 * `input` is always exactly 1 — it is the definition of the unit.
 */
export function deriveMultipliers(prices: TokenPrices): {
  multipliers: Record<WeightClass, number>;
  estimated: boolean;
  basis: number;
} {
  const basis = prices.inputMicroUsdPerMtok;

  if (!Number.isFinite(basis) || basis <= 0) {
    return { multipliers: { ...FALLBACK_MULTIPLIERS }, estimated: true, basis: 0 };
  }

  return {
    basis,
    estimated: false,
    multipliers: {
      input: 1,
      output: roundMultiplier(prices.outputMicroUsdPerMtok / basis),
      cachedInput: roundMultiplier(prices.cachedInputMicroUsdPerMtok / basis),
      cacheWrite: roundMultiplier(prices.cacheWriteMicroUsdPerMtok / basis),
    },
  };
}

export function calculateWeightedTokens(
  counts: TokenCounts,
  prices: TokenPrices,
): WeightedTokenResult {
  const { multipliers, estimated, basis } = deriveMultipliers(prices);

  const raw: Record<WeightClass, number> = {
    input: Math.max(0, counts.inputTokens || 0),
    output: Math.max(0, counts.outputTokens || 0),
    cachedInput: Math.max(0, counts.cachedInputTokens ?? 0),
    cacheWrite: Math.max(0, counts.cacheWriteTokens ?? 0),
  };

  const components: WeightComponent[] = (
    ['input', 'output', 'cachedInput', 'cacheWrite'] as const
  ).map((key) => ({
    key,
    label: LABELS[key],
    tokens: raw[key],
    multiplier: multipliers[key],
    weightedTokens: Math.round(raw[key] * multipliers[key]),
  }));

  const weightedTokens = components.reduce((sum, c) => sum + c.weightedTokens, 0);

  const parts = components
    .filter((c) => c.tokens > 0)
    .map(
      (c) => `${c.tokens.toLocaleString('en-US')} ${c.label.toLowerCase()} × ${c.multiplier}`,
    );

  const explanation = parts.length
    ? `${parts.join('  +  ')}  =  ${weightedTokens.toLocaleString('en-US')} weighted tokens${
        estimated ? ' (estimated — this model has no published input price)' : ''
      }`
    : 'No tokens used yet.';

  return {
    weightedTokens,
    multipliers,
    components,
    basisMicroUsdPerMtok: basis,
    estimated,
    explanation,
  };
}

/** Exact upstream cost of a request in micro-USD, before any Karo margin. */
export function calculateUpstreamCostMicroUsd(
  counts: TokenCounts,
  prices: TokenPrices,
): number {
  const cost =
    (Math.max(0, counts.inputTokens || 0) * prices.inputMicroUsdPerMtok +
      Math.max(0, counts.outputTokens || 0) * prices.outputMicroUsdPerMtok +
      Math.max(0, counts.cachedInputTokens ?? 0) * prices.cachedInputMicroUsdPerMtok +
      Math.max(0, counts.cacheWriteTokens ?? 0) * prices.cacheWriteMicroUsdPerMtok) /
    1_000_000;
  return Math.round(cost);
}

/**
 * Inverse of the above: how much one weighted token costs upstream on this
 * model. Used to price overage and to forecast a task before it runs.
 */
export function upstreamMicroUsdPerWeightedToken(prices: TokenPrices): number {
  const basis = prices.inputMicroUsdPerMtok;
  if (!Number.isFinite(basis) || basis <= 0) return 0;
  return basis / 1_000_000;
}

/** Convenience for the “$/Mtok” figures shown in the model picker. */
export function microUsdPerMtokToUsd(microUsdPerMtok: number): number {
  return microUsdPerMtok / 1_000_000;
}

export function usdPerMtokToMicroUsd(usdPerMtok: number): number {
  return Math.round(usdPerMtok * 1_000_000);
}
