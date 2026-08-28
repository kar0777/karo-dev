import { eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { adminSettings } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';

/**
 * Typed access to the `admin_settings` table — every tunable number in the
 * product lives there rather than in a constant, so an operator can change
 * margin or auto-sleep without a deploy.
 *
 * Reads are cached for 30 seconds in-process. That is short enough that an
 * admin edit feels immediate and long enough that rendering a dashboard does
 * not issue twenty identical queries. Every read has a compiled-in fallback,
 * so the app is fully functional *before the seed has ever run*.
 */

const log = createLogger('settings');

const CACHE_TTL_MS = 30_000;

/**
 * Each value is the `admin_settings.key` the setting is stored under, so the
 * name here decides whether an operator can change the number at all: only a key
 * that already has a row is editable, because `PATCH /api/admin/settings` refuses
 * to mint one and the seed is the only other writer.
 *
 * These names were once a parallel camelCase vocabulary — `billing.minTopupMicroUsd`
 * against the seed's `billing.minimum_topup_micro_usd`, and so on for all sixteen.
 * `getSetting` matches the key exactly, so not one lookup ever found its row: the
 * product ran entirely on the fallbacks below while every switch in `/admin/settings`
 * wrote to a row nothing read. Both halves looked right in isolation, which is why
 * it survived. Every entry now names a row the seed actually creates, and
 * `tests/unit/security/settings-wiring.test.ts` fails the build if one stops doing
 * so — including by inventing a new name instead of pointing at a real row.
 */
export const SETTING_KEYS = {
  /** Margin a new plan is created with when the request does not set one, in basis points. */
  platformMarginBps: 'billing.platform_margin_bps',
  /** Smallest accepted pay-as-you-go top-up, micro-USD. */
  billingMinTopupMicroUsd: 'billing.minimum_topup_micro_usd',
  /** How far a PAYG balance may go negative before execution is blocked. */
  billingPaygCreditLimitMicroUsd: 'billing.payg_credit_limit_micro_usd',
  /** Upstream cost of one base compute hour (0.25 vCPU + 512 MB), micro-USD. */
  computeUpstreamMicroUsdPerBaseHour: 'compute.upstream_micro_usd_per_base_hour.karo_cloud',
  /** Estimated run cost above which a run waits for the user to confirm. 0 never asks. */
  agentExpensiveThresholdMicroUsd: 'billing.expensive_task_warn_micro_usd',
  sandboxDefaultAutoSleepMinutes: 'sandbox.default_auto_sleep_minutes',
  sandboxDefaultAutoDestroyHours: 'sandbox.default_auto_destroy_hours',
  authSignupEnabled: 'signup.enabled',
  authRequireEmailVerification: 'signup.require_email_verification',
  authDemoLoginEnabled: 'demo.login_enabled',
  limitsMaxUploadBytes: 'limits.max_upload_bytes',
  catalogSyncIntervalMinutes: 'catalog.sync_interval_minutes',
  platformAnnouncement: 'general.announcement',
  platformMaintenanceMode: 'general.maintenance_mode',
  agentMaxIterations: 'limits.max_agent_iterations',
  agentToolTimeoutSeconds: 'sandbox.max_command_seconds',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * Fallbacks used when the row is missing or the database is unreachable. For a
 * key that names a seeded row this is the value the seed writes, so an install
 * behaves the same before and after `npm run db:seed`; for a key nothing writes
 * it is the value in force permanently.
 */
export const SETTING_DEFAULTS = {
  'billing.platform_margin_bps': 2000,
  'billing.minimum_topup_micro_usd': 5_000_000,
  'billing.payg_credit_limit_micro_usd': 2_000_000,
  'compute.upstream_micro_usd_per_base_hour.karo_cloud': 9_000,
  'billing.expensive_task_warn_micro_usd': 1_000_000,
  'sandbox.default_auto_sleep_minutes': 15,
  'sandbox.default_auto_destroy_hours': 72,
  'signup.enabled': true,
  'signup.require_email_verification': false,
  'demo.login_enabled': true,
  'limits.max_upload_bytes': 10 * 1024 * 1024,
  'catalog.sync_interval_minutes': 60,
  'general.announcement': '',
  'general.maintenance_mode': false,
  'limits.max_agent_iterations': 24,
  'sandbox.max_command_seconds': 300,
} as const satisfies Record<SettingKey, unknown>;

export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

export type SettingMeta = {
  label: string;
  description: string;
  category:
    'platform' | 'billing' | 'compute' | 'agent' | 'sandbox' | 'auth' | 'limits' | 'catalog';
  unit?: string;
};

/** Drives the admin settings UI — label, help text and grouping per key. */
export const SETTING_META: Record<SettingKey, SettingMeta> = {
  'billing.platform_margin_bps': {
    label: 'Platform margin',
    description:
      'Margin a newly created plan starts with when the create request does not set one. 2000 = +20%. Settlement always reads the plan row, so existing plans and their subscribers are untouched by a change here.',
    category: 'billing',
    unit: 'basis points',
  },
  'billing.minimum_topup_micro_usd': {
    label: 'Minimum top-up',
    description: 'Smallest pay-as-you-go top-up a team may purchase.',
    category: 'billing',
    unit: 'micro-USD',
  },
  'billing.payg_credit_limit_micro_usd': {
    label: 'PAYG credit limit',
    description:
      'How far a balance may go negative before runs are blocked. Covers the tail of an in-flight run.',
    category: 'billing',
    unit: 'micro-USD',
  },
  'compute.upstream_micro_usd_per_base_hour.karo_cloud': {
    label: 'Compute upstream cost',
    description: 'What one base compute hour (0.25 vCPU + 512 MB RAM) costs Karo.',
    category: 'compute',
    unit: 'micro-USD / hour',
  },
  'billing.expensive_task_warn_micro_usd': {
    label: 'Expensive-run threshold',
    description:
      'A run whose pre-flight estimate is above this does not start until the user has seen the figure and confirmed it. 0 never asks.',
    category: 'billing',
    unit: 'micro-USD',
  },
  'sandbox.default_auto_sleep_minutes': {
    label: 'Default auto-sleep',
    description:
      'Idle minutes a newly created plan starts with when the create request does not set one. A sandbox takes auto-sleep from its team plan, so existing plans keep their own value.',
    category: 'sandbox',
    unit: 'minutes',
  },
  'sandbox.default_auto_destroy_hours': {
    label: 'Default auto-destroy',
    description:
      'Hours asleep a newly created plan starts with when the create request does not set one. Existing plans keep their own value.',
    category: 'sandbox',
    unit: 'hours',
  },
  'signup.enabled': {
    label: 'Public sign-up',
    description: 'When off, only invited users can create an account.',
    category: 'auth',
  },
  'signup.require_email_verification': {
    label: 'Require email verification',
    description:
      'When on, users must confirm their email before using the product. Off by default so demo mode stays frictionless.',
    category: 'auth',
  },
  'demo.login_enabled': {
    label: 'Demo sign-in',
    description: 'Shows the one-click demo account button on the sign-in screen.',
    category: 'auth',
  },
  'limits.max_upload_bytes': {
    label: 'Maximum upload size',
    description: 'Largest file a user may attach to a message or upload into a workspace.',
    category: 'limits',
    unit: 'bytes',
  },
  'catalog.sync_interval_minutes': {
    label: 'Catalogue freshness window',
    description:
      'Age at which a provider catalogue stops counting as current. This triggers no sync — the catalogue is only refreshed when someone runs one — it is the point where Admin → Models marks the provider stale and asks for a sync.',
    category: 'catalog',
    unit: 'minutes',
  },
  'general.announcement': {
    label: 'Announcement banner',
    description:
      'Plain text shown above every signed-in page. Empty renders nothing at all, and the text is never treated as HTML.',
    category: 'platform',
  },
  'general.maintenance_mode': {
    label: 'Maintenance mode',
    description:
      'Refuses POST/PUT/PATCH/DELETE from signed-in users with a 503 and shows a strip saying so. Reads keep working; platform admins keep full access, which is what makes the switch reversible.',
    category: 'platform',
  },
  'limits.max_agent_iterations': {
    label: 'Agent iteration ceiling',
    description:
      'Hard stop on tool-call loops in a single run, so a confused agent cannot spin.',
    category: 'agent',
  },
  'sandbox.max_command_seconds': {
    label: 'Tool timeout',
    description: 'How long a single tool call may run before it is cancelled.',
    category: 'agent',
    unit: 'seconds',
  },
};

/* ------------------------------------------------------------------ *
 *  Cache
 * ------------------------------------------------------------------ */

type CacheEntry = { value: unknown; readAt: number };

const globalForSettings = globalThis as unknown as {
  __karoSettingsCache?: Map<string, CacheEntry>;
};

function cacheMap(): Map<string, CacheEntry> {
  globalForSettings.__karoSettingsCache ??= new Map();
  return globalForSettings.__karoSettingsCache;
}

function readCache(key: string): CacheEntry | undefined {
  const entry = cacheMap().get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.readAt > CACHE_TTL_MS) {
    cacheMap().delete(key);
    return undefined;
  }
  return entry;
}

/** Drops one key, or the whole cache when called with no argument. */
export function invalidateSettings(key?: string): void {
  if (key) cacheMap().delete(key);
  else cacheMap().clear();
}

/* ------------------------------------------------------------------ *
 *  Reads & writes
 * ------------------------------------------------------------------ */

/** Compile-time default for a known key. */
export function settingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTING_DEFAULTS[key];
}

/**
 * Reads one setting. `fallback` is returned when the row does not exist, when
 * its stored type does not match the fallback's, or when the database is down.
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const cached = readCache(key);
  if (cached) return coerce(cached.value, fallback);

  try {
    const rows = await db
      .select({ value: adminSettings.value })
      .from(adminSettings)
      .where(eq(adminSettings.key, key))
      .limit(1);

    const row = rows[0];
    const value = row ? row.value : undefined;
    cacheMap().set(key, { value, readAt: Date.now() });
    return coerce(value, fallback);
  } catch (error) {
    // Cache the miss briefly so a dead database does not produce one failed
    // query per component on a settings-heavy page.
    cacheMap().set(key, { value: undefined, readAt: Date.now() });
    log.warn('Setting read failed — using the fallback', { key, error });
    return fallback;
  }
}

/**
 * A stored value only wins if it is the same *kind* as the fallback. This stops
 * a hand-edited row (`"15"` instead of `15`) from turning a numeric limit into
 * a string somewhere deep in the pricing maths.
 */
function coerce<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof fallback === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  if (typeof fallback === 'boolean') {
    if (typeof value === 'boolean') return value as T;
    if (value === 'true' || value === 1) return true as T;
    if (value === 'false' || value === 0) return false as T;
    return fallback;
  }
  if (typeof fallback === 'string') {
    return (typeof value === 'string' ? value : String(value)) as T;
  }
  return value as T;
}

/** Batch read. Missing keys are simply absent from the result. */
export async function getSettings(keys: readonly string[]): Promise<Record<string, unknown>> {
  if (keys.length === 0) return {};

  const out: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const key of keys) {
    const cached = readCache(key);
    if (cached) {
      if (cached.value !== undefined) out[key] = cached.value;
    } else {
      missing.push(key);
    }
  }

  if (missing.length === 0) return out;

  try {
    const rows = await db
      .select({ key: adminSettings.key, value: adminSettings.value })
      .from(adminSettings)
      .where(inArray(adminSettings.key, missing));

    const found = new Map(rows.map((r) => [r.key, r.value]));
    const readAt = Date.now();
    for (const key of missing) {
      const value = found.get(key);
      cacheMap().set(key, { value, readAt });
      if (value !== undefined) out[key] = value;
    }
  } catch (error) {
    log.warn('Batch setting read failed — callers fall back to defaults', {
      keys: missing,
      error,
    });
  }

  return out;
}

/** Every known setting, merged over its default. Powers the admin page. */
export async function getAllSettings(): Promise<Record<SettingKey, unknown>> {
  const keys = Object.values(SETTING_KEYS);
  const stored = await getSettings(keys);
  const out = {} as Record<SettingKey, unknown>;
  for (const key of keys) {
    out[key] = coerce(stored[key], SETTING_DEFAULTS[key]);
  }
  return out;
}

function valueTypeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/** Upserts a setting and invalidates the cache for that key. */
export async function setSetting(
  key: string,
  value: unknown,
  userId?: string | null,
): Promise<void> {
  const meta = SETTING_META[key as SettingKey];

  await db
    .insert(adminSettings)
    .values({
      key,
      value,
      valueType: valueTypeOf(value),
      category: meta?.category ?? 'general',
      label: meta?.label ?? key,
      description: meta?.description ?? '',
      updatedById: userId ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: adminSettings.key,
      set: {
        value,
        valueType: valueTypeOf(value),
        updatedById: userId ?? null,
        updatedAt: new Date(),
      },
    });

  invalidateSettings(key);
}
