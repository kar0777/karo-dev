import { asc, inArray, sql } from 'drizzle-orm';
import Link from 'next/link';

import { PlansEditor, type AdminPlan } from '@/components/admin/plans-editor';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { db } from '@/lib/db';
import { plans, subscriptions } from '@/lib/db/schema';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';
import { requirePlatformAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/*
 * Authorisation lives here, not only in `app/admin/layout.tsx`.
 *
 * A layout is not a security boundary in the App Router. `notFound()` thrown
 * from the layout renders the 404 shell, but the page segment beside it has
 * already been invoked and its RSC flight payload is still streamed into the
 * response — so an anonymous `curl` of this route returned 200 with the real
 * data in the body while a browser politely painted "not found". Verified
 * against the production build: /admin/costs handed out platform revenue and
 * margins, /admin/usage every team by id and name, /admin/sandboxes the fleet.
 * Each page therefore proves the caller itself.
 */
export default async function AdminPlansPage() {
  await requirePlatformAdmin();

  const [rows, counts, marginBps, autoSleepMinutes, autoDestroyHours] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.name)),
    db
      .select({ planId: subscriptions.planId, value: sql<string>`count(*)` })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ['active', 'trialing']))
      .groupBy(subscriptions.planId),
    getSetting<number>(
      SETTING_KEYS.platformMarginBps,
      settingDefault(SETTING_KEYS.platformMarginBps),
    ),
    getSetting<number>(
      SETTING_KEYS.sandboxDefaultAutoSleepMinutes,
      settingDefault(SETTING_KEYS.sandboxDefaultAutoSleepMinutes),
    ),
    getSetting<number>(
      SETTING_KEYS.sandboxDefaultAutoDestroyHours,
      settingDefault(SETTING_KEYS.sandboxDefaultAutoDestroyHours),
    ),
  ]);

  const countByPlan = new Map(counts.map((row) => [row.planId, Number(row.value) || 0]));

  const editable: AdminPlan[] = rows.map((plan) => ({
    id: plan.id,
    activeSubscriptions: countByPlan.get(plan.id) ?? 0,
    key: plan.key,
    tier: plan.tier,
    name: plan.name,
    tagline: plan.tagline,
    description: plan.description,
    priceMicroUsdMonthly: plan.priceMicroUsdMonthly,
    priceMicroUsdYearly: plan.priceMicroUsdYearly,
    stripePriceIdMonthly: plan.stripePriceIdMonthly,
    stripePriceIdYearly: plan.stripePriceIdYearly,
    includedWeightedTokens: plan.includedWeightedTokens,
    includedComputeHours: plan.includedComputeHours,
    maxActiveSandboxes: plan.maxActiveSandboxes,
    maxSandboxMemoryMb: plan.maxSandboxMemoryMb,
    maxSandboxCpuCores: plan.maxSandboxCpuCores,
    storageGb: plan.storageGb,
    maxTeamMembers: plan.maxTeamMembers,
    maxProjects: plan.maxProjects,
    maxSkills: plan.maxSkills,
    maxPlugins: plan.maxPlugins,
    maxMcpServers: plan.maxMcpServers,
    maxConcurrentRuns: plan.maxConcurrentRuns,
    queuePriority: plan.queuePriority,
    auditRetentionDays: plan.auditRetentionDays,
    autoSleepMinutes: plan.autoSleepMinutes,
    autoDestroyHours: plan.autoDestroyHours,
    allowByok: plan.allowByok,
    allowDocker: plan.allowDocker,
    allowOwnServer: plan.allowOwnServer,
    allowExternalSandbox: plan.allowExternalSandbox,
    allowCustomSandboxSize: plan.allowCustomSandboxSize,
    allowPreviewDeployments: plan.allowPreviewDeployments,
    allowPrivateSkills: plan.allowPrivateSkills,
    allowApiAccess: plan.allowApiAccess,
    allowSso: plan.allowSso,
    allowDedicatedWorker: plan.allowDedicatedWorker,
    allowCustomModelRouting: plan.allowCustomModelRouting,
    allowedShells: normaliseShells(plan.allowedShells),
    supportLevel: normaliseSupport(plan.supportLevel),
    marginBps: plan.marginBps,
    overageMicroUsdPerMWeighted: plan.overageMicroUsdPerMWeighted,
    overageMicroUsdPerComputeHour: plan.overageMicroUsdPerComputeHour,
    trialDays: plan.trialDays,
    isPublic: plan.isPublic,
    isActive: plan.isActive,
    highlight: plan.highlight,
    features: plan.features,
    sortOrder: plan.sortOrder,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plans"
        description="Every quota and capability in Karo is a column on these rows. Editing a plan changes what new subscriptions get; existing subscribers keep the quota snapshot taken when they subscribed."
      />

      <p className="text-[12.5px] leading-relaxed text-muted">
        A plan created through{' '}
        <code className="font-mono text-[11px]">POST /api/admin/plans</code> without its own
        margin, auto-sleep or auto-destroy inherits the platform defaults in force — currently{' '}
        {(marginBps / 100).toFixed(0)}% margin, {autoSleepMinutes} idle minutes and{' '}
        {autoDestroyHours} hours asleep.{' '}
        <Link href="/admin/settings" className="underline underline-offset-2 hover:text-fg">
          Platform settings
        </Link>{' '}
        lists where each of the three is read from. The editor below always sends all three, so
        a plan created here carries whatever the form shows.
      </p>

      {editable.length === 0 ? (
        <EmptyState
          title="No plans yet"
          description="The plan catalogue is empty, which means nobody can subscribe. Run `npm run db:seed` to load the default catalogue, or create the first plan by hand."
        />
      ) : null}

      <PlansEditor plans={editable} />
    </div>
  );
}

const SHELLS = ['bash', 'sh', 'powershell', 'cmd'] as const;
const SUPPORT = ['community', 'email', 'priority', 'dedicated'] as const;

/** The column is free-form JSON; the editor's union is stricter than the DB. */
function normaliseShells(value: string[]): Array<(typeof SHELLS)[number]> {
  const allowed = value.filter((entry): entry is (typeof SHELLS)[number] =>
    (SHELLS as readonly string[]).includes(entry),
  );
  return allowed.length > 0 ? allowed : ['bash'];
}

function normaliseSupport(value: string): (typeof SUPPORT)[number] {
  return (SUPPORT as readonly string[]).includes(value)
    ? (value as (typeof SUPPORT)[number])
    : 'community';
}
