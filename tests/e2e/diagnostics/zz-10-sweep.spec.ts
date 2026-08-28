import { test } from '@playwright/test';

const STATE = process.env.KARO_STATE as string;
test.use({ storageState: STATE });
test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

const APP = [
  '/app',
  '/app/projects',
  '/app/agents',
  '/app/sandboxes',
  '/app/mcp',
  '/app/skills',
  '/app/plugins',
  '/app/usage',
  '/app/billing',
  '/app/api-keys',
  '/app/team',
  '/app/settings?section=profile',
  '/app/settings?section=security',
  '/app/settings?section=agent',
  '/app/settings?section=models',
  '/app/settings?section=servers',
  '/app/settings?section=notifications',
  '/app/settings?section=danger',
];
const ADMIN = [
  '/admin',
  '/admin/usage',
  '/admin/costs',
  '/admin/plans',
  '/admin/models',
  '/admin/providers',
  '/admin/users',
  '/admin/sandboxes',
  '/admin/incidents',
  '/admin/audit',
  '/admin/settings',
];
const MARKETING = [
  '/',
  '/pricing',
  '/features',
  '/docs',
  '/security',
  '/terms',
  '/privacy',
  '/about',
];

test('goto sweep: status, console errors, failed requests, empty-vs-broken', async ({
  page,
}) => {
  const report: string[] = [];
  let errors: string[] = [];
  let net: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 260));
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 260)));
  page.on('response', (r) => {
    if (r.status() >= 400)
      net.push(`${r.status()} ${r.request().method()} ${r.url().slice(21, 120)}`);
  });

  for (const path of [...MARKETING, ...APP, ...ADMIN]) {
    errors = [];
    net = [];
    let status = 0;
    try {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' });
      status = res?.status() ?? 0;
    } catch (e) {
      report.push(`${path}  NAV-THREW ${String(e).slice(0, 120)}`);
      continue;
    }
    await page.waitForTimeout(2200);
    const bodyText = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).replace(/\s+/g, ' ');
    const h1 = await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => '(no h1)');
    const looksError =
      /could not load|went wrong|Something broke|Application error|500|Unhandled/i.test(
        bodyText.slice(0, 2000),
      );
    const looksEmpty = /Nothing here yet|No .* yet|empty|You have not|No results/i.test(
      bodyText,
    );
    report.push(
      [
        `${path}`,
        `  status=${status} h1=${h1.slice(0, 50)} len=${bodyText.length}${looksError ? ' ERROR-UI' : ''}${looksEmpty ? ' (empty-state text present)' : ''}`,
        errors.length ? `  CONSOLE: ${JSON.stringify(errors.slice(0, 4))}` : '',
        net.length ? `  NET: ${JSON.stringify([...new Set(net)].slice(0, 6))}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  console.log('\n===== GOTO SWEEP =====\n' + report.join('\n'));
});

test('click-nav sweep: which soft navigations hang', async ({ page }) => {
  const out: string[] = [];

  async function clickNav(from: string, names: RegExp[]) {
    await page.goto(from, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    for (const n of names) {
      await page.goto(from, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const before = page.url();
      const l = page.getByRole('link', { name: n });
      if ((await l.count()) === 0) {
        out.push(`  ${String(n)} : LINK NOT FOUND on ${from}`);
        continue;
      }
      const href = await l.first().getAttribute('href');
      await l
        .first()
        .click()
        .catch((e) => out.push(`  click threw ${String(e).slice(0, 80)}`));
      let ok = false;
      for (let i = 0; i < 14; i++) {
        await page.waitForTimeout(700);
        if (page.url() !== before) {
          ok = true;
          break;
        }
      }
      out.push(
        `  ${String(n)} -> ${href} : ${ok ? 'OK ' + page.url().slice(21) : 'HUNG (url never changed in 10s)'}`,
      );
    }
  }

  out.push('--- from /app/settings?section=profile (settings nav) ---');
  await clickNav('/app/settings?section=profile', [
    /^Security$/,
    /^Agent defaults$/,
    /^Model & API$/,
    /^Servers$/,
    /^Notifications$/,
    /^Danger zone$/,
  ]);

  out.push('--- from /app (main sidebar) ---');
  await clickNav('/app', [
    /^Projects$/,
    /^Agents$/,
    /^Sandboxes$/,
    /^MCP$/,
    /^Skills$/,
    /^Plugins$/,
    /^Usage$/,
    /^Billing$/,
    /^API keys$/,
    /^Team$/,
    /^Settings$/,
  ]);

  out.push('--- from /admin/usage (admin sidebar) ---');
  await clickNav('/admin/usage', [
    /^Costs$/,
    /^Plans$/,
    /^Models$/,
    /^Providers$/,
    /^Users$/,
    /^Sandboxes$/,
    /^Incidents/,
    /^Audit$/,
    /^Settings$/,
    /^Overview$/,
  ]);

  console.log('\n===== CLICK NAV SWEEP =====\n' + out.join('\n'));
});
