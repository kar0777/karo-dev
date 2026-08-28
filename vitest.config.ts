import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Two suites live here and share one runtime:
 *
 *   tests/unit/**         pure logic — pricing, weighted tokens, the command
 *                         policy, path normalisation, crypto. No I/O.
 *   tests/integration/**  route handlers and Drizzle queries against a real
 *                         Postgres (see tests/setup.ts for the connection).
 *
 * End-to-end specs are Playwright's and are excluded here: they need a
 * browser and a running server, which Playwright owns.
 */
export default defineConfig({
  test: {
    // Everything under test is server-side. Nothing in these suites touches
    // the DOM — component behaviour is covered by the Playwright suite,
    // where it runs in a real browser instead of a simulated one.
    environment: 'node',

    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],

    exclude: ['node_modules/**', 'dist/**', '.next/**', 'tests/e2e/**'],

    // `describe` / `it` / `expect` / `vi` without an import in every file.
    globals: true,

    // Runs before any test file is imported, so `@/lib/env` sees a fully
    // populated environment the first time it is evaluated.
    setupFiles: ['./tests/setup.ts'],

    // Integration tests talk to a shared database; a fixed, generous
    // per-test ceiling beats mysterious flakes on a cold connection pool.
    testTimeout: 15_000,
    hookTimeout: 30_000,

    // A test that logs is a test that is telling you something.
    clearMocks: true,
    restoreMocks: true,

    reporters: ['default'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        // Type-only and generated surfaces have nothing to execute.
        'src/**/*.d.ts',
        'src/types/**',
        'src/lib/types/**',
        'src/i18n/**',
        // Next.js route/layout files are exercised by the E2E suite.
        'src/app/**/layout.tsx',
        'src/app/**/loading.tsx',
        'src/app/**/error.tsx',
        'src/app/**/not-found.tsx',
        'src/lib/db/seed.ts',
        'src/lib/db/migrate.ts',
        'src/lib/db/reset.ts',
      ],
    },
  },

  resolve: {
    alias: {
      // Mirrors the `@/*` path mapping in tsconfig.json.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws on import outside a React Server Component, which
      // is exactly the guarantee we want in the app and exactly what stops an
      // integration test from importing `@/lib/db`. Vitest already runs on the
      // server, so the guard is redundant here — stub it out.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
