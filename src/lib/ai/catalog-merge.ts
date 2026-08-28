import type { ProviderModelInfo } from './types';

/**
 * Merge rules for a catalogue sync.
 *
 * These live apart from the route handler so they can be unit-tested: they
 * decide whether customers get billed, and that is not something to leave to an
 * integration test that needs a database and a live provider.
 *
 * The governing principle: **`GET /models` is an availability probe, not a price
 * feed.** On every provider Karo ships it returns model ids and little else — no
 * prices, and usually no context window — and the adapters report those unknowns
 * as `0`. So `0` here means "the provider said nothing", never "the provider
 * said free".
 */

/**
 * The subset of fields a provider actually reported, safe to write over what
 * Karo already holds.
 *
 * Numeric zeros are omitted rather than written: no real model has a zero
 * context window, and a genuinely free model is expressed by a seeded price of
 * zero rather than by the absence of a quote.
 */
export function reportedFields(info: ProviderModelInfo) {
  // The numerics are collected separately and spread, so the inferred return
  // type keeps them *optional* rather than widening to `Record<string, unknown>`.
  // That precision matters: the result is spread into a typed Drizzle insert, and
  // a widened type would silently disable the column checking there.
  const numeric: { contextWindow?: number; maxOutputTokens?: number } = {};
  if (info.contextWindow > 0) numeric.contextWindow = info.contextWindow;
  if (info.maxOutputTokens > 0) numeric.maxOutputTokens = info.maxOutputTokens;

  return {
    displayName: info.displayName,
    family: info.family,
    supportsTools: info.supportsTools,
    supportsVision: info.supportsVision,
    supportsCaching: info.supportsCaching,
    ...numeric,
  };
}

/**
 * Whether the provider quoted a real tariff.
 *
 * Without this guard a sync closed every current `model_prices` row and wrote a
 * replacement priced at zero, which made the entire catalogue free, dropped
 * quota accounting onto estimated multipliers, and left price history containing
 * rows that never matched a real tariff.
 */
export function quotedAPrice(info: ProviderModelInfo): boolean {
  return info.inputMicroUsdPerMtok > 0 || info.outputMicroUsdPerMtok > 0;
}
