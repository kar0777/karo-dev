import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * The E2E suite drives the real product: sign in, create a project, talk to
 * the agent, watch a tool call land in the terminal. It runs against demo
 * mode, so it exercises the entire stack without a model key, a Docker
 * daemon or a Stripe account.
 *
 * Local:  npm run test:e2e
 * CI:     PLAYWRIGHT_BASE_URL=https://staging.example.com npm run test:e2e
 *
 * Chromium only, on purpose. Karo's UI is a dense, keyboard-driven
 * application shell — cross-engine rendering differences are not the risk
 * this suite exists to catch, and a single project keeps the run fast
 * enough that people actually run it before pushing.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const isCI = Boolean(process.env.CI);

/**
 * Only manage a server when the target is this machine. Pointing
 * PLAYWRIGHT_BASE_URL at staging and *also* booting `npm run dev` would
 * start a server nobody talks to and then time out waiting for a remote
 * URL it did not start.
 */
const targetHost = new URL(baseURL).hostname;
const managesServer =
  targetHost === 'localhost' || targetHost === '127.0.0.1' || targetHost === '::1';

export default defineConfig({
  testDir: './tests/e2e',

  /**
   * `tests/e2e/diagnostics/` is excluded from the default run.
   *
   * Those specs are investigation tools, not regressions. They assert almost
   * nothing — they navigate, dump page text and network errors to the console,
   * and let a human read the output — and they are coupled to one particular
   * seeded database by hard-coded row ids. They also depend on a session file
   * that `diagnostics/zz-00-auth.spec.ts` writes, so they only work when run in
   * order, after that spec, with `KARO_STATE` pointing at the result.
   *
   * Left in the default run they cost a quarter of an hour, fail on a fresh
   * checkout for reasons that say nothing about the product, and drown the real
   * suite's output. They are kept because they are genuinely useful when
   * something is broken and nobody knows where:
   *
   *     npx playwright test tests/e2e/diagnostics/zz-00-auth.spec.ts
   *     KARO_STATE=test-results/zz-state.json \
   *       npx playwright test tests/e2e/diagnostics --workers=1
   */
  testIgnore: '**/diagnostics/**',

  // A spec that hangs on a never-settling stream should fail, not stall CI.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Serial locally so the shared demo database stays predictable; the
  // workers below are what actually control parallelism.
  fullyParallel: true,

  // `test.only` left in a file is a merge accident, not a CI configuration.
  forbidOnly: isCI,

  // Two retries on CI absorbs genuine flake (cold server, streaming
  // timing); zero locally so a flaky test is visible while you write it.
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,

  reporter: isCI
    ? [['html', { outputFolder: 'playwright-report', open: 'never' }], ['github'], ['list']]
    : [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  outputDir: './test-results',

  use: {
    baseURL,

    // Full trace on the first retry: enough to debug a CI-only failure
    // without paying the recording cost on every green run.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    actionTimeout: 15_000,
    navigationTimeout: 30_000,

    // The app ships a strict CSP and HSTS; a self-signed staging cert
    // should still be usable without disabling TLS checks globally.
    ignoreHTTPSErrors: false,

    locale: 'en-US',
    timezoneId: 'UTC',

    // Karo defaults to the dark theme, which is what the suite asserts against.
    colorScheme: 'dark',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  /**
   * Boot the dev server unless one is already listening.
   *
   * 180s is not generous — it is the honest cost of a cold Next.js 16 dev
   * start plus the first on-demand compile of the workspace route, which
   * pulls in Monaco and xterm.
   *
   * `reuseExistingServer` is off on CI so a stale process can never make a
   * broken build look green.
   */
  webServer: managesServer
    ? {
        // CI drives the production build (built by the workflow beforehand):
        // the dev server's on-demand compilation races the browser on slow
        // runners and produced hydration re-renders no real deployment has.
        command: isCI ? 'npm run start' : 'npm run dev',
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 240_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          ...process.env,
          /**
           * The suite signs in from one IP as one account, tens of times
           * within the `auth.login` bucket's 5-minute window, so the real
           * limiter turns the tail of the run into a wall of 429s — a
           * property of sharing a browser between tests, not of the
           * product. The unit suite disables it for the same reason (see
           * tests/setup.ts); here the limiter's own tests still run, this
           * only governs the server the specs drive.
           */
          RATE_LIMIT_DISABLED: 'true',
        },
      }
    : undefined,
});
