import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROVIDER_DESCRIPTORS } from '@/lib/ai/providers/descriptors';

/**
 * `.env.example` is the only place per-provider credentials are documented.
 *
 * `src/lib/env.ts` deliberately keeps provider variables out of its Zod schema
 * so that adding a provider stays a one-entry change in the descriptor registry.
 * The cost of that choice is that nothing in the type system notices when a new
 * descriptor lands with its variables undocumented — and four had already
 * drifted that way (SiliconFlow, Together AI, Gemini, Mistral) while both the
 * README and the file's own header claimed every variable was listed. These
 * tests are the check that the compiler cannot do.
 *
 * This is the one unit test that reads from disk; the file it asserts about is
 * the artefact under test, so there is nothing to import instead.
 */
const ENV_EXAMPLE = readFileSync(
  fileURLToPath(new URL('../../../.env.example', import.meta.url)),
  'utf8',
);

/**
 * Every `NAME=` written at the start of a line, whether the line is commented
 * out or live. Matching the assignment rather than the bare name means a
 * variable mentioned only in prose does not count as documented.
 */
const DOCUMENTED_VARIABLES = new Set(
  ENV_EXAMPLE.split('\n')
    .map((line) => /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined),
);

describe('.env.example provider documentation', () => {
  it('documents an API key variable for every provider that needs one', () => {
    const missing = PROVIDER_DESCRIPTORS.filter(
      (descriptor) =>
        descriptor.apiKeyEnv !== null && !DOCUMENTED_VARIABLES.has(descriptor.apiKeyEnv),
    ).map((descriptor) => `${descriptor.key} → ${descriptor.apiKeyEnv}`);

    expect(missing).toEqual([]);
  });

  it('documents a base URL variable for every provider', () => {
    const missing = PROVIDER_DESCRIPTORS.filter(
      (descriptor) => !DOCUMENTED_VARIABLES.has(descriptor.baseUrlEnv),
    ).map((descriptor) => `${descriptor.key} → ${descriptor.baseUrlEnv}`);

    expect(missing).toEqual([]);
  });

  it('offers every provider key in the AI_PROVIDER pin list', () => {
    // An operator who cannot find a provider in this list has no way to learn
    // that pinning it is even possible, since env.ts types AI_PROVIDER as a
    // bare string and accepts anything.
    const start = ENV_EXAMPLE.indexOf('# Which provider serves model traffic.');
    const end = ENV_EXAMPLE.indexOf('AI_PROVIDER=auto');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const offered = new Set(ENV_EXAMPLE.slice(start, end).split(/[^a-z0-9_]+/i));
    const missing = PROVIDER_DESCRIPTORS.filter(
      (descriptor) => !offered.has(descriptor.key),
    ).map((descriptor) => descriptor.key);

    expect(missing).toEqual([]);
  });
});
