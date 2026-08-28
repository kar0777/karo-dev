#!/usr/bin/env node
/**
 * Karo — production smoke check (zero dependencies, Node 18+).
 *
 *   BASE_URL=https://your-project.vercel.app node scripts/smoke.mjs
 *
 * Add `--demo` to also sign in to the demo account and open the workspace:
 *
 *   BASE_URL=https://your-project.vercel.app node scripts/smoke.mjs --demo
 *
 * What it proves, in order: the platform is up, the marketing site renders,
 * the SEO routes serve, and (with --demo) a visitor can sign in and reach the
 * product shell. Every failing check is reported; the exit code is non-zero
 * when anything failed. Failures are counted rather than exiting mid-run —
 * `process.exit` with open sockets trips a libuv assertion on Windows.
 */

const BASE_URL = (process.env.BASE_URL ?? process.argv[2] ?? '').replace(/\/+$/, '');
const WITH_DEMO = process.argv.includes('--demo') || process.env.SMOKE_DEMO === 'true';

if (!BASE_URL) {
  console.error('Usage: BASE_URL=https://<host> node scripts/smoke.mjs [--demo]');
  process.exit(2);
}

let passed = 0;
let failed = 0;

function ok(label) {
  passed += 1;
  console.log(`  ✔ ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(`  ✖ ${label}`);
  if (detail !== undefined) console.error(`    ${detail}`);
}

async function check(label, run) {
  try {
    await run();
    ok(label);
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

async function expectStatus(label, path, expected) {
  await check(label, async () => {
    const response = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
    if (response.status !== expected) {
      throw new Error(`GET ${path} → ${response.status} (expected ${expected})`);
    }
    await response.body?.cancel();
    return response;
  });
}

console.log(`▸ Smoke ${BASE_URL}${WITH_DEMO ? ' (with demo sign-in)' : ''}`);

await expectStatus('health endpoint', '/api/health', 200);
await check('health reports a live database', async () => {
  const response = await fetch(`${BASE_URL}/api/health`);
  const body = await response.json();
  if (body.status === 'down') throw new Error(`health status: ${body.status}`);
});

await expectStatus('marketing site', '/', 200);
await check('marketing site names the product', async () => {
  const html = await (await fetch(`${BASE_URL}/`)).text();
  if (!html.toLowerCase().includes('karo')) throw new Error('landing page does not mention Karo');
});

await expectStatus('robots.txt', '/robots.txt', 200);
await expectStatus('sitemap.xml', '/sitemap.xml', 200);

if (WITH_DEMO) {
  // `Origin` is the same-origin proof the CSRF layer accepts from a client
  // that holds no session and no token — exactly what the login page sends.
  const response = await fetch(`${BASE_URL}/api/auth/demo`, {
    method: 'POST',
    headers: { origin: BASE_URL },
  });
  await check('demo sign-in', async () => {
    if (response.status !== 200) {
      throw new Error(`POST /api/auth/demo → ${response.status} (is the DB seeded?)`);
    }
  });

  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  await check('workspace shell loads for the demo session', async () => {
    if (!cookie.startsWith('karo_session=')) throw new Error('no session cookie was set');
    const app = await fetch(`${BASE_URL}/app`, { headers: { cookie } });
    if (app.status !== 200) throw new Error(`GET /app → ${app.status}`);
    await app.body?.cancel();
  });
}

if (failed > 0) {
  console.error(`✖ Smoke failed — ${failed} check${failed === 1 ? '' : 's'} red`);
  process.exitCode = 1;
} else {
  console.log(`✔ Smoke passed — ${passed} check${passed === 1 ? '' : 's'} green`);
}
