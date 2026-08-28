import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });

type Bag = { errors: string[]; failed: string[] };

function watch(page: import('@playwright/test').Page): Bag {
  const bag: Bag = { errors: [], failed: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') bag.errors.push(m.text().slice(0, 400));
  });
  page.on('pageerror', (e) => bag.errors.push('PAGEERROR: ' + e.message.slice(0, 400)));
  page.on('requestfailed', (r) =>
    bag.failed.push(`REQFAIL ${r.method()} ${r.url()} :: ${r.failure()?.errorText}`),
  );
  page.on('response', (r) => {
    if (r.status() >= 400)
      bag.failed.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return bag;
}

function dump(label: string, bag: Bag) {
  console.log(`\n##### ${label}`);
  if (bag.errors.length)
    console.log('  CONSOLE:', JSON.stringify(bag.errors.slice(0, 8), null, 1));
  if (bag.failed.length)
    console.log('  NETWORK:', JSON.stringify(bag.failed.slice(0, 12), null, 1));
  if (!bag.errors.length && !bag.failed.length) console.log('  clean');
  bag.errors.length = 0;
  bag.failed.length = 0;
}

test('A: settings -> click Model & API nav link', async ({ page }) => {
  const bag = watch(page);
  await page.goto('/app/settings');
  await page.waitForLoadState('networkidle').catch(() => {});
  dump('goto /app/settings (profile)', bag);

  const link = page.getByRole('link', { name: /Model & API/i });
  console.log('  Model & API link count:', await link.count());
  await link.first().click();
  await page.waitForTimeout(3500);
  console.log('  URL after click:', page.url());
  const body = await page.locator('body').innerText();
  console.log('  BODY HEAD:', body.slice(0, 700).replace(/\n+/g, ' | '));
  dump('click Model & API link', bag);

  // now click each other section to see which ones work
  for (const name of [
    /Servers/i,
    /Notifications/i,
    /Agent defaults/i,
    /Security/i,
    /Profile/i,
  ]) {
    const l = page.getByRole('link', { name });
    if ((await l.count()) === 0) {
      console.log('  MISSING nav link', String(name));
      continue;
    }
    await l.first().click();
    await page.waitForTimeout(1500);
    console.log(
      '  ->',
      String(name),
      page.url(),
      '|',
      (
        await page
          .locator('h2, h3')
          .first()
          .innerText()
          .catch(() => '?')
      ).slice(0, 60),
    );
    dump(`click ${String(name)}`, bag);
  }
});

test('B: admin sidebar -> Models entry', async ({ page }) => {
  const bag = watch(page);
  await page.goto('/admin');
  await page.waitForLoadState('networkidle').catch(() => {});
  dump('goto /admin', bag);

  const nav = await page
    .getByRole('link')
    .evaluateAll((els) =>
      els.map(
        (e) =>
          `${(e as HTMLAnchorElement).getAttribute('href')} :: ${(e.textContent ?? '').trim().slice(0, 30)}`,
      ),
    );
  console.log('  ADMIN LINKS:', JSON.stringify(nav, null, 1));

  const models = page.getByRole('link', { name: /^Models/i });
  console.log('  Models link count:', await models.count());
  if (await models.count()) {
    await models.first().click();
    await page.waitForTimeout(3500);
    console.log('  URL after click:', page.url());
    console.log(
      '  BODY HEAD:',
      (await page.locator('body').innerText()).slice(0, 600).replace(/\n+/g, ' | '),
    );
  }
  dump('click admin Models', bag);
});

test('C: /admin/models dialogs', async ({ page }) => {
  const bag = watch(page);
  await page.goto('/admin/models');
  await page.waitForLoadState('networkidle').catch(() => {});
  dump('goto /admin/models', bag);

  const buttons = await page
    .getByRole('button')
    .evaluateAll((els) =>
      els.map((e) => (e.textContent ?? '').trim().slice(0, 40)).filter(Boolean),
    );
  console.log('  BUTTONS:', JSON.stringify(buttons, null, 1));
  console.log(
    '  BODY:',
    (await page.locator('body').innerText()).slice(0, 1500).replace(/\n+/g, ' | '),
  );
});
