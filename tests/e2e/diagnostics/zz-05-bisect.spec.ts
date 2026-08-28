import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });

// 1. Block prefetches entirely, then click.
test('no-prefetch click', async ({ page }) => {
  await page.route('**/*_rsc=*', async (route) => {
    const h = route.request().headers();
    if (h['next-router-prefetch'] || h['next-router-segment-prefetch']) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.goto('/app/settings?section=profile');
  await page.waitForTimeout(1500);
  await page
    .getByRole('link', { name: /Model & API/i })
    .first()
    .click();
  await page.waitForTimeout(5000);
  console.log('NO-PREFETCH result url =', page.url().slice(21));
});

// 2. Serve the models nav RSC as a fully-buffered body (no streaming).
test('buffered response click', async ({ page }) => {
  await page.route('**/settings?section=models&_rsc=*', async (route) => {
    const req = route.request();
    const r = await page.request.fetch(req.url(), { headers: req.headers(), maxRedirects: 0 });
    const body = await r.body();
    console.log('  intercepted, buffered bytes =', body.length, 'status', r.status());
    await route.fulfill({ status: r.status(), headers: r.headers(), body });
  });
  await page.goto('/app/settings?section=profile');
  await page.waitForTimeout(1500);
  await page
    .getByRole('link', { name: /Model & API/i })
    .first()
    .click();
  await page.waitForTimeout(6000);
  console.log('BUFFERED result url =', page.url().slice(21));
});

// 3. Compare with other big soft navigations from the same page.
test('other soft navs from settings', async ({ page }) => {
  await page.goto('/app/settings?section=profile');
  await page.waitForTimeout(1500);
  for (const name of [/^Usage$/, /^Billing$/, /^Projects$/, /^Agents$/]) {
    const l = page.getByRole('link', { name });
    if (!(await l.count())) continue;
    await l.first().click();
    await page.waitForTimeout(2500);
    console.log(`sidebar ${String(name)} -> ${page.url().slice(21)}`);
    await page.goto('/app/settings?section=profile');
    await page.waitForTimeout(1200);
  }
});

// 4. Is it stuck-forever or eventually-resolves? Wait a full 45s.
test('45s patience test', async ({ page }) => {
  await page.goto('/app/settings?section=profile');
  await page.waitForTimeout(1500);
  await page
    .getByRole('link', { name: /Model & API/i })
    .first()
    .click();
  const t0 = Date.now();
  let done = false;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1000);
    if (page.url().includes('section=models')) {
      console.log('RESOLVED after', ((Date.now() - t0) / 1000).toFixed(1), 's');
      done = true;
      break;
    }
  }
  if (!done) console.log('STILL STUCK after 45s. url=', page.url().slice(21));
});
