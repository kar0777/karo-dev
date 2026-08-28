import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });

test('trace everything during the hanging click', async ({ page }) => {
  await page.goto('/app/settings?section=profile');
  await page.waitForLoadState('networkidle').catch(() => {});

  const t0 = Date.now();
  const ms = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6);
  const log: string[] = [];
  page.on('request', (r) => {
    const h = r.headers();
    const tag = h['next-router-segment-prefetch']
      ? 'SEGPF=' + h['next-router-segment-prefetch']
      : h['next-router-prefetch']
        ? 'PREFETCH'
        : h['rsc']
          ? 'RSC-NAV'
          : '';
    log.push(`${ms()} REQ ${tag} ${r.url().slice(21, 130)}`);
  });
  page.on('response', (r) => log.push(`${ms()} RES ${r.status()} ${r.url().slice(21, 130)}`));
  page.on('requestfinished', (r) => log.push(`${ms()} FIN ${r.url().slice(21, 130)}`));
  page.on('requestfailed', (r) =>
    log.push(`${ms()} FAIL ${r.url().slice(21, 130)} ${r.failure()?.errorText}`),
  );
  page.on('console', (m) => log.push(`${ms()} CON.${m.type()} ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => log.push(`${ms()} PERR ${e.message.slice(0, 200)}`));

  log.push(`${ms()} --- click ---`);
  await page
    .getByRole('link', { name: /Model & API/i })
    .first()
    .click();
  await page.waitForTimeout(20000);
  log.push(`${ms()} url=${page.url().slice(21)}`);
  console.log('\n' + log.join('\n'));
});

test('same trace for servers (working control)', async ({ page }) => {
  await page.goto('/app/settings?section=profile');
  await page.waitForLoadState('networkidle').catch(() => {});
  const t0 = Date.now();
  const ms = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(6);
  const log: string[] = [];
  page.on('request', (r) => {
    const h = r.headers();
    const tag = h['next-router-segment-prefetch']
      ? 'SEGPF=' + h['next-router-segment-prefetch']
      : h['next-router-prefetch']
        ? 'PREFETCH'
        : h['rsc']
          ? 'RSC-NAV'
          : '';
    log.push(`${ms()} REQ ${tag} ${r.url().slice(21, 130)}`);
  });
  page.on('requestfinished', (r) => log.push(`${ms()} FIN ${r.url().slice(21, 130)}`));
  page.on('requestfailed', (r) =>
    log.push(`${ms()} FAIL ${r.url().slice(21, 130)} ${r.failure()?.errorText}`),
  );
  log.push(`${ms()} --- click ---`);
  await page
    .getByRole('link', { name: /Servers/i })
    .first()
    .click();
  await page.waitForTimeout(6000);
  log.push(`${ms()} url=${page.url().slice(21)}`);
  console.log('\n' + log.join('\n'));
});
