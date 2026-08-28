import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });

test('rsc payload fetch from the page', async ({ page }) => {
  await page.goto('/app/settings?section=profile');
  await page.waitForLoadState('networkidle').catch(() => {});

  for (const s of ['models', 'servers', 'profile']) {
    const out = await page.evaluate(async (section) => {
      try {
        const r = await fetch(`/app/settings?section=${section}`, { headers: { RSC: '1' } });
        const t = await r.text();
        return {
          status: r.status,
          len: t.length,
          ct: r.headers.get('content-type'),
          tail: t.slice(-160),
        };
      } catch (e) {
        return { error: String(e) };
      }
    }, s);
    console.log(`FETCH section=${s} ->`, JSON.stringify(out));
  }
});

test('repeat click 3x + check for a stuck transition', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  page.on(
    'console',
    (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text().slice(0, 200)),
  );
  await page.goto('/app/settings?section=profile');
  await page.waitForLoadState('networkidle').catch(() => {});

  for (let i = 0; i < 3; i++) {
    await page
      .getByRole('link', { name: /Model & API/i })
      .first()
      .click();
    await page.waitForTimeout(2500);
    console.log(`click#${i + 1} url=${page.url().slice(21)}`);
  }
  console.log('ERRS', JSON.stringify(errs));

  // Does history.pushState work at all? try router via JS link click on servers then models
  await page
    .getByRole('link', { name: /Servers/i })
    .first()
    .click();
  await page.waitForTimeout(1500);
  console.log('after Servers url=', page.url().slice(21));
  await page
    .getByRole('link', { name: /Model & API/i })
    .first()
    .click();
  await page.waitForTimeout(3000);
  console.log('after Model&API from servers url=', page.url().slice(21));
  console.log('ERRS2', JSON.stringify(errs));
});

test('does size matter: compare rsc byte counts', async ({ page }) => {
  await page.goto('/app/settings?section=profile');
  const sizes: Record<string, number> = {};
  page.on('response', async (r) => {
    if (r.url().includes('_rsc')) {
      try {
        const b = await r.body();
        sizes[r.url().slice(21, 70)] = b.length;
      } catch {
        // Body already consumed or the response was cancelled; -1 marks it.
        sizes[r.url().slice(21, 70)] = -1;
      }
    }
  });
  await page
    .getByRole('link', { name: /Model & API/i })
    .first()
    .click();
  await page.waitForTimeout(5000);
  console.log('RSC BODY SIZES:', JSON.stringify(sizes, null, 1));
});
