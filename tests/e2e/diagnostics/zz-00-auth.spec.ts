import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const STATE =
  process.env.KARO_STATE ?? path.join(process.cwd(), 'test-results', 'zz-state.json');

test('login once and persist session', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('admin@karo.local');
  await page
    .getByLabel(/password/i)
    .first()
    .fill('karo-admin-2025');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  await page.context().storageState({ path: STATE });
  expect(fs.existsSync(STATE)).toBe(true);
  console.log('STATE SAVED ->', STATE);
});
