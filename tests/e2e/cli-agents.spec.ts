import { expect, test, type Page } from '@playwright/test';

/**
 * The CLI agents catalogue — "terminals by license".
 *
 * The catalogue is database-driven, so these tests only pin what must always
 * hold for the seeded data: the admin table lists the tools, the workspace
 * dialog renders cards with an honest license/auth posture, and the
 * "on my machine" tab prints the vendors' own install commands.
 */

const EMAIL = process.env.E2E_EMAIL ?? 'admin@karo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'karo-admin-2025';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
}

/** Opens the newest project this account can see. */
async function openWorkspace(page: Page) {
  await page.goto('/app/projects');
  const card = page.locator('a[href^="/app/projects/"]').first();
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  await page.waitForURL(/\/app\/projects\/prj_/, { timeout: 30_000 });
}

test('the admin catalogue lists the seeded CLI agents', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/cli-tools');

  await expect(page.getByRole('heading', { name: 'CLI agents' })).toBeVisible({
    timeout: 20_000,
  });

  for (const name of ['Claude Code', 'Codex CLI', 'Gemini CLI', 'Aider']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
});

test('the workspace dialog shows the catalogue with license posture', async ({ page }) => {
  await signIn(page);
  await openWorkspace(page);

  await page.getByRole('tab', { name: 'Terminal' }).click();
  await page.getByRole('button', { name: 'CLI agents' }).click();

  const dialog = page.getByRole('dialog', { name: 'CLI agents' });
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  // Proprietary tools must say so — the user brings their own license.
  await expect(dialog.getByText('Claude Code', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Your license required')).toBeVisible();
  await expect(dialog.getByText('License: Apache-2.0').first()).toBeVisible();

  // The "on my machine" tab prints the vendors' own commands, not ours.
  await dialog.getByRole('radio', { name: 'On my machine' }).click();
  await expect(
    dialog.getByText('npm install -g @anthropic-ai/claude-code').first(),
  ).toBeVisible();
});
