import { expect, test, type Page } from '@playwright/test';

/**
 * Regressions in the workspace's client state.
 *
 * Every failure these cover was reported from the running product and none of
 * them is visible to a server-side assertion: the model picker rendered its
 * placeholder because a stored id survived into a filtered list, and a second
 * Enter pressed during the conversation-creation round trip started a second
 * stream. Both need a real browser to reproduce, which is why they live here.
 */

const EMAIL = process.env.E2E_EMAIL ?? 'admin@karo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'karo-admin-2025';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
}

/** Opens the newest project this account can see. */
async function openWorkspace(page: Page) {
  await page.goto('/app/projects');
  const card = page.locator('a[href^="/app/projects/"]').first();
  await card.waitFor({ timeout: 20_000 });
  await card.click();
  await page.waitForURL(/\/app\/projects\/prj_/, { timeout: 30_000 });
}

test('the composer preselects a model that is actually on offer', async ({ page }) => {
  await signIn(page);
  await openWorkspace(page);

  const picker = page.getByRole('tabpanel', { name: 'Chat' }).getByLabel('Model');
  await expect(picker).toBeVisible({ timeout: 30_000 });

  // The placeholder means `value` matched no `SelectItem` — which used to happen
  // whenever the project's default model belonged to a provider without
  // credentials, since `loadWorkspaceData` drops those from the list.
  await expect(picker).not.toHaveText(/choose a model/i);

  const selected = ((await picker.textContent()) ?? '').trim();
  expect(selected, 'the trigger names a model').not.toBe('');

  // And the preselection must be one of the offered options, not merely
  // non-empty: an id that survives into `value` without a matching option is
  // exactly the state that produced the placeholder.
  await picker.click();
  await expect(page.getByRole('option', { name: selected, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('two quick sends do not start two runs or two chats', async ({ page }) => {
  await signIn(page);

  /*
   * The race needs a workspace with *no* conversation, because the gap it lives
   * in is the round trip `ensureConversation` makes to create the first one —
   * with a chat already open there is nothing to await and the guard is never
   * tested. Reached by deleting the chat every new project is seeded with,
   * which is exactly what `/clear` and "delete the last chat" do in the product.
   */
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'karo_csrf')?.value ?? '';
  // Double-submit token *plus* a same-origin proof: `assertCsrf` wants both.
  const origin = new URL(page.url()).origin;
  const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf, origin };

  const created = await page.request.post('/api/projects', {
    headers,
    data: { name: `Race probe ${Date.now()}`, template: 'blank', runtimeTarget: 'karo_cloud' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const projectId = (await created.json()).project.id as string;

  const list = await page.request.get(`/api/projects/${projectId}/conversations`);
  for (const conversation of (await list.json()).conversations as Array<{ id: string }>) {
    await page.request.delete(`/api/conversations/${conversation.id}`, { headers });
  }

  await page.goto(`/app/projects/${projectId}`);

  const composer = page.getByRole('tabpanel', { name: 'Chat' }).getByRole('textbox');
  await composer.waitFor({ timeout: 30_000 });

  const runRequests: string[] = [];
  const createRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() !== 'POST') return;
    if (/\/api\/conversations\/[^/]+\/messages$/.test(url)) runRequests.push(url);
    if (/\/api\/projects\/[^/]+\/conversations$/.test(url)) createRequests.push(url);
  });

  await composer.fill('Say hello');

  /*
   * Both Enters in one synchronous block.
   *
   * Driving them through Playwright's keyboard leaves a CDP round trip between
   * them — long enough that `setPhase('starting')` has usually landed, so the
   * `isStreaming` guard catches the second press and the race never runs. The
   * window this test exists for is shorter than that: it closes the moment
   * `await ensureConversation()` resolves. Dispatching both keydowns without
   * yielding to the event loop is the only way to land inside it every time.
   */
  await page.evaluate(() => {
    const field = document.querySelector('textarea');
    if (!field) throw new Error('composer not found');
    const enter = () =>
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    field.dispatchEvent(enter());
    field.dispatchEvent(enter());
  });

  await page.waitForTimeout(5_000);

  expect(runRequests, `started ${runRequests.length} runs`).toHaveLength(1);
  expect(createRequests.length, 'created more than one conversation').toBeLessThanOrEqual(1);
});

test('a chat is renamed in the sidebar without a reload', async ({ page }) => {
  await signIn(page);
  await openWorkspace(page);

  const chat = page.getByRole('tabpanel', { name: 'Chat' });
  await chat.getByRole('textbox').waitFor({ timeout: 30_000 });

  // The same path the "New chat" button takes, without depending on which rail
  // section happens to be expanded.
  await page.keyboard.press('Control+Shift+KeyN');
  await expect(page.getByText('New chat').first()).toBeVisible({ timeout: 10_000 });

  const prompt = 'Explain the repository layout';
  await chat.getByRole('textbox').fill(prompt);
  await chat.getByRole('textbox').press('Enter');

  // The chat header adopts the title as soon as `run.start` carries it.
  await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });

  // And so does the conversation list, which is the surface that used to show a
  // column of identical "New chat" rows until the page was reloaded.
  await page
    .getByRole('button', { name: /^history/i })
    .first()
    .click();
  const row = page.getByRole('button', { name: new RegExp(prompt, 'i') }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
});
