import { describe, expect, it } from 'vitest';

import {
  calculateUpstreamCostMicroUsd,
  calculateWeightedTokens,
  deriveMultipliers,
  FALLBACK_MULTIPLIERS,
  roundMultiplier,
  type TokenPrices,
  upstreamMicroUsdPerWeightedToken,
  usdPerMtokToMicroUsd,
} from '@/lib/pricing/weighted-tokens';

/** Claude Sonnet 5 on Omniakey: $0.60 in / $3.00 out per Mtok. */
const SONNET: TokenPrices = {
  inputMicroUsdPerMtok: 600_000,
  outputMicroUsdPerMtok: 3_000_000,
  cachedInputMicroUsdPerMtok: 60_000,
  cacheWriteMicroUsdPerMtok: 750_000,
};

const FREE: TokenPrices = {
  inputMicroUsdPerMtok: 0,
  outputMicroUsdPerMtok: 0,
  cachedInputMicroUsdPerMtok: 0,
  cacheWriteMicroUsdPerMtok: 0,
};

describe('deriveMultipliers', () => {
  it('anchors input at exactly 1 — that is the definition of the unit', () => {
    expect(deriveMultipliers(SONNET).multipliers.input).toBe(1);
  });

  it('derives every other class from its price ratio against input', () => {
    const { multipliers, estimated, basis } = deriveMultipliers(SONNET);
    expect(multipliers.output).toBe(5); // 3_000_000 / 600_000
    expect(multipliers.cachedInput).toBe(0.1);
    expect(multipliers.cacheWrite).toBe(1.25);
    expect(estimated).toBe(false);
    expect(basis).toBe(600_000);
  });

  it('falls back to documented ratios when the model has no input price', () => {
    const { multipliers, estimated, basis } = deriveMultipliers(FREE);
    expect(multipliers).toEqual(FALLBACK_MULTIPLIERS);
    expect(estimated).toBe(true);
    expect(basis).toBe(0);
  });

  it('treats a negative or non-finite input price as unpriced rather than trusting it', () => {
    expect(deriveMultipliers({ ...SONNET, inputMicroUsdPerMtok: -5 }).estimated).toBe(true);
    expect(deriveMultipliers({ ...SONNET, inputMicroUsdPerMtok: Number.NaN }).estimated).toBe(
      true,
    );
  });

  it('recomputes automatically when upstream prices move', () => {
    const before = deriveMultipliers(SONNET).multipliers.output;
    // Provider doubles the output price; nothing in the app is edited.
    const after = deriveMultipliers({ ...SONNET, outputMicroUsdPerMtok: 6_000_000 }).multipliers
      .output;
    expect(before).toBe(5);
    expect(after).toBe(10);
  });
});

describe('roundMultiplier', () => {
  it('rounds to four decimals so the UI does not flicker on price noise', () => {
    expect(roundMultiplier(3.14159265)).toBe(3.1416);
    expect(roundMultiplier(1 / 3)).toBe(0.3333);
  });

  it('clamps nonsense to zero rather than propagating NaN into a charge', () => {
    expect(roundMultiplier(Number.NaN)).toBe(0);
    expect(roundMultiplier(-1)).toBe(0);
    expect(roundMultiplier(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('calculateWeightedTokens', () => {
  it('weights a plain request by the derived multipliers', () => {
    const result = calculateWeightedTokens(
      { inputTokens: 10_000, outputTokens: 2_000 },
      SONNET,
    );
    // 10_000 x 1 + 2_000 x 5
    expect(result.weightedTokens).toBe(20_000);
  });

  it('counts cached and cache-write tokens at their real price ratio', () => {
    const result = calculateWeightedTokens(
      {
        inputTokens: 10_000,
        outputTokens: 1_000,
        cachedInputTokens: 20_000,
        cacheWriteTokens: 4_000,
      },
      SONNET,
    );
    // 10_000 + 5_000 + 2_000 (20k x 0.1) + 5_000 (4k x 1.25)
    expect(result.weightedTokens).toBe(22_000);
  });

  it('makes caching genuinely cheaper for the customer', () => {
    const uncached = calculateWeightedTokens({ inputTokens: 30_000, outputTokens: 0 }, SONNET);
    const cached = calculateWeightedTokens(
      { inputTokens: 0, outputTokens: 0, cachedInputTokens: 30_000 },
      SONNET,
    );
    expect(cached.weightedTokens).toBeLessThan(uncached.weightedTokens);
    expect(cached.weightedTokens).toBe(3_000);
  });

  it('returns a component breakdown that sums to the total', () => {
    const result = calculateWeightedTokens(
      { inputTokens: 1_234, outputTokens: 567, cachedInputTokens: 890, cacheWriteTokens: 12 },
      SONNET,
    );
    const sum = result.components.reduce((n, c) => n + c.weightedTokens, 0);
    expect(sum).toBe(result.weightedTokens);
    expect(result.components).toHaveLength(4);
  });

  it('always produces an explanation the user can read', () => {
    const result = calculateWeightedTokens({ inputTokens: 1_000, outputTokens: 100 }, SONNET);
    expect(result.explanation).toContain('1,000 input');
    expect(result.explanation).toContain('× 5');
    expect(result.explanation).toContain('weighted tokens');
  });

  it('flags estimated pricing in the explanation', () => {
    const result = calculateWeightedTokens({ inputTokens: 100, outputTokens: 10 }, FREE);
    expect(result.estimated).toBe(true);
    expect(result.explanation).toContain('estimated');
  });

  it('handles a zero-token request without dividing by anything', () => {
    const result = calculateWeightedTokens({ inputTokens: 0, outputTokens: 0 }, SONNET);
    expect(result.weightedTokens).toBe(0);
    expect(result.explanation).toBe('No tokens used yet.');
  });

  it('clamps negative counts instead of crediting the customer tokens', () => {
    const result = calculateWeightedTokens(
      { inputTokens: -5_000, outputTokens: 1_000 },
      SONNET,
    );
    expect(result.weightedTokens).toBe(5_000);
  });

  it('returns an integer — weighted tokens are a counting unit', () => {
    const result = calculateWeightedTokens(
      { inputTokens: 333, outputTokens: 777, cachedInputTokens: 111 },
      SONNET,
    );
    expect(Number.isInteger(result.weightedTokens)).toBe(true);
  });
});

describe('calculateUpstreamCostMicroUsd', () => {
  it('prices 1M input tokens at exactly the published input price', () => {
    expect(
      calculateUpstreamCostMicroUsd({ inputTokens: 1_000_000, outputTokens: 0 }, SONNET),
    ).toBe(600_000);
  });

  it('prices a mixed request across all four token classes', () => {
    const cost = calculateUpstreamCostMicroUsd(
      {
        inputTokens: 100_000,
        outputTokens: 10_000,
        cachedInputTokens: 50_000,
        cacheWriteTokens: 20_000,
      },
      SONNET,
    );
    // 60_000 + 30_000 + 3_000 + 15_000
    expect(cost).toBe(108_000);
  });

  it('never returns a fraction of a micro-USD', () => {
    const cost = calculateUpstreamCostMicroUsd({ inputTokens: 7, outputTokens: 3 }, SONNET);
    expect(Number.isInteger(cost)).toBe(true);
  });

  it('costs nothing on a zero-priced model', () => {
    expect(
      calculateUpstreamCostMicroUsd({ inputTokens: 999_999, outputTokens: 999 }, FREE),
    ).toBe(0);
  });
});

describe('unit conversions', () => {
  it('converts published $/Mtok into micro-USD', () => {
    expect(usdPerMtokToMicroUsd(3)).toBe(3_000_000);
    expect(usdPerMtokToMicroUsd(0.0525)).toBe(52_500);
  });

  it('reports the upstream cost of one weighted token', () => {
    expect(upstreamMicroUsdPerWeightedToken(SONNET)).toBeCloseTo(0.6, 10);
    expect(upstreamMicroUsdPerWeightedToken(FREE)).toBe(0);
  });
});

describe('cross-model fairness — the reason weighted tokens exist', () => {
  const HAIKU: TokenPrices = {
    inputMicroUsdPerMtok: 200_000,
    outputMicroUsdPerMtok: 1_000_000,
    cachedInputMicroUsdPerMtok: 20_000,
    cacheWriteMicroUsdPerMtok: 250_000,
  };

  it('gives the same weighted total for the same shape of work on models with the same ratio', () => {
    const counts = { inputTokens: 50_000, outputTokens: 5_000 };
    // Both price output at 5x input, so the plan allowance buys the same
    // amount of *work* on either model even though the money differs.
    expect(calculateWeightedTokens(counts, SONNET).weightedTokens).toBe(
      calculateWeightedTokens(counts, HAIKU).weightedTokens,
    );
    expect(calculateUpstreamCostMicroUsd(counts, SONNET)).toBeGreaterThan(
      calculateUpstreamCostMicroUsd(counts, HAIKU),
    );
  });

  it('charges more weighted tokens on a model with a worse output ratio', () => {
    // Gemini 2.5 Pro: $1 in / $8 out — an 8x output multiplier.
    const GEMINI: TokenPrices = {
      inputMicroUsdPerMtok: 1_000_000,
      outputMicroUsdPerMtok: 8_000_000,
      cachedInputMicroUsdPerMtok: 100_000,
      cacheWriteMicroUsdPerMtok: 1_250_000,
    };
    const counts = { inputTokens: 10_000, outputTokens: 10_000 };
    expect(calculateWeightedTokens(counts, GEMINI).weightedTokens).toBe(90_000);
    expect(calculateWeightedTokens(counts, SONNET).weightedTokens).toBe(60_000);
  });
});
