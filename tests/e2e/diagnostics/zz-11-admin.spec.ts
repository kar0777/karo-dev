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
      sink.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(21, 110)}`);
  });
}

test('admin/plans + incidents body', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  for (const p of [
    '/admin/plans',
    '/admin/incidents',
    '/admin/sandboxes',
    '/admin/providers',
  ]) {
    s.length = 0;
    await page.goto(p, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const idx = body.indexOf('Back to Karo');
    console.log(
      `\n### ${p}\n  BODY: ${body.slice(idx > 0 ? idx + 13 : 0, (idx > 0 ? idx + 13 : 0) + 1100)}`,
    );
    console.log('  ISSUES:', JSON.stringify(s));
  }
});

test('admin/models: dialogs, filters, sync', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto('/admin/models', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // filter tabs
  for (const t of ['Enabled', 'Disabled', 'All']) {
    s.length = 0;
    const b = page
      .getByRole('button', { name: new RegExp(`^${t}$`) })
      .or(page.getByRole('link', { name: new RegExp(`^${t}$`) }));
    if (!(await b.count())) {
      console.log(`filter ${t}: NOT FOUND`);
      continue;
    }
    await b.first().click();
    await page.waitForTimeout(1800);
    const rows = await page.locator('tbody tr').count();
    console.log(
      `filter ${t}: url=${page.url().slice(21)} rows=${rows} issues=${JSON.stringify(s)}`,
    );
  }

  // model row -> edit dialog
  s.length = 0;
  await page.goto('/admin/models', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const firstRow = page.locator('tbody tr').first();
  await firstRow.click();
  await page.waitForTimeout(1800);
  let dlg = page.getByRole('dialog');
  console.log('row click -> dialog count:', await dlg.count(), 'issues', JSON.stringify(s));
  if (await dlg.count()) {
    console.log(
      '  DIALOG:',
      (await dlg.first().innerText()).replace(/\s+/g, ' ').slice(0, 700),
    );
    const btns = await dlg
      .first()
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
    console.log('  DIALOG BUTTONS:', JSON.stringify(btns));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }

  // price button
  s.length = 0;
  const priceBtn = page.getByRole('button', { name: /in.*out/ }).first();
  if (await priceBtn.count()) {
    await priceBtn.click();
    await page.waitForTimeout(1800);
    dlg = page.getByRole('dialog');
    console.log('price click -> dialog count:', await dlg.count(), 'issues', JSON.stringify(s));
    if (await dlg.count()) {
      console.log(
        '  PRICE DIALOG:',
        (await dlg.first().innerText()).replace(/\s+/g, ' ').slice(0, 700),
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }

  // sync button
  s.length = 0;
  const sync = page.getByRole('button', { name: /Sync from provider/i }).first();
  if (await sync.count()) {
    await sync.click();
    await page.waitForTimeout(2000);
    dlg = page.getByRole('dialog');
    console.log('sync click -> dialog count:', await dlg.count());
    if (await dlg.count()) {
      console.log(
        '  SYNC DIALOG:',
        (await dlg.first().innerText()).replace(/\s+/g, ' ').slice(0, 700),
      );
      const btns = await dlg
        .first()
        .getByRole('button')
        .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
      console.log('  SYNC BUTTONS:', JSON.stringify(btns));
      await page.keyboard.press('Escape');
    }
    console.log('  issues', JSON.stringify(s));
  }

  // toggles: enabled / default switches — read only, report presence
  const switches = await page.getByRole('switch').count();
  const checkboxes = await page.getByRole('checkbox').count();
  console.log('switches=', switches, 'checkboxes=', checkboxes);
});

test('admin/providers dialogs', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto('/admin/providers', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const btns = await page
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
  console.log('PROVIDER BUTTONS:', JSON.stringify(btns));
  for (const name of btns.slice(0, 8)) {
    if (/back to karo|search|karo admin/i.test(name)) continue;
    s.length = 0;
    const b = page.getByRole('button', { name, exact: true }).first();
    if (!(await b.count())) continue;
    await b.click().catch(() => {});
    await page.waitForTimeout(1500);
    const dlgs = await page.getByRole('dialog').count();
    console.log(`  "${name}" -> dialogs=${dlgs} issues=${JSON.stringify(s)}`);
    if (dlgs) {
      console.log(
        '    ',
        (await page.getByRole('dialog').first().innerText()).replace(/\s+/g, ' ').slice(0, 500),
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  }
});

test('admin/settings + audit + usage controls', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  for (const p of ['/admin/settings', '/admin/audit', '/admin/usage', '/admin/costs']) {
    s.length = 0;
    await page.goto(p, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    const btns = await page
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
    console.log(`\n### ${p} buttons: ${JSON.stringify(btns.slice(0, 20))}`);
    console.log('  load issues:', JSON.stringify(s));
  }
});
