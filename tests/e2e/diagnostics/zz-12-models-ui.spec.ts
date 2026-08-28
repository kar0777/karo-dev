import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

function watch(page: import('@playwright/test').Page, sink: string[]) {
  page.on('console', (m) => m.type() === 'error' && sink.push('CON ' + m.text().slice(0, 220)));
  page.on('pageerror', (e) => sink.push('PERR ' + e.message.slice(0, 220)));
  page.on('response', (r) => {
    if (r.status() >= 400)
      sink.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(21, 120)}`);
  });
}

test('admin/models full interaction', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  const api: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/')) api.push(`${r.method()} ${r.url().slice(21, 110)}`);
  });

  await page.goto('/admin/models', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // filter input
  s.length = 0;
  await page.getByLabel('Filter models').fill('opus');
  await page.waitForTimeout(1200);
  console.log(
    'filter "opus" rows =',
    await page.locator('tbody tr').count(),
    'issues',
    JSON.stringify(s),
  );
  await page.getByLabel('Filter models').fill('');
  await page.waitForTimeout(800);

  // segmented control
  for (const label of ['All', 'Enabled', 'Disabled']) {
    s.length = 0;
    const seg = page
      .getByRole('radiogroup', { name: 'Model availability' })
      .or(page.locator('[aria-label="Model availability"]'));
    const opt = seg.getByText(label, { exact: true }).first();
    if (!(await opt.count())) {
      console.log(`segmented ${label}: not found`);
      continue;
    }
    await opt.click();
    await page.waitForTimeout(1000);
    console.log(
      `segmented ${label}: rows=${await page.locator('tbody tr').count()} issues=${JSON.stringify(s)}`,
    );
  }
  await page
    .locator('[aria-label="Model availability"]')
    .getByText('All', { exact: true })
    .first()
    .click();
  await page.waitForTimeout(800);

  // price history drawer
  s.length = 0;
  api.length = 0;
  const hist = page.getByRole('button', { name: /^Price history and overrides for/ }).first();
  console.log(
    'history buttons =',
    await page.getByRole('button', { name: /^Price history and overrides for/ }).count(),
  );
  await hist.click();
  await page.waitForTimeout(2500);
  const sheet = page.getByRole('dialog');
  console.log(
    'drawer open =',
    await sheet.count(),
    'api=',
    JSON.stringify(api),
    'issues',
    JSON.stringify(s),
  );
  if (await sheet.count()) {
    console.log(
      '  DRAWER:',
      (await sheet.first().innerText()).replace(/\s+/g, ' ').slice(0, 800),
    );
    // invalid JSON override -> expect inline validation, do not save valid data
    await sheet
      .first()
      .getByLabel(/Admin override/i)
      .fill('{not json');
    await sheet
      .first()
      .getByRole('button', { name: /Save override/i })
      .click();
    await page.waitForTimeout(1500);
    console.log(
      '  after bad override:',
      (await sheet.first().innerText()).replace(/\s+/g, ' ').slice(0, 400),
    );
    console.log('  api', JSON.stringify(api), 'issues', JSON.stringify(s));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  // inline price editor: open + cancel (no write)
  s.length = 0;
  api.length = 0;
  const priceBtn = page.getByRole('button', { name: /^Edit price for/ }).first();
  console.log(
    'price buttons =',
    await page.getByRole('button', { name: /^Edit price for/ }).count(),
  );
  await priceBtn.click();
  await page.waitForTimeout(1200);
  const inputPrice = page.getByLabel('Input price per million tokens, USD');
  console.log('price editor open =', await inputPrice.count(), 'issues', JSON.stringify(s));
  if (await inputPrice.count()) {
    const cancel = page.getByLabel('Cancel price edit').first();
    await cancel.click();
    await page.waitForTimeout(800);
    console.log(
      '  cancelled, editor still open =',
      await page.getByLabel('Input price per million tokens, USD').count(),
    );
  }

  // sync
  s.length = 0;
  api.length = 0;
  await page.getByRole('button', { name: /Sync from provider/i }).click();
  await page.waitForTimeout(9000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const alertIdx =
    body.indexOf('Catalogue already up to date') >= 0
      ? body.indexOf('Catalogue already up to date')
      : body.indexOf('catalogue change');
  console.log('SYNC api:', JSON.stringify(api));
  console.log('SYNC issues:', JSON.stringify(s));
  console.log(
    'SYNC result text:',
    alertIdx >= 0
      ? body.slice(Math.max(0, alertIdx - 60), alertIdx + 500)
      : '(no alert found) toast? ' +
          body.slice(
            body.indexOf('Sync from provider'),
            body.indexOf('Sync from provider') + 300,
          ),
  );
});

test('settings models section: BYOK dialog + api-keys page', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto('/app/settings?section=models', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const links = await page
    .locator('section[aria-label="Model & API"] a')
    .evaluateAll((els) =>
      els.map(
        (e) =>
          `${(e as HTMLAnchorElement).getAttribute('href')}::${(e.textContent ?? '').trim()}`,
      ),
    );
  console.log('models section links:', JSON.stringify(links));
  const btns = await page
    .locator('section[aria-label="Model & API"]')
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
  console.log('models section buttons:', JSON.stringify(btns));
  console.log('issues:', JSON.stringify(s));

  // Follow the BYOK link
  s.length = 0;
  await page
    .getByRole('link', { name: /Use your own API key/i })
    .first()
    .click();
  await page.waitForTimeout(3000);
  console.log('BYOK link -> url', page.url().slice(21), 'issues', JSON.stringify(s));

  // api-keys page: open the add dialog
  s.length = 0;
  await page.goto('/app/api-keys', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const abtns = await page
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
  console.log('api-keys buttons:', JSON.stringify(abtns));
  const add = page.getByRole('button', { name: /add|new|connect|byok|key/i }).first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(1800);
    const d = page.getByRole('dialog');
    console.log('add-key dialog =', await d.count(), 'issues', JSON.stringify(s));
    if (await d.count()) {
      console.log('  ', (await d.first().innerText()).replace(/\s+/g, ' ').slice(0, 700));
      // submit empty to check validation
      const submit = d
        .first()
        .getByRole('button', { name: /save|add|connect|create/i })
        .first();
      if (await submit.count()) {
        await submit.click();
        await page.waitForTimeout(1500);
        console.log(
          '  after empty submit:',
          (await d.first().innerText()).replace(/\s+/g, ' ').slice(0, 500),
        );
        console.log('  issues', JSON.stringify(s));
      }
      await page.keyboard.press('Escape');
    }
  }
});

test('workspace model pickers', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto('/app/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const projectLinks = await page
    .locator('a[href^="/app/projects/"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!));
  console.log('project links:', JSON.stringify([...new Set(projectLinks)].slice(0, 10)));
  const target = [...new Set(projectLinks)][0];
  if (!target) {
    console.log('NO PROJECTS — cannot test workspace model picker');
    return;
  }
  s.length = 0;
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  console.log('workspace url', page.url().slice(21), 'issues', JSON.stringify(s));
  const btns = await page
    .getByRole('button')
    .evaluateAll((els) =>
      els
        .map(
          (e) =>
            `${(e.getAttribute('aria-label') ?? '').trim()}|${(e.textContent ?? '').trim().slice(0, 30)}`,
        )
        .filter((x) => x !== '|'),
    );
  console.log('workspace buttons:', JSON.stringify(btns.slice(0, 60), null, 0));
  const combos = await page
    .getByRole('combobox')
    .evaluateAll((els) =>
      els.map(
        (e) =>
          `${e.getAttribute('aria-label') ?? ''}|${(e.textContent ?? '').trim().slice(0, 40)}`,
      ),
    );
  console.log('workspace comboboxes:', JSON.stringify(combos));
});
