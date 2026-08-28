import { describe, expect, it } from 'vitest';

import {
  descriptorIsConfigured,
  findDescriptor,
  PROVIDER_DESCRIPTORS,
} from '@/lib/ai/providers/descriptors';
import { quotedAPrice, reportedFields } from '@/lib/ai/catalog-merge';
import { normalizeUsage } from '@/lib/ai/providers/openai-compatible';
import type { ProviderModelInfo } from '@/lib/ai/types';
import {
  calculateUpstreamCostMicroUsd,
  calculateWeightedTokens,
  type TokenPrices,
} from '@/lib/pricing/weighted-tokens';

/**
 * These tests exist because of a real billing defect.
 *
 * Karo prices `inputTokens` and `cachedInputTokens` as **separate additive
 * buckets**, but every OpenAI-compatible provider reports `prompt_tokens` as the
 * *total* prompt with `cached_tokens` a subset of it. The adapter used to pass
 * the total straight through, so cached tokens were charged twice — once at the
 * full input rate and again at the cache rate — and inflated the customer's
 * weighted-token quota by the same amount.
 *
 * The numbers in the first test are a real response recorded from W&B Inference
 * (`openai/gpt-oss-120b`), not invented.
 */
describe('normalizeUsage', () => {
  it('subtracts the cached subset from prompt_tokens (OpenAI / W&B shape)', () => {
    const usage = normalizeUsage({
      prompt_tokens: 83,
      completion_tokens: 67,
      prompt_tokens_details: { cached_tokens: 64 },
    });

    // 83 total prompt, of which 64 were a cache hit → 19 fresh input tokens.
    expect(usage).toEqual({
      inputTokens: 19,
      outputTokens: 67,
      cachedInputTokens: 64,
      cacheWriteTokens: 0,
    });
    // The buckets must reconstruct the provider's own total, or someone is
    // being charged for tokens that were never sent.
    expect(usage.inputTokens + usage.cachedInputTokens).toBe(83);
  });

  it('never double-charges cached input', () => {
    // A model where cached input is genuinely cheaper, so the error is visible.
    const prices: TokenPrices = {
      inputMicroUsdPerMtok: 1_000_000,
      outputMicroUsdPerMtok: 1_500_000,
      cachedInputMicroUsdPerMtok: 100_000,
      cacheWriteMicroUsdPerMtok: 0,
    };

    const correct = normalizeUsage({
      prompt_tokens: 100_000,
      completion_tokens: 0,
      prompt_tokens_details: { cached_tokens: 90_000 },
    });

    // What the old adapter produced: the total prompt AND the cached subset.
    const doubleCounted = { ...correct, inputTokens: 100_000 };

    expect(calculateUpstreamCostMicroUsd(correct, prices)).toBe(19_000);
    expect(calculateUpstreamCostMicroUsd(doubleCounted, prices)).toBe(109_000);
    // The old behaviour overcharged by more than 5x on a heavily cached turn.
    expect(calculateUpstreamCostMicroUsd(doubleCounted, prices)).toBeGreaterThan(
      calculateUpstreamCostMicroUsd(correct, prices) * 5,
    );
  });

  it('does not inflate the weighted-token quota', () => {
    const prices: TokenPrices = {
      inputMicroUsdPerMtok: 1_000_000,
      outputMicroUsdPerMtok: 1_500_000,
      cachedInputMicroUsdPerMtok: 100_000,
      cacheWriteMicroUsdPerMtok: 0,
    };

    const usage = normalizeUsage({
      prompt_tokens: 10_000,
      completion_tokens: 0,
      prompt_tokens_details: { cached_tokens: 8_000 },
    });

    // 2,000 fresh × 1  +  8,000 cached × 0.1  =  2,800
    expect(calculateWeightedTokens(usage, prices).weightedTokens).toBe(2_800);
  });

  it("prefers DeepSeek's explicit miss count over inferring it", () => {
    // DeepSeek publishes the split directly. Its hit+miss sum is authoritative
    // even if it disagrees with prompt_tokens.
    const usage = normalizeUsage({
      prompt_tokens: 5_000,
      completion_tokens: 120,
      prompt_cache_hit_tokens: 4_600,
      prompt_cache_miss_tokens: 400,
    });

    expect(usage.inputTokens).toBe(400);
    expect(usage.cachedInputTokens).toBe(4_600);
  });

  it('clamps a cache count that exceeds the prompt instead of going negative', () => {
    // Defensive: a provider reporting cached_tokens as a non-subset would
    // otherwise produce a negative input count and a nonsensical bill.
    const usage = normalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 500 },
    });

    expect(usage.inputTokens).toBe(0);
    expect(usage.cachedInputTokens).toBe(100);
  });

  it('treats an absent usage payload as zeroes rather than NaN', () => {
    expect(normalizeUsage({})).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it('passes through Anthropic-style cache writes', () => {
    const usage = normalizeUsage({
      prompt_tokens: 1_000,
      completion_tokens: 50,
      cache_creation_input_tokens: 300,
    });

    expect(usage.cacheWriteTokens).toBe(300);
    expect(usage.inputTokens).toBe(1_000);
  });

  it('handles a null prompt_tokens_details, which several providers send', () => {
    // Qwen3-Coder and DeepSeek return `prompt_tokens_details: null` outright.
    const usage = normalizeUsage({
      prompt_tokens: 290,
      completion_tokens: 20,
      prompt_tokens_details: null,
    });

    expect(usage.inputTokens).toBe(290);
    expect(usage.cachedInputTokens).toBe(0);
  });
});

describe('provider descriptors', () => {
  it('requires an explicit base URL before a keyless provider counts as configured', () => {
    const ollama = findDescriptor('ollama');
    expect(ollama).toBeDefined();
    expect(ollama?.apiKeyEnv).toBeNull();

    // Without the opt-in, every machine that merely *could* run Ollama would
    // claim a working provider and route real traffic at a dead port.
    expect(descriptorIsConfigured(ollama!, {})).toBe(false);
    expect(
      descriptorIsConfigured(ollama!, { OLLAMA_BASE_URL: 'http://127.0.0.1:11434/v1' }),
    ).toBe(true);
  });

  it('treats a keyed provider as configured only once its key is present', () => {
    const wandb = findDescriptor('wandb');
    expect(wandb?.apiKeyEnv).toBe('WANDB_API_KEY');
    expect(descriptorIsConfigured(wandb!, {})).toBe(false);
    expect(descriptorIsConfigured(wandb!, { WANDB_API_KEY: 'wandb_v1_x' })).toBe(true);
    // An empty string is an unset variable, not a credential.
    expect(descriptorIsConfigured(wandb!, { WANDB_API_KEY: '' })).toBe(false);
  });

  it('keeps keys, env var names and auto priorities unique', () => {
    const keys = PROVIDER_DESCRIPTORS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);

    const priorities = PROVIDER_DESCRIPTORS.map((d) => d.autoPriority);
    expect(new Set(priorities).size).toBe(priorities.length);

    // Two providers sharing a credential variable would silently activate each
    // other, and `auto` would pick a provider the operator never configured.
    const envVars = PROVIDER_DESCRIPTORS.flatMap((d) =>
      d.apiKeyEnv ? [d.apiKeyEnv, d.baseUrlEnv] : [d.baseUrlEnv],
    );
    expect(new Set(envVars).size).toBe(envVars.length);
  });

  it('never reuses the reserved `mock` key for a real endpoint', () => {
    expect(PROVIDER_DESCRIPTORS.some((d) => d.key === 'mock')).toBe(false);
  });

  it('gives every provider a base URL that can carry /chat/completions', () => {
    for (const d of PROVIDER_DESCRIPTORS) {
      expect(d.defaultBaseUrl, d.key).toMatch(/^https?:\/\//);
      // A trailing slash would produce `//chat/completions` on some gateways.
      expect(d.defaultBaseUrl.endsWith('/'), d.key).toBe(false);
    }
  });
});

/**
 * A catalogue sync decides what customers are charged, so its merge rules are
 * unit-tested rather than left to an integration test that needs a database and
 * a live provider.
 *
 * The defect these lock down: `GET /models` returns ids and nothing else on every
 * provider Karo ships, and the adapters report the unknowns as `0`. The sync
 * route treated `0` as a new value, so one click of "Sync from provider" closed
 * every current price row and replaced it with one priced at zero — the whole
 * catalogue became free.
 */
describe('catalogue merge rules', () => {
  const probe = (over: Partial<ProviderModelInfo> = {}): ProviderModelInfo => ({
    slug: 'openai/gpt-oss-120b',
    displayName: 'GPT-OSS 120B',
    family: 'gpt-oss',
    contextWindow: 0,
    maxOutputTokens: 0,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    inputMicroUsdPerMtok: 0,
    outputMicroUsdPerMtok: 0,
    cachedInputMicroUsdPerMtok: 0,
    cacheWriteMicroUsdPerMtok: 0,
    ...over,
  });

  it('does not treat an unreported price as a free tariff', () => {
    // This is exactly what every shipped adapter returns from GET /models.
    expect(quotedAPrice(probe())).toBe(false);
  });

  it('recognises a genuinely quoted tariff', () => {
    expect(quotedAPrice(probe({ inputMicroUsdPerMtok: 30_000 }))).toBe(true);
    // Output-only quotes count too: some models are free on input.
    expect(quotedAPrice(probe({ outputMicroUsdPerMtok: 170_000 }))).toBe(true);
  });

  it('omits unreported numerics so they cannot overwrite known values', () => {
    const fields = reportedFields(probe());
    expect(fields).not.toHaveProperty('contextWindow');
    expect(fields).not.toHaveProperty('maxOutputTokens');
    // Writing contextWindow: 0 would break context management for the model.
    expect(Object.values(fields)).not.toContain(0);
  });

  it('passes reported numerics through', () => {
    const fields = reportedFields(probe({ contextWindow: 131_072, maxOutputTokens: 32_768 }));
    expect(fields.contextWindow).toBe(131_072);
    expect(fields.maxOutputTokens).toBe(32_768);
  });

  it('always reports the identity and capability fields', () => {
    const fields = reportedFields(probe());
    expect(fields).toMatchObject({
      displayName: 'GPT-OSS 120B',
      family: 'gpt-oss',
      supportsTools: true,
      supportsVision: false,
      supportsCaching: false,
    });
  });
});
