import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });

test('deep: click Model & API and watch', async ({ page }) => {
  const log: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('settings')) log.push(`REQ  ${r.method()} ${r.url().slice(21)}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('settings')) log.push(`RES  ${r.status()} ${r.url().slice(21)}`);
  });
  page.on('requestfailed', (r) => {
    if (r.url().includes('settings'))
      log.push(`FAIL ${r.url().slice(21)} :: ${r.failure()?.errorText}`);
  });
  page.on('console', (m) => log.push(`CONSOLE.${m.type()} ${m.text().slice(0, 300)}`));
  page.on('pageerror', (e) => log.push(`PAGEERROR ${e.message.slice(0, 300)}`));

  await page.goto('/app/settings?section=profile');
  await page.waitForLoadState('networkidle').catch(() => {});
  log.push('--- loaded, now clicking ---');

  const link = page.getByRole('link', { name: /Model & API/i }).first();
  const href = await link.getAttribute('href');
  log.push(`link href = ${href}`);
  await link.click();

  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(750);
    const u = page.url();
    const h2 = await page
      .locator('section[aria-label] h2, section[aria-label] h3')
      .first()
      .innerText()
      .catch(() => '(none)');
    const aria = await page
      .locator('section[aria-label]')
      .first()
      .getAttribute('aria-label')
      .catch(() => '?');
    log.push(
      `t=${((i + 1) * 0.75).toFixed(1)}s url=${u.slice(21)} ariaLabel=${aria} first-h=${h2.slice(0, 40)}`,
    );
    if (u.includes('section=models')) break;
  }
  console.log('\n' + log.join('\n'));
});

test('deep: direct goto section=models then interact', async ({ page }) => {
  const log: string[] = [];
  page.on(
    'console',
    (m) => m.type() === 'error' && log.push(`CONSOLE ${m.text().slice(0, 300)}`),
  );
  page.on('pageerror', (e) => log.push(`PAGEERROR ${e.message.slice(0, 300)}`));
  page.on(
    'response',
    (r) => r.status() >= 400 && log.push(`HTTP ${r.status()} ${r.url().slice(21)}`),
  );

  const res = await page.goto('/app/settings?section=models');
  log.push(`status=${res?.status()}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const aria = await page.locator('section[aria-label]').first().getAttribute('aria-label');
  log.push(`section aria-label = ${aria}`);
  const body = await page.locator('body').innerText();
  log.push(
    'BODY (models region): ' +
      body.slice(body.indexOf('Model & API')).slice(0, 1200).replace(/\n+/g, ' | '),
  );
  const buttons = await page
    .getByRole('button')
    .evaluateAll((els) =>
      els.map((e) => (e.textContent ?? '').trim().slice(0, 40)).filter(Boolean),
    );
  log.push('BUTTONS: ' + JSON.stringify(buttons));
  const links = await page
    .locator('section[aria-label="Model & API"] a')
    .evaluateAll((els) =>
      els.map(
        (e) =>
          `${(e as HTMLAnchorElement).getAttribute('href')}::${(e.textContent ?? '').trim().slice(0, 30)}`,
      ),
    );
  log.push('SECTION LINKS: ' + JSON.stringify(links));
  console.log('\n' + log.join('\n'));
});

test('deep: /admin overview error', async ({ page }) => {
  const log: string[] = [];
  page.on(
    'console',
    (m) => m.type() === 'error' && log.push(`CONSOLE ${m.text().slice(0, 500)}`),
  );
  page.on('pageerror', (e) => log.push(`PAGEERROR ${e.message.slice(0, 500)}`));
  page.on(
    'response',
    (r) => r.status() >= 400 && log.push(`HTTP ${r.status()} ${r.url().slice(21)}`),
  );
  const res = await page.goto('/admin');
  log.push(`status=${res?.status()}`);
  await page.waitForTimeout(3000);
  const body = await page
    .locator('main, #admin-content')
    .first()
    .innerText()
    .catch(async () => await page.locator('body').innerText());
  log.push('MAIN: ' + body.slice(0, 1200).replace(/\n+/g, ' | '));
  console.log('\n' + log.join('\n'));
});
