import { expect, test } from '@playwright/test';

/**
 * A BYOS machine with no container runtime heartbeats normally and reads as
 * "Online", then fails every sandbox scheduled onto it. The panel used to show
 * hostname, CPU and RAM and stop there, so a user who installed Docker after
 * enrolling had nothing on screen that could confirm it — the facts were
 * captured once at registration and never refreshed.
 */
test('the servers panel states each machine’s container runtime', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? 'admin@karo.local');
  await page
    .getByLabel(/password/i)
    .first()
    .fill(process.env.E2E_PASSWORD ?? 'karo-admin-2025');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });

  await page.goto('/app/settings?section=servers');

  // The paragraph, not the bold label inside it.
  const line0 = page.locator('p', { hasText: /Container runtime:/i }).first();
  await expect(line0).toBeVisible({ timeout: 20_000 });

  // Never the placeholder for an agent that does report capabilities.
  const line = await line0.innerText();
  expect(line).toMatch(/Docker|Podman|Dry run|None detected|Not reported yet/);
  console.log('RUNTIME LINE =', line);
});
