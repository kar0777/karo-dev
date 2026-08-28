import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });
test.setTimeout(900_000);

const PROJECT = '/app/projects/prj_01kyft44ytevtcq1nv9ep2';

function watch(page: import('@playwright/test').Page, sink: string[]) {
  page.on('console', (m) => m.type() === 'error' && sink.push('CON ' + m.text().slice(0, 240)));
  page.on('pageerror', (e) => sink.push('PERR ' + e.message.slice(0, 240)));
  page.on('response', (r) => {
    if (r.status() >= 400)
      sink.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(21, 130)}`);
  });
  page.on('requestfailed', (r) => {
    if (!r.url().includes('_rsc'))
      sink.push(`REQFAIL ${r.url().slice(21, 130)} ${r.failure()?.errorText}`);
  });
}

test('workspace: 6 tabs', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto(PROJECT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  console.log('load issues:', JSON.stringify(s));

  const tabs = await page
    .getByRole('tab')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
  console.log('TABS:', JSON.stringify(tabs));

  for (const name of ['Chat', 'Code', 'Preview', 'Terminal', 'Tasks', 'Changes']) {
    s.length = 0;
    const t = page.getByRole('tab', { name: new RegExp(`^${name}`, 'i') });
    if (!(await t.count())) {
      console.log(`TAB ${name}: NOT FOUND`);
      continue;
    }
    await t.first().click();
    await page.waitForTimeout(3500);
    const panel = page.getByRole('tabpanel');
    const txt = (
      await panel
        .first()
        .innerText()
        .catch(() => '(no tabpanel)')
    ).replace(/\s+/g, ' ');
    console.log(
      `\nTAB ${name}: selected=${await t.first().getAttribute('aria-selected')}\n  TEXT: ${txt.slice(0, 500)}\n  ISSUES: ${JSON.stringify(s)}`,
    );
  }
});

test('workspace: left rail file tree + history', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto(PROJECT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  s.length = 0;
  const src = page.getByRole('button', { name: 'Actions for src' }).first();
  // click the tree item itself (folder toggle) rather than the actions menu
  const folder = page.getByText('src', { exact: true }).first();
  if (await folder.count()) {
    await folder.click();
    await page.waitForTimeout(1500);
    console.log('expand src -> issues', JSON.stringify(s));
  }
  s.length = 0;
  const file = page.getByText('README.md', { exact: true }).first();
  if (await file.count()) {
    await file.click();
    await page.waitForTimeout(3000);
    console.log('open README.md -> issues', JSON.stringify(s), 'url', page.url().slice(21));
  }

  s.length = 0;
  if (await src.count()) {
    await src.click();
    await page.waitForTimeout(1200);
    const menu = page.getByRole('menu');
    console.log(
      'Actions for src -> menu=',
      await menu.count(),
      (
        await menu
          .first()
          .innerText()
          .catch(() => '')
      )
        .replace(/\s+/g, ' ')
        .slice(0, 200),
    );
    await page.keyboard.press('Escape');
  }

  for (const label of ['New file', 'New folder', 'Refresh file tree', 'Refresh git status']) {
    s.length = 0;
    const b = page.getByRole('button', { name: label }).first();
    if (!(await b.count())) {
      console.log(`${label}: NOT FOUND`);
      continue;
    }
    await b.click();
    await page.waitForTimeout(1800);
    const dlg = await page.getByRole('dialog').count();
    const inputs = await page.locator('input:focus').count();
    console.log(`${label}: dialogs=${dlg} focusedInput=${inputs} issues=${JSON.stringify(s)}`);
    if (dlg) {
      console.log(
        '   ',
        (await page.getByRole('dialog').first().innerText()).replace(/\s+/g, ' ').slice(0, 300),
      );
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // History
  s.length = 0;
  const hist = page.getByRole('button', { name: /^History/ }).first();
  if (await hist.count()) {
    await hist.click();
    await page.waitForTimeout(2500);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    console.log('History -> issues', JSON.stringify(s));
    console.log(
      '  panel text:',
      body.slice(body.indexOf('History'), body.indexOf('History') + 400),
    );
  } else console.log('History button NOT FOUND');
});

test('workspace: right rail sections + model picker', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto(PROJECT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  for (const label of [
    'Agent',
    'Machine',
    'Session cost',
    'MCP connections',
    'Skills',
    'Permissions',
    'Activity',
  ]) {
    s.length = 0;
    const b = page.getByRole('button', { name: new RegExp(`^${label}$`) }).first();
    if (!(await b.count())) {
      console.log(`RAIL ${label}: NOT FOUND`);
      continue;
    }
    await b.click();
    await page.waitForTimeout(2000);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const i = body.indexOf(label);
    console.log(`RAIL ${label}: issues=${JSON.stringify(s)}\n   ${body.slice(i, i + 320)}`);
  }

  // model pickers
  s.length = 0;
  const combos = page.getByRole('combobox');
  const n = await combos.count();
  console.log('comboboxes =', n);
  for (let i = 0; i < n; i++) {
    s.length = 0;
    const c = combos.nth(i);
    const label = await c.getAttribute('aria-label');
    const text = (await c.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 40);
    await c.click().catch((e) => s.push('click threw ' + String(e).slice(0, 80)));
    await page.waitForTimeout(2000);
    const listbox = page.getByRole('listbox');
    const opts = await page
      .getByRole('option')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim().slice(0, 40)));
    console.log(
      `COMBO#${i} label=${label} text=${text} listbox=${await listbox.count()} options=${opts.length}`,
    );
    console.log('   first options:', JSON.stringify(opts.slice(0, 8)));
    console.log('   issues:', JSON.stringify(s));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }
});

test('workspace: composer controls', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto(PROJECT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  for (const label of [
    'Attach files',
    'Hide the explorer',
    'Hide the agent panel',
    'Collapse sidebar',
  ]) {
    s.length = 0;
    const b = page.getByRole('button', { name: label }).first();
    if (!(await b.count())) {
      console.log(`${label}: NOT FOUND`);
      continue;
    }
    await b.click();
    await page.waitForTimeout(1500);
    console.log(
      `${label}: issues=${JSON.stringify(s)} dialogs=${await page.getByRole('dialog').count()}`,
    );
    await page.keyboard.press('Escape');
  }

  // slash command menu
  s.length = 0;
  const box = page.getByRole('textbox').first();
  await box.click();
  await box.fill('/');
  await page.waitForTimeout(2000);
  const opts = await page
    .getByRole('option')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim().slice(0, 40)));
  console.log(
    'slash menu options:',
    opts.length,
    JSON.stringify(opts.slice(0, 10)),
    'issues',
    JSON.stringify(s),
  );
  await box.fill('');
  await page.keyboard.press('Escape');
});
