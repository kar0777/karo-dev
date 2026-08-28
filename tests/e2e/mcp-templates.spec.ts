import { expect, test } from '@playwright/test';

/**
 * The "Custom HTTP server" template exists to reach a server the user runs.
 * Its seeded `url` is the placeholder `http://localhost:8931/mcp`, its only env
 * field is optional, and the configurator rendered `template.env` and nothing
 * else — so the card advertised "No configuration required" and then offered no
 * way to say where the server actually was. Every install of it produced a
 * server pinned to a port on the sandbox's own loopback.
 */
test('a remote MCP template asks where the server is', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? 'admin@karo.local');
  await page
    .getByLabel(/password/i)
    .first()
    .fill(process.env.E2E_PASSWORD ?? 'karo-admin-2025');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });

  await page.goto('/app/mcp');
  await page
    .getByRole('button', { name: /add server/i })
    .first()
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const card = dialog.getByRole('button', { name: /Custom HTTP server/i });
  await expect(card).toBeVisible();

  // The card must not claim there is nothing to fill in when a URL is required.
  await expect(card).not.toHaveText(/No configuration required/i);
  await expect(card).toHaveText(/Server URL/i);

  await card.click();

  const url = dialog.getByLabel(/Server URL/i);
  await expect(url).toBeVisible();
  await expect(url).toHaveValue(/^https?:\/\//);

  // Clearing it blocks the submit rather than silently installing the default.
  await url.fill('');
  await expect(dialog.getByRole('button', { name: /^Add server$/ })).toBeDisabled();

  await url.fill('http://192.168.1.50:9000/mcp');
  await expect(dialog.getByRole('button', { name: /^Add server$/ })).toBeEnabled();
});

test('a stdio MCP template exposes the arguments it will run', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(process.env.E2E_EMAIL ?? 'admin@karo.local');
  await page
    .getByLabel(/password/i)
    .first()
    .fill(process.env.E2E_PASSWORD ?? 'karo-admin-2025');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });

  await page.goto('/app/mcp');
  await page
    .getByRole('button', { name: /add server/i })
    .first()
    .click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /SQLite/i }).click();

  // SQLite's database path is baked into `args`, and there was no field for it.
  const args = dialog.getByLabel(/Command arguments/i);
  await expect(args).toBeVisible();
  await expect(args).toHaveValue(/--db-path/);
});
