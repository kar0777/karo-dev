import { expect, test } from '@playwright/test';

/**
 * The screens must survive hydration, not merely render.
 *
 * Every other check in this repo looks at what the server sends: status codes,
 * HTML containing the right fields, snapshots of the markup. All of those passed
 * while the sign-in screen was completely broken — a client bundle pulled in
 * `node:crypto`, threw while evaluating, and replaced the form with an error
 * card in the browser. The HTML had been perfect on the way out.
 *
 * So these assert the one thing only a real browser can answer: after the
 * JavaScript runs, is the page still there and can a person type into it?
 */

const AUTH_SCREENS = [
  { path: '/login', field: 'input[name="email"]' },
  { path: '/register', field: 'input[name="email"]' },
  { path: '/forgot-password', field: 'input[name="email"]' },
  { path: '/reset-password?token=probe', field: 'input[name="password"]' },
];

for (const screen of AUTH_SCREENS) {
  test(`${screen.path} hydrates and accepts input`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto(screen.path);

    const field = page.locator(screen.field).first();
    await expect(field).toBeVisible();

    // Typing is the proof: a field that renders but never hydrates stays empty.
    await field.fill('probe@example.com');
    await expect(field).toHaveValue('probe@example.com');

    // The error boundary's copy, which is what a hydration crash shows instead.
    await expect(page.getByText('This screen could not load')).toHaveCount(0);

    // A Suspense fallback still on screen means the swap never happened.
    await expect(page.getByText('Loading', { exact: true })).toHaveCount(0);

    expect(errors, `console errors on ${screen.path}:\n${errors.join('\n')}`).toEqual([]);
  });
}
