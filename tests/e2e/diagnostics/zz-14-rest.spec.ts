import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });
test.setTimeout(900_000);

const PROJECT = '/app/projects/prj_01kyft44ytevtcq1nv9ep2';
const MCP = '/app/mcp/mcp_01kyft44zsv0rkh7rg5mq0';

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

test('code tab: what the user actually sees after opening a file', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto(PROJECT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.getByText('README.md', { exact: true }).first().click();
  await page.waitForTimeout(9000);
  const panel = await page
    .getByRole('tabpanel')
    .first()
    .innerText()
    .catch(() => '(none)');
  console.log(
    'CODE PANEL after opening README.md:\n',
    panel.replace(/\s+/g, ' ').slice(0, 900),
  );
  console.log('ISSUES:', JSON.stringify(s));
  const hasMonaco = await page.locator('.monaco-editor').count();
  console.log('monaco DOM nodes =', hasMonaco);
});

test('right rail sections, scoped', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  await page.goto(PROJECT, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const rail = page.locator('aside').last();
  console.log('aside count =', await page.locator('aside').count());
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
    const b = rail.getByRole('button', { name: new RegExp(`^${label}$`) }).first();
    if (!(await b.count())) {
      console.log(`RAIL ${label}: NOT FOUND in aside`);
      continue;
    }
    await b.click();
    await page.waitForTimeout(1800);
    const expanded = await b.getAttribute('aria-expanded');
    const region = (await rail.innerText()).replace(/\s+/g, ' ');
    const i = region.indexOf(label);
    console.log(
      `RAIL ${label}: expanded=${expanded} issues=${JSON.stringify(s)}\n   ${region.slice(i, i + 350)}`,
    );
  }

  // History button in left rail
  s.length = 0;
  const hist = page.getByRole('button', { name: /History/ }).first();
  console.log('History buttons:', await page.getByRole('button', { name: /History/ }).count());
  if (await hist.count()) {
    await hist.click();
    await page.waitForTimeout(2500);
    console.log('History -> issues', JSON.stringify(s));
    const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    console.log('   ', t.slice(t.indexOf('History'), t.indexOf('History') + 400));
  }
});

test('app pages: primary controls + dialogs', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);

  const pages: Array<[string, RegExp[]]> = [
    ['/app', [/New project/i]],
    ['/app/projects', [/New project/i]],
    ['/app/agents', [/New|Create|Add/i]],
    ['/app/sandboxes', [/New|Create|Start/i]],
    ['/app/mcp', [/Add|New|Connect/i]],
    ['/app/skills', [/New skill|Create|Add/i]],
    ['/app/plugins', [/Install|Add|Browse/i]],
    ['/app/team', [/Invite|Add member/i]],
    ['/app/billing', [/Manage|Top up|Change plan|Portal/i]],
  ];

  for (const [path, names] of pages) {
    s.length = 0;
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const btns = await page
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
    console.log(
      `\n### ${path}\n  buttons: ${JSON.stringify(btns.slice(0, 14))}\n  load issues: ${JSON.stringify(s)}`,
    );
    for (const n of names) {
      s.length = 0;
      const b = page.getByRole('button', { name: n }).first();
      if (!(await b.count())) {
        console.log(`  ${String(n)}: not found`);
        continue;
      }
      await b.click();
      await page.waitForTimeout(2200);
      const d = page.getByRole('dialog');
      const dc = await d.count();
      console.log(
        `  ${String(n)}: dialogs=${dc} url=${page.url().slice(21)} issues=${JSON.stringify(s)}`,
      );
      if (dc) {
        console.log('     ', (await d.first().innerText()).replace(/\s+/g, ' ').slice(0, 400));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
      }
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
    }
  }
});

test('mcp detail page', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  const r = await page.goto(MCP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  console.log('status', r?.status());
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log('BODY:', body.slice(body.indexOf('MCP'), body.indexOf('MCP') + 900));
  const btns = await page
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
  console.log('buttons:', JSON.stringify(btns));
  console.log('issues:', JSON.stringify(s));

  for (const n of [/Test connection/i, /Refresh tools/i, /Reconnect/i]) {
    s.length = 0;
    const b = page.getByRole('button', { name: n }).first();
    if (!(await b.count())) continue;
    await b.click();
    await page.waitForTimeout(4000);
    console.log(`  ${String(n)}: issues=${JSON.stringify(s)}`);
  }
});

/**
 * Every settings form gates its Save button on being dirty — `disabled={!dirty}`,
 * where `dirty` compares each field against the value it loaded with. That is
 * correct product behaviour, and it is why this spec used to fail: it refilled
 * Name with the value already in it, so the form stayed pristine, Save stayed
 * disabled, and `click()` sat there until it timed out. The button was reporting
 * the truth.
 *
 * So a form has to actually be changed before Save means anything, and a Save
 * that is still disabled is worth logging rather than waiting fifteen seconds on.
 */
async function clickSaveIfEnabled(
  page: import('@playwright/test').Page,
  label: string,
): Promise<boolean> {
  const save = page.getByRole('button', { name: /save/i }).first();
  if (!(await save.count())) {
    console.log(`${label}: no save button`);
    return false;
  }
  if (!(await save.isEnabled())) {
    // The adjacent live region says which state the form thinks it is in.
    const status = await page
      .getByText(/unsaved changes|all changes saved/i)
      .first()
      .innerText()
      .catch(() => '(no status)');
    console.log(`${label}: save is disabled — form reports "${status}"`);
    return false;
  }
  await save.click();
  await page.waitForTimeout(3000);
  return true;
}

test('settings forms: submit profile + notifications', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);

  await page.goto('/app/settings?section=profile', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const name = page.getByLabel(/^Name/).first();
  const before = await name.inputValue();

  // A real edit, so the form is genuinely dirty. Restored at the end.
  await name.fill(`${before} (e2e)`);
  if (await clickSaveIfEnabled(page, 'profile')) {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    console.log('after profile save issues:', JSON.stringify(s));
    console.log('  toast/text:', body.slice(0, 200));
  }

  // Put the seeded value back so re-running this spec starts from the same
  // place — these diagnostics share one database and run in order.
  await page.goto('/app/settings?section=profile', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByLabel(/^Name/).first().fill(before);
  await clickSaveIfEnabled(page, 'profile restore');

  s.length = 0;
  await page.goto('/app/settings?section=notifications', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  // Flip one switch to make the form dirty, then flip it back and save again.
  const toggle = page.getByRole('switch').first();
  if (await toggle.count()) {
    await toggle.click();
    if (await clickSaveIfEnabled(page, 'notifications')) {
      console.log('notifications save issues:', JSON.stringify(s));
    }
    await toggle.click();
    await clickSaveIfEnabled(page, 'notifications restore');
  } else {
    console.log('notifications: no switch to toggle');
    await clickSaveIfEnabled(page, 'notifications');
  }

  s.length = 0;
  await page.goto('/app/settings?section=agent', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  const combos = await page.getByRole('combobox').count();
  console.log('agent defaults: comboboxes=', combos);
  // Nothing generic is safe to change here, so this only reports whether the
  // form arrives pristine — which is what it should do.
  await clickSaveIfEnabled(page, 'agent defaults');
  console.log('agent save issues:', JSON.stringify(s));
});

test('marketing pages console/network', async ({ page }) => {
  const s: string[] = [];
  watch(page, s);
  for (const p of ['/', '/pricing', '/features', '/docs', '/security', '/terms', '/privacy']) {
    s.length = 0;
    const r = await page.goto(p, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    // exercise one interactive control per page
    const btns = await page
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean));
    console.log(
      `${p} status=${r?.status()} buttons=${JSON.stringify(btns.slice(0, 8))} issues=${JSON.stringify(s)}`,
    );
  }
  // pricing interactivity
  s.length = 0;
  await page.goto('/pricing', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const yearly = page.getByRole('button', { name: /yearly|annual/i }).first();
  if (await yearly.count()) {
    await yearly.click();
    await page.waitForTimeout(1500);
    console.log('pricing yearly toggle issues:', JSON.stringify(s));
  }
  const sliders = await page.getByRole('slider').count();
  console.log('pricing sliders =', sliders);
  if (sliders) {
    await page.getByRole('slider').first().press('ArrowRight');
    await page.waitForTimeout(1200);
    console.log('slider issues:', JSON.stringify(s));
  }
});
