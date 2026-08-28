/**
 * Vitest global setup.
 *
 * Loaded via `setupFiles` in vitest.config.ts, which means it executes
 * before any test file — and therefore before anything can import
 * `@/lib/env`. That ordering is the entire point: `env.ts` parses
 * `process.env` once and memoises the result, so a variable set after the
 * first import would be silently ignored.
 *
 * Nothing here is imported from `@/…`; touching the app's modules at this
 * stage would trigger that memoisation with a half-built environment.
 */

import { config as loadEnvFile } from 'dotenv';

/**
 * Test-only env files, highest precedence first.
 *
 * Only `.env.test*` is read — never `.env` or `.env.local`. Those point at the
 * *development* database, and the integration suite writes rows and truncates
 * between runs; picking them up automatically would let `npm test` quietly
 * mutate the database someone is developing against. Opting in is a one-line
 * `.env.test.local`, which is what the README tells you to write.
 *
 * A variable already present in the real environment always wins, so CI can
 * inject its service-container URL without a file existing at all.
 */
for (const file of ['.env.test.local', '.env.test']) {
  loadEnvFile({ path: file, override: false, quiet: true });
}

/**
 * Fixed test credentials.
 *
 * These are throwaway values committed on purpose so that every machine and
 * every CI run produces byte-identical ciphertext and session signatures —
 * a test asserting on an encrypted blob has to be reproducible.
 *
 * ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM. This one
 * is base64('karo-test-encryption-key-32byte!'), which is 32 ASCII
 * characters. Do not "tidy" the string: changing its length breaks
 * `createCipheriv` with an unhelpful `Invalid key length`.
 */
const FIXED: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',

  // 56 characters — comfortably past the 32-character minimum env.ts enforces.
  AUTH_SECRET: 'karo-test-auth-secret-do-not-use-outside-tests-000000000',

  ENCRYPTION_KEY: 'a2Fyby10ZXN0LWVuY3J5cHRpb24ta2V5LTMyYnl0ZSE=',

  BYOS_TOKEN_SECRET: 'karo-test-byos-token-secret-do-not-use-outside-tests-000',

  APP_URL: 'http://localhost:3000',
  APP_NAME: 'Karo',
};

/**
 * Defaults a test run may legitimately override from the outside.
 *
 * `DATABASE_URL` points at a separate `karo_test` database rather than the
 * development one, because the integration suite truncates tables between
 * runs. Override it in `.env.test.local` when your Postgres is not on the
 * default port; CI sets it directly to reach its own service container.
 *
 * `REDIS_URL` is deliberately left unset: without it the app uses its
 * in-process limiter/cache, which keeps the unit suite hermetic and fast.
 */
const DEFAULTS: Readonly<Record<string, string>> = {
  DATABASE_URL: 'postgresql://karo:karo@localhost:5432/karo_test',

  // Mocks everywhere. No test should ever reach a real model, sandbox or
  // payment API, and this makes that structural rather than a convention.
  KARO_DEMO_MODE: 'true',
  SANDBOX_PROVIDER: 'mock',
  EMAIL_TRANSPORT: 'console',

  // The limiter is real code with real tests of its own; leaving it enabled
  // here would make unrelated suites flaky once they exceed a bucket.
  RATE_LIMIT_DISABLED: 'true',

  // Test output is signal. Warnings and errors still surface.
  LOG_LEVEL: 'error',
};

for (const [key, value] of Object.entries(FIXED)) {
  process.env[key] = value;
}

for (const [key, value] of Object.entries(DEFAULTS)) {
  const current = process.env[key];
  if (current === undefined || current === '') {
    process.env[key] = value;
  }
}

// Timestamps rendered in fixtures must not depend on the runner's locale
// or timezone — `formatDateTime` and the usage charts both read them.
process.env.TZ = 'UTC';
