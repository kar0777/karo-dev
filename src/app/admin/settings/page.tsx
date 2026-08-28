import { asc, eq } from 'drizzle-orm';

import { AdminPanel } from '@/components/admin/primitives';
import {
  SettingsEditor,
  type AdminSettingGroup,
  type AdminSettingRow,
  type SettingValueKind,
} from '@/components/admin/settings-editor';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { adminSettings, users } from '@/lib/db/schema';
import { ADMIN_SETTING_SEEDS } from '@/lib/db/seed-data/admin-settings';
import { SETTING_DEFAULTS, SETTING_KEYS, SETTING_META, getAllSettings } from '@/lib/settings';
import {
  formatBytes,
  formatDuration,
  formatMicroUsd,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Platform settings',
  description:
    'Every tunable number in Karo, with its current value, its seeded default and where the product reads it.',
};

/**
 * Platform settings.
 *
 * The rows come from `admin_settings` rather than from a list in this file, so
 * the page can never claim a key the database does not have. Defaults come from
 * `src/lib/db/seed-data/admin-settings.ts` — the seed deliberately does not
 * overwrite `value` on re-run, which is what makes "changed from default"
 * meaningful after a redeploy.
 *
 * The last panel lists what `src/lib/settings.ts` returns right now for every key
 * the product reads. It used to exist because those keys and these rows were two
 * different vocabularies and none of them met; now that they are reconciled it
 * stays as the shortest answer to "is this row actually in force".
 */

const SEED_BY_KEY = new Map(ADMIN_SETTING_SEEDS.map((seed) => [seed.key, seed]));

const CATEGORY_META: Record<string, { title: string; blurb: string }> = {
  general: {
    title: 'General',
    blurb:
      'Contact details shown to customers and the platform-wide switches. Maintenance mode refuses every state-changing request from a non-admin and shows a strip in the app; reads keep working and platform admins are unaffected.',
  },
  signup: {
    title: 'Sign-up',
    blurb:
      'Who may create an account and what a new team starts with. Turning sign-up off leaves existing users able to sign in.',
  },
  billing: {
    title: 'Billing',
    blurb:
      'Money limits applied before a charge is settled. A change affects the next charge only — amounts already written to a usage period are never restated.',
  },
  compute: {
    title: 'Compute cost',
    blurb:
      'What one base compute hour (0.25 vCPU + 512 MB) costs Karo on each backend. These are cost inputs: they move margin and the Costs page, and never retroactively change what a team was billed.',
  },
  sandbox: {
    title: 'Sandboxes',
    blurb:
      'Defaults and hard caps for the sandbox fleet. A running sandbox keeps the values it was created with; a change reaches the next sandbox to start.',
  },
  limits: {
    title: 'Size limits',
    blurb:
      'Ceilings that stop a single request from monopolising a worker. Rejections happen at the API edge with a message naming the limit.',
  },
  rate_limits: {
    title: 'Rate limits',
    blurb:
      'Request budgets counted per user, team or IP in fixed windows. A change applies from the next window, so it does not release requests already rejected.',
  },
  fair_use: {
    title: 'Fair use',
    blurb:
      'Daily burst allowances layered on the monthly plan quota. Work over the burst still runs — it queues behind everyone else rather than failing.',
  },
  abuse: {
    title: 'Abuse limits',
    blurb:
      'Ceilings no plan may exceed. These bound the damage a compromised account can do, so they should stay below anything a legitimate plan grants.',
  },
  catalog: {
    title: 'Catalogues',
    blurb:
      'How often provider prices are refreshed and what happens to a model that disappears from a sync — historic usage keeps the price row it was charged at. The MCP and project template payloads live here too; they are shipped content rather than tunables.',
  },
  demo: {
    title: 'Demo mode',
    blurb:
      'The demo account and the indicators that tell users providers are simulated. Turn demo sign-in off before a public launch.',
  },
};

const CATEGORY_ORDER = [
  'general',
  'signup',
  'billing',
  'compute',
  'sandbox',
  'limits',
  'rate_limits',
  'fair_use',
  'abuse',
  'catalog',
  'demo',
];

type ReaderNote = {
  paths: readonly string[];
};

/**
 * Where each row is consumed, transcribed from the `getSetting` call sites.
 *
 * This map used to carry a second field naming the key the readers *actually*
 * passed, because `SETTING_KEYS` held camelCase names the seed never wrote:
 * every lookup missed its row and served a compiled fallback, so editing a
 * setting here changed nothing. The page disclosed that honestly rather than
 * fixing it. The names are reconciled now — every entry below is the key its
 * readers really ask for — so the disclosure is gone with the divergence.
 *
 * Rows with empty `paths` are stored and documented but not read anywhere yet,
 * and the editor says so on the row itself.
 */
const READ_BY: Record<string, ReaderNote> = {
  'mcp.templates': { paths: ['src/app/app/mcp/page.tsx'] },
  'project.templates': {
    paths: ['src/lib/projects/templates.ts', 'src/components/app/shell-data.ts'],
  },
  'general.status_page_url': { paths: ['src/app/admin/incidents/page.tsx'] },
  'general.announcement': { paths: ['src/components/app/shell-data.ts'] },
  'general.maintenance_mode': {
    paths: ['src/lib/api/handler.ts', 'src/components/app/shell-data.ts'],
  },
  'signup.enabled': {
    paths: ['src/lib/auth/service.ts'],
  },
  'signup.require_email_verification': {
    paths: ['src/lib/auth/guards.ts'],
  },
  'demo.login_enabled': {
    paths: ['src/app/(auth)/login/page.tsx', 'src/lib/auth/service.ts'],
  },
  'billing.platform_margin_bps': {
    paths: ['src/app/api/admin/plans/route.ts', 'src/app/admin/plans/page.tsx'],
  },
  'billing.minimum_topup_micro_usd': {
    paths: ['src/app/api/billing/topup/route.ts', 'src/app/app/billing/page.tsx'],
  },
  'billing.payg_credit_limit_micro_usd': {
    paths: ['src/lib/usage/metering.ts', 'src/lib/auth/service.ts'],
  },
  'billing.expensive_task_warn_micro_usd': { paths: ['src/lib/agent/runtime.ts'] },
  'compute.upstream_micro_usd_per_base_hour.karo_cloud': {
    paths: [
      'src/lib/sandbox/service.ts',
      'src/app/admin/_data/costs.ts',
      'src/app/(marketing)/pricing/page.tsx',
      'src/app/(marketing)/page.tsx',
    ],
  },
  'sandbox.default_auto_sleep_minutes': {
    paths: ['src/app/api/admin/plans/route.ts', 'src/app/admin/plans/page.tsx'],
  },
  'sandbox.default_auto_destroy_hours': {
    paths: ['src/app/api/admin/plans/route.ts', 'src/app/admin/plans/page.tsx'],
  },
  'sandbox.max_command_seconds': {
    paths: ['src/lib/sandbox/service.ts', 'src/app/api/sandboxes/[sandboxId]/exec/route.ts'],
  },
  'limits.max_upload_bytes': {
    paths: [
      'src/app/api/conversations/[conversationId]/messages/route.ts',
      'src/app/api/projects/[projectId]/files/content/route.ts',
    ],
  },
  'limits.max_agent_iterations': { paths: ['src/lib/agent/runtime.ts'] },
  'catalog.sync_interval_minutes': { paths: ['src/app/admin/models/page.tsx'] },
};

/**
 * Reduces a stored row to something the editor can render. A payload that does
 * not match its declared `valueType` is treated as read-only rather than guessed
 * at: writing it back under the wrong type would make `getSetting` discard it and
 * fall through to the compiled default, which is worse than not editing it.
 */
function editorValue(
  valueType: string,
  value: unknown,
): { kind: SettingValueKind; value: number | string | boolean | null } {
  if (valueType === 'number' && typeof value === 'number') return { kind: 'number', value };
  if (valueType === 'string' && typeof value === 'string') return { kind: 'string', value };
  if (valueType === 'boolean' && typeof value === 'boolean') return { kind: 'boolean', value };
  return { kind: 'json', value: null };
}

/**
 * Turns a raw integer into the quantity an operator actually reasons about. The
 * seed descriptions spell the conversions out; this puts the result next to the
 * field so nobody has to divide by a million in their head.
 */
function unitHint(key: string, value: number | string | boolean | null): string | null {
  if (typeof value !== 'number') return null;
  if (key.includes('micro_usd')) return formatMicroUsd(value);
  if (key.endsWith('_bytes')) return formatBytes(value);
  if (key.endsWith('_bps')) return formatPercent(value / 10_000, 2);
  if (key.endsWith('_hours')) return formatDuration(value * 3_600_000);
  if (key.endsWith('_seconds')) return formatDuration(value * 1000);
  // Under an hour a minute figure reads better as written than as "15m 0s".
  if (key.endsWith('_minutes')) return value >= 60 ? formatDuration(value * 60_000) : null;
  if (key.includes('multiplier') || key.endsWith('_threshold')) {
    return value > 0 && value <= 1 ? formatPercent(value, 0) : null;
  }
  return null;
}

function describeJson(valueType: string, value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? 'entry' : 'entries'} · ${formatBytes(
      JSON.stringify(value).length,
    )}`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).length;
    return `${keys} ${keys === 1 ? 'key' : 'keys'} · ${formatBytes(JSON.stringify(value).length)}`;
  }
  return `${valueType} payload`;
}

/** How a value reads in prose: the same wording the audit summaries use. */
function describeValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return formatNumber(value, 4);
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  return JSON.stringify(value);
}

export default async function AdminSettingsPage() {
  const { user: admin } = await requirePlatformAdmin();

  const [rows, runtime] = await Promise.all([
    db
      .select({ setting: adminSettings, editorEmail: users.email })
      .from(adminSettings)
      .leftJoin(users, eq(users.id, adminSettings.updatedById))
      .orderBy(asc(adminSettings.category), asc(adminSettings.key)),
    getAllSettings(),
  ]);

  const storedKeys = new Set(rows.map((row) => row.setting.key));

  const entries = rows.map(({ setting, editorEmail }) => {
    const { kind, value } = editorValue(setting.valueType, setting.value);
    const seed = SEED_BY_KEY.get(setting.key);
    const seedValue = seed ? seed.value : undefined;
    const defaultValue =
      kind !== 'json' && typeof seedValue === kind
        ? (seedValue as number | string | boolean)
        : null;

    const note = READ_BY[setting.key];

    const view: AdminSettingRow = {
      key: setting.key,
      label: setting.label || setting.key,
      description: setting.description,
      kind,
      value,
      defaultValue,
      unitHint: unitHint(setting.key, value),
      defaultHint: unitHint(setting.key, defaultValue),
      jsonSummary: kind === 'json' ? describeJson(setting.valueType, setting.value) : null,
      updatedAt: setting.updatedAt.toISOString(),
      updatedBy:
        setting.updatedById === null
          ? null
          : setting.updatedById === admin.id
            ? 'you'
            : (editorEmail ?? 'a former admin'),
      readers: note?.paths ?? [],
    };

    return { category: setting.category, view };
  });

  const views = entries.map((entry) => entry.view);

  // Grouping happens here rather than in SQL so a category the seed adds later
  // still renders, after the known ones, instead of vanishing from the page.
  const byCategory = new Map<string, AdminSettingRow[]>();
  for (const { category, view } of entries) {
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(view);
    else byCategory.set(category, [view]);
  }

  const orderedCategories = [...byCategory.keys()].sort((a, b) => {
    const rankA = CATEGORY_ORDER.indexOf(a);
    const rankB = CATEGORY_ORDER.indexOf(b);
    if (rankA === rankB) return a.localeCompare(b);
    if (rankA === -1) return 1;
    if (rankB === -1) return -1;
    return rankA - rankB;
  });

  const groups: AdminSettingGroup[] = [];
  for (const category of orderedCategories) {
    const meta = CATEGORY_META[category];
    groups.push({
      category,
      title: meta?.title ?? category.replace(/_/g, ' '),
      blurb: meta?.blurb ?? 'Keys the seed groups under this category.',
      rows: byCategory.get(category) ?? [],
    });
  }

  const drifted = views.filter(
    (view) => view.defaultValue !== null && view.value !== view.defaultValue,
  ).length;
  const lastChanged = views
    .filter((view) => view.updatedBy !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  const runtimeKeys = Object.values(SETTING_KEYS);
  // Rows the product genuinely reads. The rest are stored and shown, which is
  // honest only while the difference is visible — hence the stat.
  const liveRows = views.filter((view) => view.readers.length > 0).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Platform settings"
        description="Every tunable number in Karo, stored in admin_settings rather than in a constant, so it can be changed without a deploy. Reads are cached for 30 seconds per process, so a change here reaches request handling within half a minute; work already running keeps the values it started with."
      />

      <StatGrid columns={4}>
        <Stat
          label="Keys"
          value={formatNumber(views.length)}
          caption={`Across ${groups.length} ${groups.length === 1 ? 'category' : 'categories'}`}
        />
        <Stat
          label="Changed from default"
          value={formatNumber(drifted)}
          tone={drifted > 0 ? 'primary' : 'default'}
          caption="A re-run of the seed never reverts an edited value"
        />
        <Stat
          label="Read by the product"
          value={formatNumber(liveRows)}
          caption={`Of ${formatNumber(views.length)} rows; the rest are stored and documented only`}
        />
        <Stat
          label="Last operator change"
          value={lastChanged ? formatRelativeTime(lastChanged.updatedAt) : '—'}
          caption={
            lastChanged
              ? `${lastChanged.label} · by ${lastChanged.updatedBy}`
              : 'Only the seed has written these rows'
          }
        />
      </StatGrid>

      {views.length === 0 ? (
        <EmptyState
          title="No settings have been written yet"
          description="The table is empty, so every read is served by the compiled fallbacks in src/lib/settings.ts and the product works as shipped. Run `npm run db:seed` to create the rows and make them editable here."
        />
      ) : (
        <SettingsEditor groups={groups} />
      )}

      <AdminPanel
        title="Values in force at request time"
        description="What src/lib/settings.ts returns right now for each key the product reads, and where that value comes from. This table is read-only because a fallback is not a row: give a key a row in admin_settings and it becomes editable above."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Setting</TableHead>
              <TableHead className="hidden sm:table-cell">Category</TableHead>
              <TableHead className="text-right">In force</TableHead>
              <TableHead className="text-right">Compiled fallback</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runtimeKeys.map((key) => {
              const meta = SETTING_META[key];
              const stored = storedKeys.has(key);
              return (
                <TableRow key={key}>
                  <TableCell className="max-w-[20rem]">
                    <span className="block truncate font-medium text-fg">{meta.label}</span>
                    <span className="block truncate font-mono text-[11px] text-subtle">
                      {key}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted sm:table-cell">
                    {meta.category}
                  </TableCell>
                  <TableCell className="karo-numeric text-right">
                    {describeValue(runtime[key])}
                    {meta.unit ? (
                      <span className="block text-[11px] text-subtle">{meta.unit}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    {describeValue(SETTING_DEFAULTS[key])}
                  </TableCell>
                  <TableCell>
                    {stored ? (
                      <Badge variant="success" size="sm">
                        admin_settings row
                      </Badge>
                    ) : (
                      <Badge variant="warning" size="sm">
                        compiled fallback
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </AdminPanel>

      <p className="text-[11px] leading-relaxed text-subtle">
        Every change on this page is written to the audit log as{' '}
        <code className="font-mono text-[11px]">admin.setting_update</code> with the previous
        and new value, and the seed is written so that re-running it updates a key's label,
        description and category but never its value. JSON payloads — the MCP and project
        template catalogues — are the exception: they are shipped content, the seed rewrites
        them on every run, and they are read-only here.
      </p>
    </div>
  );
}
