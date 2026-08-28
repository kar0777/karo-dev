/**
 * Seeds the Karo database.
 *
 * Idempotent by design: run it as often as you like. Catalogue rows (providers,
 * models, plans, skills, plugins, settings) are upserted on their natural key,
 * and the demo workspace is torn down and rebuilt so its numbers stay internally
 * consistent instead of accumulating a second month of usage every run.
 *
 * Every figure below is derived, never invented: weighted tokens come from
 * `calculateWeightedTokens`, charges from `settleModelUsage` /
 * `settleComputeUsage`, and compute multipliers from
 * `calculateComputeMultiplier`. Change a price seed and the demo dashboard
 * changes with it.
 *
 * Run with `npm run db:seed`.
 */
import { createHash } from 'node:crypto';

import { and, eq, inArray, isNull, notInArray, sql as raw } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { hashPassword } from '@/lib/crypto/password';
import { ID_PREFIX, newId } from '@/lib/ids';
import { calculateComputeMultiplier } from '@/lib/pricing/compute';
import {
  settleComputeUsage,
  settleModelUsage,
  type PlanPricingConfig,
} from '@/lib/pricing/calculator';
import { calculateWeightedTokens, type TokenPrices } from '@/lib/pricing/weighted-tokens';

import * as schema from './schema';
import {
  ADMIN_SETTING_SEEDS,
  DEFAULT_MODEL_SLUG,
  MCP_TEMPLATES_SETTING_KEY,
  MCP_TEMPLATE_SEEDS,
  MODEL_PRICE_SEEDS,
  MODEL_SEEDS,
  PLAN_SEEDS,
  PLUGIN_SEEDS,
  PROJECT_TEMPLATES_SETTING_KEY,
  PROJECT_TEMPLATE_SEEDS,
  PROVIDER_SEEDS,
  SKILL_SEEDS,
  findProjectTemplate,
} from './seed-data';
import { loadScriptEnv } from './load-env';

loadScriptEnv();

/* ------------------------------------------------------------------ *
 *  Small utilities
 * ------------------------------------------------------------------ */

/** Deterministic PRNG so two seed runs produce the same demo charts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const rand = mulberry32(0x4b41524f); // "KARO"

function randInt(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error('pick() called with an empty array');
  return item;
}

function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`Seed invariant broken: ${what}`);
  return value;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'markdown',
  py: 'python',
  txt: 'plaintext',
  yml: 'yaml',
  yaml: 'yaml',
};

function languageFor(path: string): string | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_LANGUAGES[path.slice(dot + 1).toLowerCase()] ?? null;
}

function formatUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

/* ------------------------------------------------------------------ *
 *  Demo content that the seeded conversation actually produced
 * ------------------------------------------------------------------ */

/**
 * `app/globals.css` after the fix the demo conversation walks through. The
 * write_file tool call in that conversation is what produced this file, so the
 * two must not drift apart.
 */
const AURORA_GLOBALS_CSS = `:root {
  color-scheme: light dark;
  --page-fg: #16170f;
  --page-bg: #fbfbf7;
  --page-accent: #1f7a52;
}

@media (prefers-color-scheme: dark) {
  :root {
    --page-fg: #edeee6;
    --page-bg: #14150f;
    --page-accent: #4ec48c;
  }
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  background: var(--page-bg);
  color: var(--page-fg);
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
}

.page {
  max-width: 40rem;
  margin: 0 auto;
  /* Was a flat 1.5rem: on a 360px phone the hero lost a third of its width. */
  padding: clamp(2rem, 8vw, 4rem) clamp(1rem, 5vw, 1.5rem);
}

h1 {
  /* Floor lowered from 1.75rem so the headline stops overflowing under 480px. */
  font-size: clamp(1.375rem, 6vw, 2.5rem);
  letter-spacing: -0.02em;
  margin: 0 0 1rem;
  /* Long product names used to push the line past the viewport. */
  overflow-wrap: anywhere;
  text-wrap: balance;
}

code {
  font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', monospace;
  font-size: 0.9em;
  background: color-mix(in oklab, var(--page-fg) 8%, transparent);
  border-radius: 4px;
  padding: 0.1em 0.35em;
  overflow-wrap: anywhere;
}

.next-steps {
  margin-top: 2rem;
  padding-left: 1.25rem;
}

.next-steps li + li {
  margin-top: 0.5rem;
}

a {
  color: var(--page-accent);
}

:focus-visible {
  outline: 2px solid var(--page-accent);
  outline-offset: 2px;
}
`;

const BUILD_OUTPUT = `> aurora-landing@0.1.0 build
> next build

   ▲ Next.js 16.2.12

   Creating an optimized production build ...
 ✓ Compiled successfully in 4.1s
 ✓ Linting and checking validity of types
 ✓ Collecting page data
 ✓ Generating static pages (2/2)

Route (app)                              Size     First Load JS
┌ ○ /                                    1.42 kB        94.7 kB
└ ○ /_not-found                            976 B        88.3 kB

○  (Static)  prerendered as static content
`;

/* ------------------------------------------------------------------ *
 *  Seed
 * ------------------------------------------------------------------ */

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://karo:karo@localhost:5432/karo';

// `@/lib/db` is server-only, so the script builds its own client the same way
// `migrate.ts` does.
const client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema, casing: 'snake_case' });

async function seedProviders(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const seed of PROVIDER_SEEDS) {
    // Dotenv runs after ESM imports, so the env override is applied here rather
    // than baked into the seed constant.
    const baseUrl =
      seed.key === 'omniakey'
        ? (process.env.OMNIAKEY_BASE_URL ?? seed.baseUrl ?? null)
        : (seed.baseUrl ?? null);
    const catalogUrl =
      seed.key === 'omniakey'
        ? (process.env.OMNIAKEY_MODELS_URL ?? seed.catalogUrl ?? null)
        : (seed.catalogUrl ?? null);

    const [row] = await db
      .insert(schema.providers)
      .values({ ...seed, id: newId(ID_PREFIX.provider), baseUrl, catalogUrl })
      .onConflictDoUpdate({
        target: schema.providers.key,
        set: {
          name: seed.name,
          kind: seed.kind ?? 'model',
          baseUrl,
          catalogUrl,
          isEnabled: seed.isEnabled ?? true,
          isDefault: seed.isDefault ?? false,
          computeMultiplier: seed.computeMultiplier ?? 1,
          metadata: seed.metadata ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.providers.id });
    ids.set(seed.key, required(row, `provider ${seed.key} was not returned`).id);
  }
  return ids;
}

type SeededModel = {
  id: string;
  slug: string;
  displayName: string;
  priceId: string;
  prices: TokenPrices;
  providerKey: string;
};

async function seedModels(providerIds: Map<string, string>): Promise<Map<string, SeededModel>> {
  const seeded = new Map<string, SeededModel>();

  for (const seed of MODEL_SEEDS) {
    const { providerKey, ...columns } = seed;
    const providerId = required(providerIds.get(providerKey), `provider ${providerKey}`);

    const [row] = await db
      .insert(schema.models)
      .values({ ...columns, id: newId(ID_PREFIX.model), providerId })
      .onConflictDoUpdate({
        target: [schema.models.providerId, schema.models.slug],
        set: {
          displayName: columns.displayName,
          family: columns.family ?? 'other',
          description: columns.description ?? '',
          contextWindow: columns.contextWindow ?? 128_000,
          maxOutputTokens: columns.maxOutputTokens ?? 8_192,
          supportsTools: columns.supportsTools ?? true,
          supportsVision: columns.supportsVision ?? false,
          supportsCaching: columns.supportsCaching ?? false,
          supportsStreaming: columns.supportsStreaming ?? true,
          minPlanTier: columns.minPlanTier ?? 'payg',
          isEnabled: columns.isEnabled ?? true,
          isDefault: columns.isDefault ?? false,
          sortOrder: columns.sortOrder ?? 100,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.models.id });

    const modelId = required(row, `model ${seed.slug} was not returned`).id;
    const priceSeed = required(MODEL_PRICE_SEEDS[seed.slug], `price sheet for ${seed.slug}`);
    const prices: TokenPrices = {
      inputMicroUsdPerMtok: priceSeed.inputMicroUsdPerMtok,
      outputMicroUsdPerMtok: priceSeed.outputMicroUsdPerMtok,
      cachedInputMicroUsdPerMtok: priceSeed.cachedInputMicroUsdPerMtok,
      cacheWriteMicroUsdPerMtok: priceSeed.cacheWriteMicroUsdPerMtok,
    };

    const priceId = await upsertCurrentPrice(modelId, priceSeed.source, prices);

    seeded.set(seed.slug, {
      id: modelId,
      slug: seed.slug,
      displayName: seed.displayName,
      priceId,
      prices,
      providerKey,
    });
  }

  await retireModelsMissingFromCatalogue([...providerIds.values()]);

  return seeded;
}

/**
 * Stops offering models that the catalogue no longer lists.
 *
 * The seed is declarative, but `onConflictDoUpdate` only ever touches rows it
 * knows about — so a model that is *removed* from `MODEL_SEEDS` (deprecated
 * upstream, or dropped deliberately) stayed enabled in the database and kept
 * appearing in the model picker. Picking it then fails upstream with
 * `model_not_found`, or silently degrades to the simulator.
 *
 * Rows are disabled, never deleted: `usage_events` and `messages` reference
 * them, and retiring a model must not rewrite billing history.
 */
async function retireModelsMissingFromCatalogue(providerIdList: string[]) {
  if (providerIdList.length === 0) return;

  const retired = await db
    .update(schema.models)
    .set({ isEnabled: false, isDefault: false, updatedAt: new Date() })
    .where(
      and(
        inArray(schema.models.providerId, providerIdList),
        notInArray(
          schema.models.slug,
          MODEL_SEEDS.map((s) => s.slug),
        ),
        eq(schema.models.isEnabled, true),
      ),
    )
    .returning({ slug: schema.models.slug });

  if (retired.length > 0) {
    console.log(`  · retired models   ${retired.map((r) => r.slug).join(', ')}`);
  }
}

/**
 * `model_prices` is append-only. A re-seed with unchanged numbers must not add a
 * row, or every run would rewrite price history for no reason.
 */
async function upsertCurrentPrice(
  modelId: string,
  source: string,
  prices: TokenPrices,
): Promise<string> {
  const [current] = await db
    .select()
    .from(schema.modelPrices)
    .where(and(eq(schema.modelPrices.modelId, modelId), isNull(schema.modelPrices.effectiveTo)))
    .limit(1);

  const unchanged =
    current !== undefined &&
    current.inputMicroUsdPerMtok === prices.inputMicroUsdPerMtok &&
    current.outputMicroUsdPerMtok === prices.outputMicroUsdPerMtok &&
    current.cachedInputMicroUsdPerMtok === prices.cachedInputMicroUsdPerMtok &&
    current.cacheWriteMicroUsdPerMtok === prices.cacheWriteMicroUsdPerMtok;

  if (unchanged) return current.id;

  const now = new Date();
  if (current) {
    await db
      .update(schema.modelPrices)
      .set({ effectiveTo: now })
      .where(eq(schema.modelPrices.id, current.id));
  }

  const [inserted] = await db
    .insert(schema.modelPrices)
    .values({
      id: newId(ID_PREFIX.modelPrice),
      modelId,
      inputMicroUsdPerMtok: prices.inputMicroUsdPerMtok,
      outputMicroUsdPerMtok: prices.outputMicroUsdPerMtok,
      cachedInputMicroUsdPerMtok: prices.cachedInputMicroUsdPerMtok,
      cacheWriteMicroUsdPerMtok: prices.cacheWriteMicroUsdPerMtok,
      source,
      effectiveFrom: now,
    })
    .returning({ id: schema.modelPrices.id });

  return required(inserted, `price row for model ${modelId}`).id;
}

async function seedPlans(): Promise<Map<string, schema.Plan>> {
  const byKey = new Map<string, schema.Plan>();
  for (const seed of PLAN_SEEDS) {
    const [row] = await db
      .insert(schema.plans)
      .values({ ...seed, id: newId(ID_PREFIX.plan) })
      .onConflictDoUpdate({
        target: schema.plans.key,
        set: { ...seed, updatedAt: new Date() },
      })
      .returning();
    byKey.set(seed.key, required(row, `plan ${seed.key} was not returned`));
  }
  return byKey;
}

async function seedSkills(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const seed of SKILL_SEEDS) {
    const [row] = await db
      .insert(schema.skills)
      .values({ ...seed, id: newId(ID_PREFIX.skill) })
      .onConflictDoUpdate({
        target: schema.skills.key,
        // `installCount` is live product data — never reset it from a seed.
        set: {
          name: seed.name,
          description: seed.description ?? '',
          instructions: seed.instructions ?? '',
          version: seed.version ?? '1.0.0',
          author: seed.author ?? 'Karo',
          icon: seed.icon ?? 'sparkles',
          category: seed.category ?? 'general',
          allowedTools: seed.allowedTools ?? [],
          requiredPlugins: seed.requiredPlugins ?? [],
          slashCommands: seed.slashCommands ?? [],
          environmentSchema: seed.environmentSchema ?? [],
          origin: seed.origin ?? 'official',
          isPublic: seed.isPublic ?? true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.skills.id });
    ids.set(seed.key, required(row, `skill ${seed.key} was not returned`).id);
  }
  return ids;
}

async function seedPlugins(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const seed of PLUGIN_SEEDS) {
    const [row] = await db
      .insert(schema.plugins)
      .values({ ...seed, id: newId(ID_PREFIX.plugin) })
      .onConflictDoUpdate({
        target: schema.plugins.key,
        set: {
          name: seed.name,
          description: seed.description ?? '',
          longDescription: seed.longDescription ?? '',
          version: seed.version ?? '1.0.0',
          publisher: seed.publisher ?? 'Karo',
          category: seed.category ?? 'development',
          icon: seed.icon ?? 'package',
          permissions: seed.permissions ?? [],
          configSchema: seed.configSchema ?? [],
          providedTools: seed.providedTools ?? [],
          providedCommands: seed.providedCommands ?? [],
          minPlanTier: seed.minPlanTier ?? 'payg',
          requiresPrivileged: seed.requiresPrivileged ?? false,
          isVerified: seed.isVerified ?? true,
          isActive: seed.isActive ?? true,
          homepageUrl: seed.homepageUrl ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.plugins.id });
    ids.set(seed.key, required(row, `plugin ${seed.key} was not returned`).id);
  }
  return ids;
}

async function seedAdminSettings(): Promise<number> {
  const now = new Date();

  for (const seed of ADMIN_SETTING_SEEDS) {
    await db
      .insert(schema.adminSettings)
      .values({ ...seed })
      .onConflictDoUpdate({
        target: schema.adminSettings.key,
        // Deliberately does NOT touch `value`: an operator who tuned a number in
        // the admin UI must not have it silently reverted by a redeploy seed.
        set: {
          valueType: seed.valueType,
          category: seed.category ?? 'general',
          label: seed.label ?? '',
          description: seed.description ?? '',
          updatedAt: now,
        },
      });
  }

  // The two catalogue payloads are shipped content rather than operator
  // settings, so these two DO overwrite their value on every run.
  const catalogues: Array<{
    key: string;
    value: unknown;
    label: string;
    description: string;
    category: string;
  }> = [
    {
      key: MCP_TEMPLATES_SETTING_KEY,
      value: MCP_TEMPLATE_SEEDS,
      label: 'MCP server templates',
      description:
        'One-click MCP servers offered in the add-server dialog. No template may contain a credential; secrets are declared in `env` and filled in by the user.',
      category: 'catalog',
    },
    {
      key: PROJECT_TEMPLATES_SETTING_KEY,
      value: PROJECT_TEMPLATE_SEEDS,
      label: 'Project starter templates',
      description:
        'Starter scaffolds offered when creating a project. Each one must produce a project that runs on its first command.',
      category: 'catalog',
    },
  ];

  for (const entry of catalogues) {
    await db
      .insert(schema.adminSettings)
      .values({
        key: entry.key,
        value: entry.value,
        valueType: 'json',
        category: entry.category,
        label: entry.label,
        description: entry.description,
      })
      .onConflictDoUpdate({
        target: schema.adminSettings.key,
        set: {
          value: entry.value,
          valueType: 'json',
          category: entry.category,
          label: entry.label,
          description: entry.description,
          updatedAt: now,
        },
      });
  }

  return ADMIN_SETTING_SEEDS.length + catalogues.length;
}

/**
 * Platform incident history.
 *
 * Incidents are platform-wide — they carry no `teamId` — so `resetDemoWorkspace`
 * cannot clear them and this function owns the whole table. It replaces its own
 * rows on every run rather than upserting, because the set is shipped narrative
 * content and an operator has no reason to have edited it by hand. Anything a
 * real operator files through the admin console lives alongside it and is only
 * removed if it collides on id, which generated ids never will.
 *
 * The mix is chosen so `/admin/incidents` has something honest to show: one live
 * degradation, one on watch, and a resolved history long enough that the
 * mean-time-to-resolve figure means something. Every timeline reads like a real
 * postmortem, because a demo of an incident console with a one-line timeline
 * teaches nobody anything.
 */
async function seedIncidents(): Promise<{ open: number; resolved: number }> {
  const now = Date.now();
  const HOUR = 3_600_000;

  /** Detected-at is relative to the run so the list is never stale-looking. */
  function at(daysAgo: number, hoursAgo = 0): Date {
    return new Date(now - daysAgo * DAY_MS - hoursAgo * HOUR);
  }

  type IncidentSeed = {
    title: string;
    description: string;
    status: 'open' | 'investigating' | 'monitoring' | 'resolved';
    severity: 'sev1' | 'sev2' | 'sev3' | 'sev4';
    component: string;
    affectedTeams: number;
    detectedAt: Date;
    resolvedAt: Date | null;
    timeline: Array<{ at: Date; author: string; note: string }>;
  };

  const seeds: IncidentSeed[] = [
    {
      title: 'Sandbox starts are slow in eu-central',
      description:
        'Cold starts in eu-central are taking 18–40s against a 4s norm. Warm sandboxes and already-running commands are unaffected. Traced to image-layer pulls after the base image was republished.',
      status: 'investigating',
      severity: 'sev2',
      component: 'sandbox',
      affectedTeams: 12,
      detectedAt: at(0, 3),
      resolvedAt: null,
      timeline: [
        {
          at: at(0, 3),
          author: 'monitoring',
          note: 'p95 sandbox create in eu-central crossed 15s for 5 consecutive minutes.',
        },
        {
          at: at(0, 2),
          author: 'oncall',
          note: 'Confirmed. Warm starts are normal, so this is pull latency rather than scheduling. Correlates with the karo/sandbox-base:1 republish 4h ago.',
        },
        {
          at: at(0, 1),
          author: 'oncall',
          note: 'Pre-pulling the new layers onto eu-central nodes. No customer action needed; affected starts succeed, they are just slow.',
        },
      ],
    },
    {
      title: 'Elevated 429s from the model provider',
      description:
        'Upstream returned rate-limit responses on roughly 3% of completions for two hours. Karo retried transparently, so runs completed with added latency rather than failing. No usage was charged for the rejected attempts.',
      status: 'monitoring',
      severity: 'sev3',
      component: 'models',
      affectedTeams: 41,
      detectedAt: at(1, 6),
      resolvedAt: null,
      timeline: [
        {
          at: at(1, 6),
          author: 'monitoring',
          note: 'Upstream 429 rate rose from 0.1% to 3.2%.',
        },
        {
          at: at(1, 5),
          author: 'oncall',
          note: 'Retry path is absorbing it — no run failed. Median run latency up 1.4s. Raised with the provider.',
        },
        {
          at: at(1, 2),
          author: 'oncall',
          note: 'Provider raised our per-minute ceiling. Rate back to 0.2%. Holding in monitoring for 24h before closing.',
        },
      ],
    },
    {
      title: 'Terminal sessions dropped on control-plane deploy',
      description:
        'A rolling deploy cycled the node holding the terminal bus, closing 63 attached sessions. Sandboxes and running processes survived; only the browser attachment was lost and reconnected on retry.',
      status: 'resolved',
      severity: 'sev3',
      component: 'terminal',
      affectedTeams: 9,
      detectedAt: at(4, 5),
      resolvedAt: at(4, 4),
      timeline: [
        {
          at: at(4, 5),
          author: 'monitoring',
          note: 'terminal.attach error rate spiked to 100% for 40s during deploy of build 2f9c1ab.',
        },
        {
          at: at(4, 5),
          author: 'oncall',
          note: 'Expected consequence of a single-node terminal bus. Sessions reconnected automatically; no sandbox state was lost.',
        },
        {
          at: at(4, 4),
          author: 'oncall',
          note: 'Resolved. Follow-up filed: drain the terminal bus before cycling a node so reconnects are not user-visible.',
        },
      ],
    },
    {
      title: 'Stripe webhooks queued behind a signature-verification bug',
      description:
        'A clock skew of 6 minutes on one node caused webhook signature verification to reject valid events. Affected subscription and top-up events queued and were replayed once the node was corrected. No payment was taken twice and no balance was lost.',
      status: 'resolved',
      severity: 'sev2',
      component: 'billing',
      affectedTeams: 7,
      detectedAt: at(11, 9),
      resolvedAt: at(11, 6),
      timeline: [
        {
          at: at(11, 9),
          author: 'monitoring',
          note: 'billing.webhook rejection rate above 0 for 10 minutes.',
        },
        {
          at: at(11, 8),
          author: 'oncall',
          note: 'Signature verification failing on node 3 only. NTP drift of 6m14s. Node drained.',
        },
        {
          at: at(11, 7),
          author: 'oncall',
          note: 'Replayed 22 queued events from the Stripe dashboard. Reconciled balances against the ledger — all 7 teams match.',
        },
        {
          at: at(11, 6),
          author: 'oncall',
          note: 'Resolved. NTP monitoring added to the node health check so drift pages before it breaks verification.',
        },
      ],
    },
    {
      title: 'Model catalogue sync disabled a reachable model',
      description:
        'A transient upstream 503 during catalogue sync made one model look unreachable, so it was disabled. Because sync disables rather than deletes, no usage history or conversation was affected, and re-enabling was a single admin action.',
      status: 'resolved',
      severity: 'sev4',
      component: 'models',
      affectedTeams: 3,
      detectedAt: at(19, 2),
      resolvedAt: at(19, 1),
      timeline: [
        {
          at: at(19, 2),
          author: 'support',
          note: 'Three teams reported a model missing from the picker.',
        },
        {
          at: at(19, 2),
          author: 'oncall',
          note: 'Catalogue sync at 04:00 UTC saw a 503 on /models and disabled the entry. Working as designed, but too eager for a single failed poll.',
        },
        {
          at: at(19, 1),
          author: 'oncall',
          note: 'Re-enabled and re-synced. Follow-up: require two consecutive failed polls before disabling a model.',
        },
      ],
    },
    {
      title: 'Usage rollups lagged the event stream',
      description:
        'Period rollups fell up to 90 minutes behind the usage-event table under sustained load. Individual event rows — the billing source of truth — were always correct; only the dashboard aggregate was stale, and no invoice was affected.',
      status: 'resolved',
      severity: 'sev3',
      component: 'api',
      affectedTeams: 28,
      detectedAt: at(26, 7),
      resolvedAt: at(26, 3),
      timeline: [
        {
          at: at(26, 7),
          author: 'monitoring',
          note: 'usage_periods lag alarm fired at 40 minutes behind usage_events.',
        },
        {
          at: at(26, 6),
          author: 'oncall',
          note: 'Rollup contention on the per-team row. Confirmed the event table is complete and correct, so this is a display lag, not a billing error.',
        },
        {
          at: at(26, 3),
          author: 'oncall',
          note: 'Resolved by widening the rollup transaction to batch per team. Lag back under 30s.',
        },
      ],
    },
    {
      title: 'Own-server workers went offline behind a proxy change',
      description:
        'A customer-side proxy began terminating long-polls at 20s, under the 25s Karo holds them open for. Affected workers looked offline between beats. No commands were lost; each was retried on the next successful poll.',
      status: 'resolved',
      severity: 'sev4',
      component: 'worker',
      affectedTeams: 2,
      detectedAt: at(38, 4),
      resolvedAt: at(38, 2),
      timeline: [
        {
          at: at(38, 4),
          author: 'support',
          note: 'Two teams reported their own servers flapping between online and offline.',
        },
        {
          at: at(38, 3),
          author: 'oncall',
          note: 'Heartbeats arriving every 40–60s instead of 20s. Poll connections closing at exactly 20s — an intermediary, not Karo.',
        },
        {
          at: at(38, 2),
          author: 'oncall',
          note: 'Resolved with the customer: proxy idle timeout raised to 60s. Documented the 25s long-poll requirement in the BYOS setup notes.',
        },
      ],
    },
  ];

  await db.delete(schema.incidents);

  await db.insert(schema.incidents).values(
    seeds.map((seed) => ({
      id: newId(ID_PREFIX.incident),
      title: seed.title,
      description: seed.description,
      status: seed.status,
      severity: seed.severity,
      component: seed.component,
      affectedTeams: seed.affectedTeams,
      timeline: seed.timeline.map((entry) => ({
        at: entry.at.toISOString(),
        author: entry.author,
        note: entry.note,
      })),
      detectedAt: seed.detectedAt,
      resolvedAt: seed.resolvedAt,
      createdAt: seed.detectedAt,
      updatedAt:
        seed.resolvedAt ?? seed.timeline[seed.timeline.length - 1]?.at ?? seed.detectedAt,
    })),
  );

  const resolved = seeds.filter((seed) => seed.status === 'resolved').length;
  return { open: seeds.length - resolved, resolved };
}

/**
 * Audit-log backfill.
 *
 * `seedDemoWorkspace` writes five hand-authored entries that belong to the demo
 * story. Those are the interesting ones, but five rows cannot exercise
 * `/admin/audit`, whose page size is 50 and which filters by action, actor type,
 * severity, team and date range. This adds enough ordinary history behind them
 * that paging and every filter do something, across both seeded teams.
 *
 * Two deliberate choices:
 *
 *  · It runs on its own PRNG rather than the module-level `rand`. Drawing from
 *    the shared stream would shift every number after it, and the demo's usage
 *    charts are asserted against by eye — a backfill must not silently redraw
 *    them.
 *  · Summaries are composed from real action vocabulary with real-looking
 *    operands. An audit console filled with "Event 37" demonstrates nothing;
 *    the whole point of the page is that a reader can reconstruct what happened.
 */
/** Stamped into `metadata.seed` so the backfill can replace exactly its own rows. */
const BACKFILL_MARKER = 'audit-backfill';

async function seedAuditBackfill(
  actors: ReadonlyArray<{ teamId: string; userId: string; ip: string }>,
  spanDays: number,
): Promise<number> {
  const auditRand = mulberry32(0x41554449); // "AUDI"
  const draw = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(auditRand() * items.length)];
    if (item === undefined) throw new Error('draw() called with an empty array');
    return item;
  };

  type Shape = {
    action: string;
    resourceType: string;
    severity: 'info' | 'notice' | 'warning' | 'critical';
    actorType: 'user' | 'system' | 'agent';
    summaries: readonly string[];
    /** Rough relative frequency — logins happen far more often than deletions. */
    weight: number;
  };

  const shapes: readonly Shape[] = [
    {
      action: 'auth.login',
      resourceType: 'user',
      severity: 'info',
      actorType: 'user',
      weight: 10,
      summaries: [
        'Signed in with a password from a recognised device.',
        'Signed in with a password from a new device.',
        'Session resumed from a valid cookie after a browser restart.',
      ],
    },
    {
      action: 'auth.logout',
      resourceType: 'user',
      severity: 'info',
      actorType: 'user',
      weight: 4,
      summaries: ['Signed out and the session cookie was revoked.'],
    },
    {
      action: 'sandbox.start',
      resourceType: 'sandbox',
      severity: 'info',
      actorType: 'user',
      weight: 8,
      summaries: [
        'Woke sandbox aurora-landing from sleep in 4.1s.',
        'Woke sandbox aurora-landing from sleep in 3.6s.',
        'Started sandbox aurora-landing after a manual stop.',
      ],
    },
    {
      action: 'sandbox.stop',
      resourceType: 'sandbox',
      severity: 'info',
      actorType: 'system',
      weight: 7,
      summaries: [
        'Sandbox aurora-landing slept after 20 idle minutes.',
        'Sandbox aurora-landing stopped on request; compute billing ended.',
      ],
    },
    {
      action: 'sandbox.command',
      resourceType: 'sandbox',
      severity: 'info',
      actorType: 'agent',
      weight: 12,
      summaries: [
        'Ran `npm run build` — exit 0 in 24.8s.',
        'Ran `npm run lint` — exit 0 in 6.2s.',
        'Ran `npm test` — exit 0, 41 passed.',
        'Ran `git status --porcelain` — exit 0.',
        'Ran `npm run build` — exit 1, 2 type errors.',
      ],
    },
    {
      action: 'project.update',
      resourceType: 'project',
      severity: 'info',
      actorType: 'user',
      weight: 5,
      summaries: [
        'Changed the default agent mode to build.',
        'Changed the default model for new conversations.',
        'Updated the project description.',
        'Set the default shell to bash.',
      ],
    },
    {
      action: 'apikey.create',
      resourceType: 'api_key',
      severity: 'notice',
      actorType: 'user',
      weight: 2,
      summaries: [
        'Created API key "CI pipeline" with read-only scopes.',
        'Created API key "Local scripts" with project write scope.',
      ],
    },
    {
      action: 'apikey.delete',
      resourceType: 'api_key',
      severity: 'notice',
      actorType: 'user',
      weight: 1,
      summaries: ['Revoked API key "CI pipeline"; it stopped working immediately.'],
    },
    {
      action: 'mcp.connect',
      resourceType: 'mcp_server',
      severity: 'info',
      actorType: 'system',
      weight: 6,
      summaries: [
        'Connected to the filesystem MCP server and discovered 11 tools.',
        'Connected to the GitHub MCP server and discovered 24 tools.',
        'Reconnected to the filesystem MCP server after an idle timeout.',
      ],
    },
    {
      action: 'mcp.update',
      resourceType: 'mcp_server',
      severity: 'notice',
      actorType: 'user',
      weight: 2,
      summaries: [
        'Disabled 3 tools on the GitHub MCP server.',
        'Changed the filesystem MCP server root to /workspace/src.',
      ],
    },
    {
      action: 'skill.install',
      resourceType: 'skill',
      severity: 'notice',
      actorType: 'user',
      weight: 3,
      summaries: [
        'Installed the "Ship a landing page" skill.',
        'Installed the "Write a Telegram bot" skill.',
        'Installed the "Review a pull request" skill.',
      ],
    },
    {
      action: 'skill.uninstall',
      resourceType: 'skill',
      severity: 'notice',
      actorType: 'user',
      weight: 1,
      summaries: ['Uninstalled the "Review a pull request" skill.'],
    },
    {
      action: 'plugin.configure',
      resourceType: 'plugin',
      severity: 'notice',
      actorType: 'user',
      weight: 2,
      summaries: [
        'Narrowed the GitHub plugin to a single repository.',
        'Rotated the credential stored for the GitHub plugin.',
      ],
    },
    {
      action: 'billing.topup',
      resourceType: 'team',
      severity: 'notice',
      actorType: 'user',
      weight: 2,
      summaries: [
        'Topped up the prepaid balance by $25.00.',
        'Topped up the prepaid balance by $50.00.',
      ],
    },
    {
      action: 'billing.webhook',
      resourceType: 'team',
      severity: 'info',
      actorType: 'system',
      weight: 3,
      summaries: [
        'Processed invoice.paid for the monthly subscription.',
        'Processed customer.subscription.updated with no plan change.',
      ],
    },
    {
      action: 'quota.exceeded',
      resourceType: 'team',
      severity: 'warning',
      actorType: 'system',
      weight: 2,
      summaries: [
        'Team passed its monthly weighted-token allowance; overage now bills from the balance.',
        'Team passed 90% of its included compute hours.',
      ],
    },
    {
      action: 'worker.heartbeat',
      resourceType: 'worker',
      severity: 'info',
      actorType: 'system',
      weight: 4,
      summaries: [
        'Own server "workshop-tower" resumed heartbeating after 2 missed beats.',
        'Own server "workshop-tower" reported 8 cores, 32 GB, 412 GB free.',
      ],
    },
    {
      action: 'team.update',
      resourceType: 'team',
      severity: 'notice',
      actorType: 'user',
      weight: 2,
      summaries: [
        'Lowered the monthly spend cap to $100.00.',
        'Set the usage alert threshold to 80%.',
      ],
    },
  ];

  /** Expanded so `draw` picks proportionally to weight. */
  const pool = shapes.flatMap((shape) => Array.from({ length: shape.weight }, () => shape));

  const now = Date.now();
  const rows: Array<typeof schema.auditEvents.$inferInsert> = [];

  for (const actor of actors) {
    // Enough per team that the 50-row page size is exceeded across the pair and
    // every filter has more than one row behind it.
    const count = 44;
    for (let i = 0; i < count; i += 1) {
      const shape = draw(pool);
      // Spread across the span, denser towards the present, and never in the
      // future — an audit row timestamped ahead of "now" reads as a bug.
      const skew = auditRand() ** 1.6;
      const offsetMs = skew * spanDays * DAY_MS;
      const createdAt = new Date(now - offsetMs - 60_000);

      rows.push({
        id: newId(ID_PREFIX.auditEvent),
        teamId: actor.teamId,
        userId: shape.actorType === 'user' ? actor.userId : null,
        actorType: shape.actorType,
        action: shape.action,
        resourceType: shape.resourceType,
        resourceId: actor.teamId,
        severity: shape.severity,
        summary: draw(shape.summaries),
        // The marker is what makes this function idempotent — see the delete
        // below. It also lets a reader of the table tell generated history from
        // the hand-authored demo entries and from anything a real operator did.
        metadata: { seed: BACKFILL_MARKER },
        ipAddress: shape.actorType === 'user' ? actor.ip : null,
        createdAt,
      });
    }
  }

  // Only this function's own rows. `resetDemoWorkspace` clears the demo team's
  // audit trail but nothing clears the admin team's, so without this the
  // backfill would stack up another set on every run — and the file promises at
  // the top that seeding is repeatable. Deleting by marker also leaves the five
  // hand-authored demo entries written moments ago untouched.
  await db
    .delete(schema.auditEvents)
    .where(raw`${schema.auditEvents.metadata}->>'seed' = ${BACKFILL_MARKER}`);

  await db.insert(schema.auditEvents).values(rows);
  return rows.length;
}

/* ------------------------------------------------------------------ *
 *  Accounts
 * ------------------------------------------------------------------ */

async function upsertUser(values: {
  email: string;
  name: string;
  passwordHash: string;
  platformRole: 'user' | 'admin';
  isDemo: boolean;
}): Promise<schema.User> {
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(raw`lower(${schema.users.email}) = lower(${values.email})`)
    .limit(1);

  const now = new Date();
  if (existing) {
    const [updated] = await db
      .update(schema.users)
      .set({
        name: values.name,
        passwordHash: values.passwordHash,
        platformRole: values.platformRole,
        isDemo: values.isDemo,
        emailVerifiedAt: existing.emailVerifiedAt ?? now,
        isSuspended: false,
        updatedAt: now,
      })
      .where(eq(schema.users.id, existing.id))
      .returning();
    return required(updated, `updated user ${values.email}`);
  }

  const [created] = await db
    .insert(schema.users)
    .values({
      id: newId(ID_PREFIX.user),
      email: values.email,
      name: values.name,
      passwordHash: values.passwordHash,
      platformRole: values.platformRole,
      isDemo: values.isDemo,
      emailVerifiedAt: now,
      theme: 'dark',
      locale: 'en',
      onboardingCompletedAt: now,
      onboardingState: { tour: 'completed', source: 'seed' },
      lastSeenAt: now,
    })
    .returning();
  return required(created, `created user ${values.email}`);
}

async function upsertPersonalTeam(
  owner: schema.User,
  values: { name: string; slug: string; avatarColor: string },
): Promise<schema.Team> {
  const [existing] = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.slug, values.slug))
    .limit(1);

  const now = new Date();
  const team = existing
    ? required(
        (
          await db
            .update(schema.teams)
            .set({
              name: values.name,
              ownerId: owner.id,
              avatarColor: values.avatarColor,
              updatedAt: now,
            })
            .where(eq(schema.teams.id, existing.id))
            .returning()
        )[0],
        `updated team ${values.slug}`,
      )
    : required(
        (
          await db
            .insert(schema.teams)
            .values({
              id: newId(ID_PREFIX.team),
              name: values.name,
              slug: values.slug,
              ownerId: owner.id,
              isPersonal: true,
              avatarColor: values.avatarColor,
              usageAlertThreshold: 0.8,
            })
            .returning()
        )[0],
        `created team ${values.slug}`,
      );

  await db
    .insert(schema.teamMembers)
    .values({
      id: newId(ID_PREFIX.teamMember),
      teamId: team.id,
      userId: owner.id,
      role: 'owner',
    })
    .onConflictDoUpdate({
      target: [schema.teamMembers.teamId, schema.teamMembers.userId],
      set: { role: 'owner' },
    });

  if (owner.defaultTeamId !== team.id) {
    await db
      .update(schema.users)
      .set({ defaultTeamId: team.id, updatedAt: now })
      .where(eq(schema.users.id, owner.id));
  }

  return team;
}

async function upsertSubscription(
  teamId: string,
  plan: schema.Plan,
  period: { start: Date; end: Date },
): Promise<void> {
  const quotaSnapshot: Record<string, number | boolean | string> = {
    planKey: plan.key,
    tier: plan.tier,
    includedWeightedTokens: plan.includedWeightedTokens,
    includedComputeHours: plan.includedComputeHours,
    maxActiveSandboxes: plan.maxActiveSandboxes,
    maxSandboxMemoryMb: plan.maxSandboxMemoryMb,
    maxSandboxCpuCores: plan.maxSandboxCpuCores,
    storageGb: plan.storageGb,
    maxTeamMembers: plan.maxTeamMembers,
    maxConcurrentRuns: plan.maxConcurrentRuns,
    allowDocker: plan.allowDocker,
    allowByok: plan.allowByok,
  };

  await db
    .insert(schema.subscriptions)
    .values({
      id: newId(ID_PREFIX.subscription),
      teamId,
      planId: plan.id,
      status: 'active',
      interval: 'month',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      quotaSnapshot,
    })
    .onConflictDoUpdate({
      target: schema.subscriptions.teamId,
      set: {
        planId: plan.id,
        status: 'active',
        interval: 'month',
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        quotaSnapshot,
        updatedAt: new Date(),
      },
    });
}

async function upsertBalance(
  teamId: string,
  values: {
    balanceMicroUsd: number;
    toppedUpMicroUsd: number;
    spentMicroUsd: number;
    creditLimitMicroUsd: number;
  },
): Promise<void> {
  await db
    .insert(schema.paygBalances)
    .values({
      id: newId(ID_PREFIX.paygBalance),
      teamId,
      balanceMicroUsd: values.balanceMicroUsd,
      lifetimeToppedUpMicroUsd: values.toppedUpMicroUsd,
      lifetimeSpentMicroUsd: values.spentMicroUsd,
      creditLimitMicroUsd: values.creditLimitMicroUsd,
    })
    .onConflictDoUpdate({
      target: schema.paygBalances.teamId,
      set: {
        balanceMicroUsd: values.balanceMicroUsd,
        lifetimeToppedUpMicroUsd: values.toppedUpMicroUsd,
        lifetimeSpentMicroUsd: values.spentMicroUsd,
        creditLimitMicroUsd: values.creditLimitMicroUsd,
        updatedAt: new Date(),
      },
    });
}

/* ------------------------------------------------------------------ *
 *  Demo workspace
 * ------------------------------------------------------------------ */

/**
 * Wipes everything the demo account generated so a re-seed produces the same
 * numbers instead of a second month of usage stacked on the first. Scoped to
 * the demo team only — it never touches another tenant.
 */
async function resetDemoWorkspace(teamId: string, userId: string): Promise<void> {
  await db.delete(schema.usageEvents).where(eq(schema.usageEvents.teamId, teamId));
  await db.delete(schema.computeEvents).where(eq(schema.computeEvents.teamId, teamId));
  await db.delete(schema.usagePeriods).where(eq(schema.usagePeriods.teamId, teamId));
  // Budget held by runs that were in flight when the demo was reset. Leaving
  // these would count against a cap whose usage rows have just been deleted.
  await db.delete(schema.usageReservations).where(eq(schema.usageReservations.teamId, teamId));
  await db.delete(schema.notifications).where(eq(schema.notifications.userId, userId));
  await db.delete(schema.auditEvents).where(eq(schema.auditEvents.teamId, teamId));
  await db.delete(schema.installedSkills).where(eq(schema.installedSkills.teamId, teamId));
  await db.delete(schema.installedPlugins).where(eq(schema.installedPlugins.teamId, teamId));
  await db.delete(schema.customCommands).where(eq(schema.customCommands.teamId, teamId));
  await db.delete(schema.mcpServers).where(eq(schema.mcpServers.teamId, teamId));
  await db.delete(schema.invoices).where(eq(schema.invoices.teamId, teamId));
  await db.delete(schema.topups).where(eq(schema.topups.teamId, teamId));
  // Sandboxes, conversations, messages, runs and tool calls all cascade off
  // projects, so this last delete removes the bulk of the workspace.
  await db.delete(schema.sandboxes).where(eq(schema.sandboxes.teamId, teamId));
  await db.delete(schema.projects).where(eq(schema.projects.teamId, teamId));
}

type ModelUsageDraft = {
  occurredAt: Date;
  model: SeededModel;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  /** Set for the three assistant messages in the seeded conversation. */
  messageId?: string;
  conversationId?: string;
  runId?: string;
};

type SettledUsage = ModelUsageDraft & {
  weightedTokens: number;
  upstreamCostMicroUsd: number;
  chargedMicroUsd: number;
  grossMarginMicroUsd: number;
  settlement: string;
  outputMultiplier: number;
};

function planPricingConfig(plan: schema.Plan): PlanPricingConfig {
  return {
    tier: plan.tier,
    marginBps: plan.marginBps,
    includedWeightedTokens: plan.includedWeightedTokens,
    includedComputeHours: plan.includedComputeHours,
    overageMicroUsdPerMWeighted: plan.overageMicroUsdPerMWeighted,
    overageMicroUsdPerComputeHour: plan.overageMicroUsdPerComputeHour,
  };
}

async function seedDemoWorkspace(options: {
  user: schema.User;
  team: schema.Team;
  plan: schema.Plan;
  models: Map<string, SeededModel>;
  skillIds: Map<string, string>;
  pluginIds: Map<string, string>;
  period: { start: Date; end: Date };
}): Promise<{
  weightedTokensUsed: number;
  computeHoursUsed: number;
  modelChargedMicroUsd: number;
  computeChargedMicroUsd: number;
  usageEventCount: number;
  computeEventCount: number;
}> {
  const { user, team, plan, models, skillIds, pluginIds, period } = options;
  const now = new Date();
  const pricing = planPricingConfig(plan);

  const opus = required(models.get('claude-opus-5'), 'model claude-opus-5');
  const sonnet = required(models.get(DEFAULT_MODEL_SLUG), `model ${DEFAULT_MODEL_SLUG}`);
  const haiku = required(models.get('claude-haiku-4.5'), 'model claude-haiku-4.5');

  /* ---- Project seeded from the Next.js template ---- */
  const template = required(findProjectTemplate('nextjs-website'), 'nextjs-website template');
  const projectId = newId(ID_PREFIX.project);

  await db.insert(schema.projects).values({
    id: projectId,
    teamId: team.id,
    createdById: user.id,
    name: 'Aurora Landing',
    slug: 'aurora-landing',
    description:
      'Marketing site for Aurora, a sleep-tracking app. Scaffolded from the Next.js template and iterated on in chat.',
    template: template.key,
    runtimeTarget: 'karo_cloud',
    defaultModelId: sonnet.id,
    defaultAgentMode: 'build',
    defaultShell: 'bash',
    permissions: {
      readFiles: true,
      writeFiles: true,
      deleteFiles: false,
      runCommands: true,
      installPackages: true,
      networkAccess: true,
      gitCommit: true,
      gitPush: false,
      dockerAccess: false,
      useMcpTools: true,
      startServices: true,
      autoApproveEdits: false,
      autoApproveCommands: true,
    },
    gitBranch: 'main',
    envVars: { NEXT_TELEMETRY_DISABLED: '1' },
    lastOpenedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    createdAt: period.start,
    updatedAt: new Date(now.getTime() - 2 * DAY_MS),
  });

  const projectFiles = template.files.map((file) => {
    // The seeded conversation ends with a write_file to this path, so the file
    // on disk has to be the post-fix version.
    const content = file.path === 'app/globals.css' ? AURORA_GLOBALS_CSS : file.content;
    return {
      id: newId(ID_PREFIX.projectFile),
      projectId,
      path: file.path,
      content,
      isDirectory: false,
      isBinary: false,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      contentHash: sha256(content),
      language: languageFor(file.path),
      version: file.path === 'app/globals.css' ? 2 : 1,
      createdAt: period.start,
      updatedAt:
        file.path === 'app/globals.css' ? new Date(now.getTime() - 2 * DAY_MS) : period.start,
    };
  });
  await db.insert(schema.projectFiles).values(projectFiles);

  /* ---- Sleeping mock sandbox ---- */
  const shape = { cpuCores: 0.5, memoryMb: 1024, diskGb: 20 };
  const multiplier = calculateComputeMultiplier({ ...shape, providerMultiplier: 1 }).value;
  const sandboxId = newId(ID_PREFIX.sandbox);
  const sleptAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  await db.insert(schema.sandboxes).values({
    id: sandboxId,
    teamId: team.id,
    projectId,
    createdById: user.id,
    name: 'aurora-landing',
    provider: 'mock',
    externalId: 'mock-aurora-01',
    status: 'sleeping',
    statusMessage:
      'Asleep after 20 idle minutes. It will wake on your next command in about 4s.',
    image: 'karo/sandbox-base:1',
    region: 'eu-central',
    cpuCores: shape.cpuCores,
    memoryMb: shape.memoryMb,
    diskGb: shape.diskGb,
    computeMultiplier: multiplier,
    cpuPercent: 0,
    memoryUsedMb: 0,
    diskUsedMb: 412,
    processCount: 0,
    autoSleepMinutes: plan.autoSleepMinutes,
    autoDestroyHours: plan.autoDestroyHours,
    networkPolicy: 'restricted',
    allowDocker: false,
    totalActiveSeconds: 0, // replaced below once the compute events are known
    lastActiveAt: sleptAt,
    startedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    stoppedAt: sleptAt,
    metadata: { baseImage: 'karo/sandbox-base:1', node: '22.14.0', wakeSeconds: 4 },
    createdAt: period.start,
    updatedAt: sleptAt,
  });

  /* ---- Conversation ------------------------------------------------- *
   * Six messages: a request, a plan with a run_command, the command result,
   * an edit with a write_file, the write result, and a closing summary.
   * ------------------------------------------------------------------- */
  const conversationId = newId(ID_PREFIX.conversation);
  const runId = newId(ID_PREFIX.agentRun);
  const messageIds = Array.from({ length: 6 }, () => newId(ID_PREFIX.message));
  const chatStart = new Date(now.getTime() - 2 * DAY_MS - 40 * 60 * 1000);

  const assistantTurns = [
    {
      messageId: required(messageIds[1], 'assistant message 1'),
      model: sonnet,
      inputTokens: 8_420,
      cachedInputTokens: 2_100,
      cacheWriteTokens: 6_320,
      outputTokens: 612,
      latencyMs: 6_180,
      timeToFirstTokenMs: 780,
      occurredAt: new Date(chatStart.getTime() + 40_000),
    },
    {
      messageId: required(messageIds[3], 'assistant message 2'),
      model: sonnet,
      inputTokens: 14_980,
      cachedInputTokens: 8_400,
      cacheWriteTokens: 0,
      outputTokens: 1_340,
      latencyMs: 11_460,
      timeToFirstTokenMs: 910,
      occurredAt: new Date(chatStart.getTime() + 4 * 60_000),
    },
    {
      messageId: required(messageIds[5], 'assistant message 3'),
      model: sonnet,
      inputTokens: 19_260,
      cachedInputTokens: 14_000,
      cacheWriteTokens: 0,
      outputTokens: 384,
      latencyMs: 3_940,
      timeToFirstTokenMs: 640,
      occurredAt: new Date(chatStart.getTime() + 6 * 60_000),
    },
  ];

  /* ---- Build the full 30-day usage timeline -------------------------- */
  const drafts: ModelUsageDraft[] = [];

  const modelMix: SeededModel[] = [sonnet, sonnet, sonnet, opus, haiku, haiku];

  for (let day = 0; day < 30; day += 1) {
    const dayStart = new Date(period.start.getTime() + day * DAY_MS);
    // Weekends are quieter — a flat line looks synthetic on the usage chart.
    const weekday = dayStart.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    // Sized to land the demo team around two thirds of the Pro allowance:
    // enough history for the charts to be interesting, with headroom left so
    // the first thing a new visitor does is not hit "monthly allowance spent".
    const events = isWeekend ? randInt(0, 2) : randInt(3, 7);

    for (let i = 0; i < events; i += 1) {
      const model = pick(modelMix);
      const inputTokens = randInt(5_000, 24_000);
      drafts.push({
        occurredAt: new Date(
          dayStart.getTime() + randInt(8, 21) * 3_600_000 + randInt(0, 3_599) * 1000,
        ),
        model,
        inputTokens,
        cachedInputTokens: Math.round(inputTokens * (0.2 + rand() * 0.5)),
        cacheWriteTokens: rand() < 0.25 ? Math.round(inputTokens * 0.4) : 0,
        outputTokens: randInt(300, 5_600),
        latencyMs: randInt(1_400, 18_000),
      });
    }
  }

  for (const turn of assistantTurns) {
    drafts.push({
      occurredAt: turn.occurredAt,
      model: turn.model,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      cachedInputTokens: turn.cachedInputTokens,
      cacheWriteTokens: turn.cacheWriteTokens,
      latencyMs: turn.latencyMs,
      messageId: turn.messageId,
      conversationId,
      runId,
    });
  }

  drafts.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  let quotaRemaining = plan.includedWeightedTokens;
  const settled: SettledUsage[] = [];

  for (const draft of drafts) {
    const counts = {
      inputTokens: draft.inputTokens,
      outputTokens: draft.outputTokens,
      cachedInputTokens: draft.cachedInputTokens,
      cacheWriteTokens: draft.cacheWriteTokens,
    };
    const weights = calculateWeightedTokens(counts, draft.model.prices);
    const settlement = settleModelUsage({
      counts,
      prices: draft.model.prices,
      plan: pricing,
      quotaRemainingWeighted: quotaRemaining,
      hasActiveSubscription: true,
    });
    quotaRemaining = Math.max(0, quotaRemaining - settlement.quotaConsumed);

    settled.push({
      ...draft,
      weightedTokens: settlement.weightedTokens,
      upstreamCostMicroUsd: settlement.upstreamCostMicroUsd,
      chargedMicroUsd: settlement.chargedMicroUsd,
      grossMarginMicroUsd: settlement.grossMarginMicroUsd,
      settlement: settlement.settlement,
      outputMultiplier: weights.multipliers.output,
    });
  }

  const bySettledMessage = new Map<string, SettledUsage>();
  for (const entry of settled) {
    if (entry.messageId) bySettledMessage.set(entry.messageId, entry);
  }

  const totalWeighted = settled.reduce((sum, s) => sum + s.weightedTokens, 0);
  const totalModelCharged = settled.reduce((sum, s) => sum + s.chargedMicroUsd, 0);
  const totalModelUpstream = settled.reduce((sum, s) => sum + s.upstreamCostMicroUsd, 0);

  /* ---- Conversation rows ---- */
  const conversationTotals = assistantTurns.reduce(
    (acc, turn) => {
      const s = required(bySettledMessage.get(turn.messageId), 'settled assistant turn');
      return {
        input: acc.input + turn.inputTokens,
        output: acc.output + turn.outputTokens,
        weighted: acc.weighted + s.weightedTokens,
        charged: acc.charged + s.chargedMicroUsd,
      };
    },
    { input: 0, output: 0, weighted: 0, charged: 0 },
  );

  const lastAssistant = required(assistantTurns[2], 'closing assistant turn');

  await db.insert(schema.conversations).values({
    id: conversationId,
    projectId,
    userId: user.id,
    title: 'Hero overflows below 480px',
    modelId: sonnet.id,
    agentMode: 'build',
    messageCount: 6,
    totalInputTokens: conversationTotals.input,
    totalOutputTokens: conversationTotals.output,
    totalWeightedTokens: conversationTotals.weighted,
    totalChargedMicroUsd: conversationTotals.charged,
    isPinned: true,
    lastMessageAt: lastAssistant.occurredAt,
    createdAt: chatStart,
    updatedAt: lastAssistant.occurredAt,
  });

  await db.insert(schema.agentRuns).values({
    id: runId,
    conversationId,
    projectId,
    teamId: team.id,
    userId: user.id,
    sandboxId,
    modelId: sonnet.id,
    mode: 'build',
    status: 'succeeded',
    title: 'Fix hero overflow below 480px',
    steps: [
      {
        id: 'step_1',
        title: 'Reproduce the overflow at 375px',
        status: 'done',
        detail: 'Confirmed in app/globals.css: the h1 clamp floor is 1.75rem.',
      },
      {
        id: 'step_2',
        title: 'Verify the build is green before changing anything',
        status: 'done',
        detail: 'npm run build succeeded in 4.1s.',
      },
      {
        id: 'step_3',
        title: 'Lower the headline clamp floor and allow wrapping',
        status: 'done',
        detail: 'app/globals.css updated.',
      },
      {
        id: 'step_4',
        title: 'Make page padding fluid',
        status: 'done',
        detail: 'Replaced the flat 1.5rem with clamp().',
      },
      {
        id: 'step_5',
        title: 'Rebuild and confirm',
        status: 'done',
        detail: 'Build green, 1.42 kB route payload unchanged.',
      },
    ],
    stopReason: 'end_turn',
    iterations: 3,
    maxIterations: 24,
    totalInputTokens: conversationTotals.input,
    totalOutputTokens: conversationTotals.output,
    totalWeightedTokens: conversationTotals.weighted,
    totalChargedMicroUsd: conversationTotals.charged,
    usedByok: false,
    startedAt: chatStart,
    finishedAt: lastAssistant.occurredAt,
    createdAt: chatStart,
    updatedAt: lastAssistant.occurredAt,
  });

  const messageRows: Array<typeof schema.messages.$inferInsert> = [];

  const pushAssistant = (
    index: number,
    turnIndex: number,
    content: string,
    thinking: string | null,
  ) => {
    const turn = required(assistantTurns[turnIndex], `assistant turn ${turnIndex}`);
    const s = required(bySettledMessage.get(turn.messageId), 'settled assistant turn');
    messageRows.push({
      id: turn.messageId,
      conversationId,
      runId,
      role: 'assistant',
      content,
      thinking,
      status: 'complete',
      modelId: turn.model.id,
      agentMode: 'build',
      sequence: index,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      cachedInputTokens: turn.cachedInputTokens,
      weightedTokens: s.weightedTokens,
      upstreamCostMicroUsd: s.upstreamCostMicroUsd,
      chargedMicroUsd: s.chargedMicroUsd,
      latencyMs: turn.latencyMs,
      timeToFirstTokenMs: turn.timeToFirstTokenMs,
      finishReason: 'end_turn',
      metadata: { settlement: s.settlement, cacheWriteTokens: turn.cacheWriteTokens },
      createdAt: turn.occurredAt,
      updatedAt: turn.occurredAt,
    });
  };

  messageRows.push({
    id: required(messageIds[0], 'user message'),
    conversationId,
    role: 'user',
    content:
      'The hero on Aurora Landing breaks on my phone. At 375px the headline runs past the right edge and the button ends up below the fold. Desktop is fine. Can you fix it without redesigning the page?',
    status: 'complete',
    sequence: 0,
    createdAt: chatStart,
    updatedAt: chatStart,
  });

  pushAssistant(
    1,
    0,
    `Reproduced it — this is a CSS problem, not a layout one, so the fix is contained.

In \`app/globals.css\` the headline is \`clamp(1.75rem, 4vw, 2.5rem)\`. At 375px, \`4vw\` is 15px, so the clamp floor of 1.75rem (28px) wins and the headline renders at 28px inside a container that only has 375 − 48 = 327px of usable width. "Sleep tracking that respects your evenings" cannot wrap inside that, so it overflows.

The page padding is a flat \`1.5rem\` on each side, which is a third of the viewport on a small phone and pushes the CTA down.

Plan:
1. Lower the clamp floor and raise the viewport coefficient so small screens actually scale.
2. Add \`overflow-wrap: anywhere\` so a long product name can never overflow again.
3. Make the page padding fluid instead of fixed.

Let me confirm the build is green first, so if anything breaks afterwards I know it was me.`,
    `The h1 uses clamp(1.75rem, 4vw, 2.5rem). At 375px viewport, 4vw = 15px, well under the 28px floor — so the floor is what renders. Container width is 375 - (2 x 24) = 327px. A 28px headline of that length needs roughly 480px. That is the overflow.

Fixing the clamp alone is not enough: a single long unbroken word would still overflow, so overflow-wrap belongs in the same change. Padding is the secondary issue and is a one-line fix.

Take a baseline build before editing so a later failure is attributable.`,
  );

  messageRows.push({
    id: required(messageIds[2], 'tool message 1'),
    conversationId,
    runId,
    role: 'tool',
    content: BUILD_OUTPUT,
    status: 'complete',
    sequence: 2,
    metadata: { toolName: 'run_command', exitCode: 0 },
    createdAt: new Date(chatStart.getTime() + 3 * 60_000),
    updatedAt: new Date(chatStart.getTime() + 3 * 60_000),
  });

  pushAssistant(
    3,
    1,
    `Baseline is green, so I have applied the fix to \`app/globals.css\`:

- **Headline:** \`clamp(1.75rem, 4vw, 2.5rem)\` → \`clamp(1.375rem, 6vw, 2.5rem)\`. At 375px this now renders at 22.5px instead of 28px and fits on two lines; above 640px the old sizing is unchanged, so the desktop layout does not move.
- **Wrapping:** added \`overflow-wrap: anywhere\` and \`text-wrap: balance\` to the headline, and \`overflow-wrap: anywhere\` to inline \`code\`, which had the same latent problem.
- **Padding:** \`4rem 1.5rem\` → \`clamp(2rem, 8vw, 4rem) clamp(1rem, 5vw, 1.5rem)\`. That gives the hero another 16px of width on a 375px screen and pulls the CTA back above the fold.

I did not touch \`app/page.tsx\` — the markup was fine, only the type scale was wrong.`,
    null,
  );

  messageRows.push({
    id: required(messageIds[4], 'tool message 2'),
    conversationId,
    runId,
    role: 'tool',
    content:
      'Wrote app/globals.css — 1 file changed, 9 insertions(+), 3 deletions(-).\nSyntax check passed. Preview reloaded in 240ms.',
    status: 'complete',
    sequence: 4,
    metadata: { toolName: 'write_file', path: 'app/globals.css', additions: 9, deletions: 3 },
    createdAt: new Date(chatStart.getTime() + 5 * 60_000),
    updatedAt: new Date(chatStart.getTime() + 5 * 60_000),
  });

  pushAssistant(
    5,
    2,
    `Done. The hero fits at 375px, the CTA is back above the fold, and the production build is still green with an unchanged 1.42 kB route payload.

One file changed: \`app/globals.css\` — three declarations edited, nothing added to the markup and no new dependency.

Two things I deliberately left alone: the desktop type scale above 640px, which was already correct, and the nav, which has a similar fixed-padding pattern but does not currently overflow. Say the word if you want the nav made fluid at the same time.`,
    null,
  );

  await db.insert(schema.messages).values(messageRows);

  await db.insert(schema.toolCalls).values([
    {
      id: newId(ID_PREFIX.toolCall),
      runId,
      messageId: required(messageIds[1], 'assistant message 1'),
      externalCallId: 'call_ax91ke',
      toolName: 'run_command',
      source: 'builtin',
      args: { command: 'npm run build', cwd: '/workspace', shell: 'bash', timeoutSeconds: 300 },
      result: BUILD_OUTPUT,
      resultSummary: 'Build succeeded in 4.1s — 2 static routes, 94.7 kB first load.',
      status: 'succeeded',
      requiresApproval: false,
      isError: false,
      exitCode: 0,
      durationMs: 4_320,
      sequence: 0,
      createdAt: new Date(chatStart.getTime() + 2 * 60_000),
      updatedAt: new Date(chatStart.getTime() + 3 * 60_000),
    },
    {
      id: newId(ID_PREFIX.toolCall),
      runId,
      messageId: required(messageIds[3], 'assistant message 2'),
      externalCallId: 'call_bq47md',
      toolName: 'write_file',
      source: 'builtin',
      args: {
        path: 'app/globals.css',
        encoding: 'utf8',
        bytes: Buffer.byteLength(AURORA_GLOBALS_CSS, 'utf8'),
      },
      result: 'app/globals.css written (9 insertions, 3 deletions).',
      resultSummary:
        'Updated app/globals.css — fluid padding and a lower headline clamp floor.',
      status: 'succeeded',
      requiresApproval: true,
      approvedById: user.id,
      approvedAt: new Date(chatStart.getTime() + 4 * 60_000 + 25_000),
      isError: false,
      durationMs: 118,
      sequence: 1,
      createdAt: new Date(chatStart.getTime() + 4 * 60_000),
      updatedAt: new Date(chatStart.getTime() + 5 * 60_000),
    },
  ]);

  /* ---- Usage events ---- */
  await db.insert(schema.usageEvents).values(
    settled.map((s) => ({
      id: newId(ID_PREFIX.usageEvent),
      teamId: team.id,
      userId: user.id,
      projectId,
      // Background usage is not attributable to the one seeded conversation;
      // pretending otherwise would make that conversation total wrong.
      conversationId: s.conversationId ?? null,
      messageId: s.messageId ?? null,
      runId: s.runId ?? null,
      kind: 'model' as const,
      providerKey: s.model.providerKey,
      modelId: s.model.id,
      modelSlug: s.model.slug,
      modelPriceId: s.model.priceId,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      cachedInputTokens: s.cachedInputTokens,
      cacheWriteTokens: s.cacheWriteTokens,
      weightedTokens: s.weightedTokens,
      outputMultiplier: s.outputMultiplier,
      upstreamCostMicroUsd: s.upstreamCostMicroUsd,
      chargedMicroUsd: s.chargedMicroUsd,
      grossMarginMicroUsd: s.grossMarginMicroUsd,
      settlement: s.settlement,
      usedByok: false,
      latencyMs: s.latencyMs,
      status: 'success',
      occurredAt: s.occurredAt,
      createdAt: s.occurredAt,
    })),
  );

  /* ---- Compute events, one sandbox session each ---- */
  const upstreamPerBaseHour = 9_000; // matches compute.upstream_micro_usd_per_base_hour.karo_cloud
  let computeQuotaRemaining = plan.includedComputeHours;
  let totalComputeHours = 0;
  let totalComputeCharged = 0;
  let totalComputeUpstream = 0;
  let totalActiveSeconds = 0;

  const sessionRows: Array<typeof schema.sandboxSessions.$inferInsert> = [];
  const computeRows: Array<typeof schema.computeEvents.$inferInsert> = [];

  for (let day = 0; day < 30; day += 1) {
    const dayStart = new Date(period.start.getTime() + day * DAY_MS);
    const weekday = dayStart.getUTCDay();
    const sessions = weekday === 0 || weekday === 6 ? randInt(0, 1) : randInt(1, 2);

    for (let i = 0; i < sessions; i += 1) {
      const startedAt = new Date(
        dayStart.getTime() + randInt(8, 20) * 3_600_000 + randInt(0, 3_599) * 1000,
      );
      const activeSeconds = randInt(12, 55) * 60;
      const stoppedAt = new Date(startedAt.getTime() + activeSeconds * 1000);

      const settlement = settleComputeUsage({
        billedComputeHours: Math.round((activeSeconds / 3600) * multiplier * 10_000) / 10_000,
        upstreamMicroUsdPerBaseHour: upstreamPerBaseHour,
        plan: pricing,
        quotaRemainingHours: computeQuotaRemaining,
        hasActiveSubscription: true,
      });
      computeQuotaRemaining = Math.max(
        0,
        computeQuotaRemaining - settlement.quotaConsumedHours,
      );

      const sessionId = newId(ID_PREFIX.sandboxSession);
      sessionRows.push({
        id: sessionId,
        sandboxId,
        teamId: team.id,
        startedAt,
        stoppedAt,
        activeSeconds,
        stopReason: 'auto_sleep',
        createdAt: startedAt,
      });

      computeRows.push({
        id: newId(ID_PREFIX.computeEvent),
        teamId: team.id,
        userId: user.id,
        projectId,
        sandboxId,
        sandboxSessionId: sessionId,
        providerKey: 'mock',
        cpuCores: shape.cpuCores,
        memoryMb: shape.memoryMb,
        diskGb: shape.diskGb,
        computeMultiplier: multiplier,
        startedAt,
        stoppedAt,
        activeSeconds,
        billedComputeHours: settlement.billedComputeHours,
        upstreamCostMicroUsd: settlement.upstreamCostMicroUsd,
        chargedMicroUsd: settlement.chargedMicroUsd,
        grossMarginMicroUsd: settlement.grossMarginMicroUsd,
        settlement: settlement.settlement,
        occurredAt: stoppedAt,
        createdAt: stoppedAt,
      });

      totalComputeHours += settlement.billedComputeHours;
      totalComputeCharged += settlement.chargedMicroUsd;
      totalComputeUpstream += settlement.upstreamCostMicroUsd;
      totalActiveSeconds += activeSeconds;
    }
  }

  if (sessionRows.length > 0) await db.insert(schema.sandboxSessions).values(sessionRows);
  if (computeRows.length > 0) await db.insert(schema.computeEvents).values(computeRows);

  await db
    .update(schema.sandboxes)
    .set({ totalActiveSeconds })
    .where(eq(schema.sandboxes.id, sandboxId));

  /* ---- Rolled-up period counters (the source quota checks read) ---- */
  totalComputeHours = Math.round(totalComputeHours * 10_000) / 10_000;

  await db.insert(schema.usagePeriods).values({
    // `ID_PREFIX` has no dedicated entry for a period roll-up; `uev` keeps these
    // rows recognisable as metering data in logs and audit trails.
    id: newId(ID_PREFIX.usageEvent),
    teamId: team.id,
    periodStart: period.start,
    periodEnd: period.end,
    weightedTokensUsed: totalWeighted,
    computeHoursUsed: totalComputeHours,
    storageGbUsed: 1.8,
    modelChargedMicroUsd: totalModelCharged,
    computeChargedMicroUsd: totalComputeCharged,
    overageMicroUsd: totalModelCharged + totalComputeCharged,
    upstreamCostMicroUsd: totalModelUpstream + totalComputeUpstream,
    alertSentAt:
      totalWeighted >= plan.includedWeightedTokens * team.usageAlertThreshold
        ? new Date(now.getTime() - 4 * DAY_MS)
        : null,
  });

  /* ---- Installed skills and plugins ---- */
  const installedSkillKeys = ['website-builder', 'bug-fixer', 'git-assistant'] as const;
  await db.insert(schema.installedSkills).values(
    installedSkillKeys.map((key, index) => ({
      id: newId(ID_PREFIX.installedSkill),
      skillId: required(skillIds.get(key), `skill ${key}`),
      teamId: team.id,
      projectId: null,
      installedById: user.id,
      scope: 'account' as const,
      isEnabled: true,
      version: '1.0.0',
      lastUsedAt: new Date(now.getTime() - (index + 2) * DAY_MS),
      createdAt: period.start,
      updatedAt: period.start,
    })),
  );

  const installedPluginKeys = ['nodejs', 'github', 'playwright'] as const;
  await db.insert(schema.installedPlugins).values(
    installedPluginKeys.map((key) => ({
      id: newId(ID_PREFIX.installedPlugin),
      pluginId: required(pluginIds.get(key), `plugin ${key}`),
      teamId: team.id,
      projectId: null,
      installedById: user.id,
      version: '1.0.0',
      isEnabled: true,
      // No secret is seeded: the GitHub plugin stays unconfigured until the user
      // supplies a token, which is then encrypted before it is stored.
      config: key === 'github' ? { GITHUB_DEFAULT_BRANCH: 'main' } : null,
      grantedPermissions:
        key === 'github'
          ? ['repo.read', 'issues.read', 'network.egress']
          : ['process.spawn', 'network.egress'],
      healthStatus: 'connected' as const,
      healthMessage: 'Installed in the sandbox image.',
      lastHealthCheckAt: sleptAt,
      createdAt: period.start,
      updatedAt: period.start,
    })),
  );

  /* ---- One MCP server, connected, with its discovered tools ---- */
  const mcpServerId = newId(ID_PREFIX.mcpServer);
  await db.insert(schema.mcpServers).values({
    id: mcpServerId,
    teamId: team.id,
    projectId,
    createdById: user.id,
    name: 'Filesystem',
    description: 'Read-only filesystem access scoped to /workspace.',
    scope: 'project',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    env: {},
    isEnabled: true,
    status: 'connected',
    statusMessage: '3 tools discovered.',
    allowedTools: ['read_file', 'list_directory', 'search_files'],
    requireApproval: false,
    lastConnectedAt: sleptAt,
    lastHealthCheckAt: sleptAt,
    logs: [
      { at: sleptAt.toISOString(), level: 'info', message: 'stdio transport connected' },
      { at: sleptAt.toISOString(), level: 'info', message: 'Discovered 3 tools, 0 prompts' },
    ],
    templateKey: 'filesystem',
    createdAt: period.start,
    updatedAt: sleptAt,
  });

  await db.insert(schema.mcpTools).values([
    {
      id: newId(ID_PREFIX.mcpTool),
      serverId: mcpServerId,
      name: 'read_file',
      description: 'Read the complete contents of a file inside /workspace.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      isEnabled: true,
      isDestructive: false,
      callCount: 34,
      lastCalledAt: sleptAt,
    },
    {
      id: newId(ID_PREFIX.mcpTool),
      serverId: mcpServerId,
      name: 'list_directory',
      description: 'List files and directories at a path inside /workspace.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      isEnabled: true,
      isDestructive: false,
      callCount: 12,
      lastCalledAt: sleptAt,
    },
    {
      id: newId(ID_PREFIX.mcpTool),
      serverId: mcpServerId,
      name: 'search_files',
      description: 'Recursively search for files matching a glob pattern.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, pattern: { type: 'string' } },
        required: ['path', 'pattern'],
      },
      isEnabled: true,
      isDestructive: false,
      callCount: 5,
      lastCalledAt: new Date(now.getTime() - 3 * DAY_MS),
    },
  ]);

  /* ---- Balance, top-up and one paid invoice ---- */
  const balanceMicroUsd = 25_000_000;
  const spentMicroUsd = totalModelCharged + totalComputeCharged;

  await upsertBalance(team.id, {
    balanceMicroUsd,
    toppedUpMicroUsd: balanceMicroUsd + spentMicroUsd,
    spentMicroUsd,
    creditLimitMicroUsd: 2_000_000,
  });

  await db.insert(schema.topups).values({
    id: newId(ID_PREFIX.topup),
    teamId: team.id,
    userId: user.id,
    amountMicroUsd: balanceMicroUsd + spentMicroUsd,
    bonusMicroUsd: 0,
    status: 'succeeded',
    provider: 'mock',
    idempotencyKey: `seed-demo-topup-${team.id}`,
    completedAt: period.start,
    createdAt: period.start,
  });

  await db.insert(schema.invoices).values({
    id: newId(ID_PREFIX.invoice),
    teamId: team.id,
    number: `KARO-DEMO-${startOfUtcDay(period.start).toISOString().slice(0, 10).replace(/-/g, '')}`,
    status: 'paid',
    subtotalMicroUsd: plan.priceMicroUsdMonthly,
    taxMicroUsd: 0,
    totalMicroUsd: plan.priceMicroUsdMonthly,
    amountPaidMicroUsd: plan.priceMicroUsdMonthly,
    currency: 'usd',
    periodStart: period.start,
    periodEnd: period.end,
    lineItems: [
      {
        label: `${plan.name} subscription`,
        quantity: 1,
        amountMicroUsd: plan.priceMicroUsdMonthly,
      },
    ],
    issuedAt: period.start,
    paidAt: period.start,
    createdAt: period.start,
  });

  /* ---- Audit trail and notifications ---- */
  await db.insert(schema.auditEvents).values([
    {
      id: newId(ID_PREFIX.auditEvent),
      teamId: team.id,
      userId: user.id,
      actorType: 'user',
      action: 'project.create',
      resourceType: 'project',
      resourceId: projectId,
      severity: 'info',
      summary: 'Created project "Aurora Landing" from the Next.js template.',
      metadata: { template: template.key, files: template.files.length },
      ipAddress: '198.51.100.24',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) KaroWeb/1.0',
      createdAt: period.start,
    },
    {
      id: newId(ID_PREFIX.auditEvent),
      teamId: team.id,
      userId: user.id,
      actorType: 'user',
      action: 'plugin.install',
      resourceType: 'plugin',
      resourceId: required(pluginIds.get('github'), 'plugin github'),
      severity: 'notice',
      summary: 'Installed the GitHub plugin with read-only repository scopes.',
      metadata: { granted: ['repo.read', 'issues.read', 'network.egress'] },
      ipAddress: '198.51.100.24',
      createdAt: new Date(period.start.getTime() + 3 * DAY_MS),
    },
    {
      id: newId(ID_PREFIX.auditEvent),
      teamId: team.id,
      userId: user.id,
      actorType: 'agent',
      action: 'file.write.approve',
      resourceType: 'project_file',
      resourceId: projectId,
      severity: 'notice',
      summary: 'Approved the agent write to app/globals.css (9 insertions, 3 deletions).',
      metadata: { path: 'app/globals.css', runId },
      createdAt: new Date(chatStart.getTime() + 4 * 60_000 + 25_000),
    },
    {
      id: newId(ID_PREFIX.auditEvent),
      teamId: team.id,
      userId: null,
      actorType: 'system',
      action: 'sandbox.sleep',
      resourceType: 'sandbox',
      resourceId: sandboxId,
      severity: 'info',
      summary: 'Sandbox aurora-landing slept after 20 idle minutes.',
      metadata: { autoSleepMinutes: plan.autoSleepMinutes, totalActiveSeconds },
      createdAt: sleptAt,
    },
    {
      id: newId(ID_PREFIX.auditEvent),
      teamId: team.id,
      userId: null,
      actorType: 'system',
      action: 'quota.alert',
      resourceType: 'team',
      resourceId: team.id,
      severity: 'warning',
      summary: `Team passed ${Math.round(team.usageAlertThreshold * 100)}% of its monthly weighted-token allowance.`,
      metadata: {
        weightedTokensUsed: totalWeighted,
        includedWeightedTokens: plan.includedWeightedTokens,
      },
      createdAt: new Date(now.getTime() - 4 * DAY_MS),
    },
  ]);

  await db.insert(schema.notifications).values([
    {
      id: newId(ID_PREFIX.notification),
      userId: user.id,
      teamId: team.id,
      level: 'warning',
      title: 'You have used 80% of this month’s allowance',
      body: `${totalWeighted.toLocaleString('en-US')} of ${plan.includedWeightedTokens.toLocaleString('en-US')} weighted tokens are gone. Anything past the allowance is billed at ${formatUsd(plan.overageMicroUsdPerMWeighted)} per million from your balance.`,
      actionLabel: 'View usage',
      actionHref: '/app/usage',
      createdAt: new Date(now.getTime() - 4 * DAY_MS),
    },
    {
      id: newId(ID_PREFIX.notification),
      userId: user.id,
      teamId: team.id,
      level: 'success',
      title: 'Hero overflow fixed',
      body: 'The agent finished "Fix hero overflow below 480px" — one file changed and the production build is still green.',
      actionLabel: 'Open the run',
      // The workspace is keyed by project id, not slug, and it opens on the most
      // recently active conversation — which is this one.
      actionHref: `/app/projects/${projectId}`,
      readAt: new Date(now.getTime() - 2 * DAY_MS + 20 * 60_000),
      createdAt: lastAssistant.occurredAt,
    },
    {
      id: newId(ID_PREFIX.notification),
      userId: user.id,
      teamId: team.id,
      level: 'info',
      title: 'Sandbox is asleep',
      body: 'aurora-landing slept after 20 idle minutes and stopped billing compute. It wakes on your next command in about 4 seconds.',
      actionLabel: 'Open the project',
      actionHref: `/app/projects/${projectId}`,
      createdAt: sleptAt,
    },
    {
      id: newId(ID_PREFIX.notification),
      userId: user.id,
      teamId: team.id,
      level: 'info',
      title: 'Model catalogue refreshed',
      body: 'Prices and context windows were synced from the provider catalogue. No model you use changed price.',
      actionLabel: 'Review agent defaults',
      actionHref: '/app/settings',
      readAt: new Date(now.getTime() - 5 * DAY_MS),
      createdAt: new Date(now.getTime() - 5 * DAY_MS - 3_600_000),
    },
  ]);

  return {
    weightedTokensUsed: totalWeighted,
    computeHoursUsed: totalComputeHours,
    modelChargedMicroUsd: totalModelCharged,
    computeChargedMicroUsd: totalComputeCharged,
    usageEventCount: settled.length,
    computeEventCount: computeRows.length,
  };
}

/* ------------------------------------------------------------------ *
 *  Entrypoint
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const started = Date.now();
  console.log(`▸ Seeding ${DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')}`);

  // On a laptop behind localhost the documented defaults are fine; on a
  // production deployment they are known credentials that hand the admin
  // panel and the demo workspace to the first visitor who reads the README.
  // Refuse to write them rather than ship a platform anyone can sign into.
  if (process.env.NODE_ENV === 'production') {
    const weak: string[] = [];
    if ((process.env.SEED_ADMIN_PASSWORD ?? 'karo-admin-2025') === 'karo-admin-2025') {
      weak.push('SEED_ADMIN_PASSWORD');
    }
    if ((process.env.SEED_DEMO_PASSWORD ?? 'karo-demo-2025') === 'karo-demo-2025') {
      weak.push('SEED_DEMO_PASSWORD');
    }
    if (weak.length > 0) {
      console.error(
        `✖ Refusing to seed a production database with the documented default ${weak.join(' and ')}.`,
      );
      console.error(
        '  Generate a random value (e.g. `openssl rand -base64 24`) and set it as',
        `  ${weak.join(' / ')} before running the seed.`,
      );
      process.exit(1);
    }
  }

  const providerIds = await seedProviders();
  console.log(`  · providers        ${providerIds.size}`);

  const models = await seedModels(providerIds);
  console.log(`  · models + prices  ${models.size}`);

  const plansByKey = await seedPlans();
  console.log(`  · plans            ${plansByKey.size}`);

  const skillIds = await seedSkills();
  console.log(`  · skills           ${skillIds.size}`);

  const pluginIds = await seedPlugins();
  console.log(`  · plugins          ${pluginIds.size}`);

  const settingCount = await seedAdminSettings();
  console.log(
    `  · admin settings   ${settingCount} (incl. ${MCP_TEMPLATE_SEEDS.length} MCP templates, ${PROJECT_TEMPLATE_SEEDS.length} project templates)`,
  );

  const incidentCounts = await seedIncidents();
  console.log(
    `  · incidents        ${incidentCounts.open} open · ${incidentCounts.resolved} resolved`,
  );

  const ultraPlan = required(plansByKey.get('ultra'), 'ultra plan');
  const proPlan = required(plansByKey.get('pro'), 'pro plan');

  /* ---- Admin ---- */
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@karo.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'karo-admin-2025';
  const adminUser = await upsertUser({
    email: adminEmail,
    name: 'Karo Admin',
    passwordHash: await hashPassword(adminPassword),
    platformRole: 'admin',
    isDemo: false,
  });
  const adminTeam = await upsertPersonalTeam(adminUser, {
    name: 'Karo Platform',
    slug: 'karo-platform',
    avatarColor: 'ember',
  });

  const now = new Date();
  const adminPeriodStart = startOfUtcDay(now);
  await upsertSubscription(adminTeam.id, ultraPlan, {
    start: adminPeriodStart,
    end: new Date(adminPeriodStart.getTime() + 31 * DAY_MS),
  });
  await upsertBalance(adminTeam.id, {
    balanceMicroUsd: 100_000_000,
    toppedUpMicroUsd: 100_000_000,
    spentMicroUsd: 0,
    creditLimitMicroUsd: 10_000_000,
  });
  console.log(`  · admin account    ${adminEmail} (Ultra)`);

  /* ---- Demo ---- */
  const demoEmail = 'demo@karo.local';
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? 'karo-demo-2025';
  const demoUser = await upsertUser({
    email: demoEmail,
    name: 'Demo User',
    passwordHash: await hashPassword(demoPassword),
    platformRole: 'user',
    isDemo: true,
  });
  const demoTeam = await upsertPersonalTeam(demoUser, {
    name: 'Demo Workspace',
    slug: 'demo-workspace',
    avatarColor: 'primary',
  });

  // A 31-day period that started 30 days ago and renews tomorrow, so the demo
  // dashboard shows a nearly-complete month rather than an empty one.
  const periodStart = new Date(startOfUtcDay(now).getTime() - 30 * DAY_MS);
  const period = { start: periodStart, end: new Date(periodStart.getTime() + 31 * DAY_MS) };

  await upsertSubscription(demoTeam.id, proPlan, period);
  await resetDemoWorkspace(demoTeam.id, demoUser.id);
  const demo = await seedDemoWorkspace({
    user: demoUser,
    team: demoTeam,
    plan: proPlan,
    models,
    skillIds,
    pluginIds,
    period,
  });

  // After `seedDemoWorkspace`, because `resetDemoWorkspace` clears the demo
  // team's audit rows and would otherwise take the backfill with them.
  const backfilled = await seedAuditBackfill(
    [
      { teamId: demoTeam.id, userId: demoUser.id, ip: '198.51.100.24' },
      { teamId: adminTeam.id, userId: adminUser.id, ip: '203.0.113.9' },
    ],
    60,
  );
  console.log(`  · audit backfill   ${backfilled} events across 2 teams`);

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const quotaPercent = Math.round(
    (demo.weightedTokensUsed / proPlan.includedWeightedTokens) * 100,
  );

  console.log(`  · demo account     ${demoEmail} (Pro)`);
  console.log('');
  console.log('✔ Seed complete in ' + (Date.now() - started) + 'ms');
  console.log('');
  console.log('  Catalogue');
  console.log(
    `    ${plansByKey.size} plans · ${models.size} models · ${skillIds.size} skills · ${pluginIds.size} plugins`,
  );
  console.log(
    `    ${MCP_TEMPLATE_SEEDS.length} MCP templates · ${PROJECT_TEMPLATE_SEEDS.length} project templates · ${settingCount} admin settings`,
  );
  console.log('');
  console.log('  Demo workspace');
  const nextTemplate = required(
    findProjectTemplate('nextjs-website'),
    'nextjs-website template',
  );
  console.log(
    `    Project      Aurora Landing (Next.js template, ${nextTemplate.files.length} files)`,
  );
  console.log('    Sandbox      aurora-landing — sleeping, 0.5 vCPU / 1024 MB');
  console.log('    Conversation "Hero overflows below 480px" — 6 messages, 2 tool calls');
  console.log(
    `    Usage        ${demo.usageEventCount} model events · ${demo.weightedTokensUsed.toLocaleString('en-US')} weighted tokens (${quotaPercent}% of the Pro allowance)`,
  );
  console.log(
    `    Compute      ${demo.computeEventCount} sessions · ${demo.computeHoursUsed.toFixed(2)} of ${proPlan.includedComputeHours} included hours`,
  );
  console.log(
    `    Charged      ${formatUsd(demo.modelChargedMicroUsd)} model + ${formatUsd(demo.computeChargedMicroUsd)} compute overage · balance ${formatUsd(25_000_000)}`,
  );
  console.log('');
  console.log('  Sign in');
  console.log(`    Admin  ${adminEmail}  /  ${adminPassword}`);
  console.log(`    Demo   ${demoEmail}  /  ${demoPassword}`);
  console.log('');
  console.log(`  Open ${appUrl}/login`);
  console.log('');
}

main()
  .catch((error) => {
    console.error('✖ Seed failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 }).catch(() => {});
    if (process.exitCode === 1) process.exit(1);
  });

/** Re-exported so a future admin "reset demo data" action can reuse the logic. */
export { resetDemoWorkspace, seedDemoWorkspace, type SeededModel };
