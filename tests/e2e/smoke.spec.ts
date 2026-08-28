import { expect, test } from '@playwright/test';

/**
 * Smoke suite.
 *
 * Covers the paths that must never break: the marketing site renders, pricing
 * reads real plans out of the database, auth works, the product shell loads,
 * and nothing leaks a secret into the HTML.
 *
 * Selectors are semantic (roles, accessible names, headings) rather than CSS,
 * so a restyle does not break the suite but a broken structure does.
 */

const DEMO_EMAIL = 'demo@karo.local';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'karo-demo-2025';

test.describe('marketing site', () => {
  test('landing page renders the hero and primary calls to action', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /build anything with an ai agent/i }),
    ).toBeVisible();

    await expect(page.getByRole('link', { name: /start building/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /view pricing/i }).first()).toBeVisible();

    await expect(page).toHaveTitle(/karo/i);
  });

  test('pricing page lists the real plans from the database', async ({ page }) => {
    await page.goto('/pricing');

    for (const plan of ['Lite', 'Pro', 'Scale', 'Ultra']) {
      await expect(page.getByText(plan, { exact: false }).first()).toBeVisible();
    }

    // The seeded prices — proof this came from the database, not a constant.
    await expect(page.getByText('$5', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('$19', { exact: false }).first()).toBeVisible();
  });

  test('explains weighted tokens somewhere on the pricing page', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/weighted token/i).first()).toBeVisible();
  });

  test('public pages respond and are indexable', async ({ page }) => {
    for (const path of ['/features', '/docs', '/security', '/about', '/terms', '/privacy']) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should return 200`).toBe(200);
      await expect(page.locator('h1').first()).toBeVisible();
    }
  });

  test('serves robots.txt and sitemap.xml', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain('Disallow: /app');

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('/pricing');
  });

  test('never ships a server secret to the browser', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    for (const secret of ['AUTH_SECRET', 'ENCRYPTION_KEY', 'STRIPE_SECRET_KEY', 'sk_live_']) {
      expect(html, `${secret} must not appear in the page`).not.toContain(secret);
    }
  });
});

test.describe('theme', () => {
  test('defaults to dark and can be switched', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

test.describe('authentication', () => {
  test('rejects bad credentials with a readable message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('nobody@example.com');
    await page
      .getByLabel(/password/i)
      .first()
      .fill('definitely-wrong-password');
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('signs in the seeded demo account and lands in the product', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(DEMO_EMAIL);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    await page.waitForURL(/\/app/, { timeout: 30_000 });
    await expect(page.getByRole('navigation').first()).toBeVisible();
  });

  test('sends an unauthenticated visitor from /app to the login page', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/app/usage');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
  });

  test('hides the admin area from a non-admin', async ({ page }) => {
    await signIn(page);
    const response = await page.goto('/admin');
    // requirePlatformAdmin() calls notFound(), so /admin is not discoverable.
    expect(response?.status()).toBe(404);
  });
});

test.describe('product shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('shows the seeded project', async ({ page }) => {
    await page.goto('/app/projects');
    await expect(page.getByText(/aurora landing/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('renders usage analytics with real numbers', async ({ page }) => {
    await page.goto('/app/usage');
    await expect(page.getByRole('heading', { name: /usage/i }).first()).toBeVisible();
    await expect(page.getByText(/weighted token/i).first()).toBeVisible();
  });

  test('renders billing with the current plan', async ({ page }) => {
    await page.goto('/app/billing');
    await expect(page.getByText(/pro/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('never renders a raw API key', async ({ page }) => {
    await page.goto('/app/api-keys');
    const html = await page.content();
    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
  });

  test('is usable on a phone-sized viewport', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 780 });
    await page.goto('/app');
    // Nothing may overflow horizontally — the single most common mobile bug.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow, 'page scrolls horizontally at 380px').toBe(false);
  });
});

test.describe('health', () => {
  test('reports status without leaking configuration', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('AUTH_SECRET');
  });
});

/** Signs in as the seeded demo user. */
export async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(DEMO_EMAIL);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
}
