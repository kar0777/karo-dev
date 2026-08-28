import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });

test('capture the nav RSC request/response for models vs servers', async ({ page }) => {
  await page.goto('/app/settings?section=profile');
  await page.waitForLoadState('networkidle').catch(() => {});

  const seen: string[] = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (!u.includes('_rsc')) return;
    const req = r.request();
    let body = '(unavailable)';
    try {
      body = (await r.body()).toString('utf8').slice(0, 400);
    } catch {
      /* aborted */
    }
    seen.push(
      [
        `URL ${u.slice(21)}`,
        `  status ${r.status()} ct=${(await r.headerValue('content-type')) ?? '-'} len=${(await r.headerValue('content-length')) ?? '-'}`,
        `  REQHDRS ${JSON.stringify(
          Object.fromEntries(
            Object.entries(req.headers()).filter(([k]) => k.startsWith('next-') || k === 'rsc'),
          ),
        )}`,
        `  BODY ${body}`,
      ].join('\n'),
    );
  });

  await page
    .getByRole('link', { name: /Servers/i })
    .first()
    .click();
  await page.waitForTimeout(2500);
  seen.push('===== now clicking Model & API =====');
  await page
    .getByRole('link', { name: /Model & API/i })
    .first()
    .click();
  await page.waitForTimeout(4000);
  console.log('\n' + seen.join('\n'));
});
