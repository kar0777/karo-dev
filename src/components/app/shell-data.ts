import 'server-only';

import { cache } from 'react';

import { and, desc, eq, inArray, isNull, lte, ne, gte, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  notifications,
  paygBalances,
  plans,
  projects,
  sandboxes,
  subscriptions,
  usagePeriods,
  type PlanTier,
  type RuntimeTarget,
  type TeamRole,
} from '@/lib/db/schema';
import { listUserTeams } from '@/lib/auth/guards';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';

/**
 * Everything the authenticated chrome needs, in one place.
 *
 * The layout and the Overview page both want the active plan, the current
 * period's counters and the team list. Wrapping the loader in `cache()` means
 * rendering both costs one set of queries per request instead of two.
 *
 * Deliberately read-only: a layout render must never create a usage period row
 * or otherwise mutate. When no period row exists yet the counters are simply
 * zero, which is the truth — nothing has been metered this month.
 */

export type ShellPlan = {
  id: string;
  key: string;
  name: string;
  tier: PlanTier;
  includedWeightedTokens: number;
  includedComputeHours: number;
  maxActiveSandboxes: number;
  maxProjects: number;
  maxTeamMembers: number;
  /** `false` for pay-as-you-go and for lapsed subscriptions. */
  subscribed: boolean;
  subscriptionStatus: string | null;
};

export type ShellQuota = {
  periodStart: string;
  periodEnd: string;
  weightedTokensUsed: number;
  weightedTokensIncluded: number;
  computeHoursUsed: number;
  computeHoursIncluded: number;
  spendMicroUsd: number;
  balanceMicroUsd: number;
  activeSandboxes: number;
  maxActiveSandboxes: number;
};

export type ShellTeamOption = {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  role: TeamRole;
  planName: string;
  planTier: PlanTier;
};

export type ShellProjectRef = {
  id: string;
  name: string;
  slug: string;
  runtimeTarget: RuntimeTarget;
  archived: boolean;
};

export type ShellNotification = {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body: string;
  actionLabel: string | null;
  actionHref: string | null;
  read: boolean;
  createdAt: string;
};

/** The two platform-wide switches an operator can reach the whole app with. */
export type ShellPlatformNotices = {
  /** Operator-authored text for the top of every page. Empty means "nothing". */
  announcement: string;
  /** True while the API is refusing writes from everyone but platform admins. */
  maintenanceMode: boolean;
};

export type ShellContext = {
  plan: ShellPlan;
  quota: ShellQuota;
  teams: ShellTeamOption[];
  projects: ShellProjectRef[];
  notifications: ShellNotification[];
  unreadNotifications: number;
  platform: ShellPlatformNotices;
};

/** Sandbox states that occupy a slot against the plan's concurrency limit. */
const LIVE_SANDBOX_STATES = [
  'creating',
  'starting',
  'running',
  'sleeping',
  'stopping',
] as const;

/** Calendar month, used whenever there is no subscription to anchor to. */
function calendarPeriod(now = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

async function loadPlanForTeam(teamId: string): Promise<{
  plan: ShellPlan;
  periodStart: Date;
  periodEnd: Date;
}> {
  const [row] = await db
    .select({ subscription: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.teamId, teamId))
    .limit(1);

  const fallback = row
    ? null
    : ((await db.select().from(plans).where(eq(plans.tier, 'payg')).limit(1))[0] ?? null);

  const planRow = row?.plan ?? fallback;
  const status = row?.subscription.status ?? null;
  const subscribed =
    Boolean(row) && ['active', 'trialing'].includes(status ?? '') && planRow?.tier !== 'payg';

  const period =
    row && row.subscription.currentPeriodEnd.getTime() > Date.now()
      ? { start: row.subscription.currentPeriodStart, end: row.subscription.currentPeriodEnd }
      : calendarPeriod();

  return {
    plan: {
      id: planRow?.id ?? 'plan_unconfigured',
      key: planRow?.key ?? 'payg',
      name: planRow?.name ?? 'Pay as you go',
      tier: planRow?.tier ?? 'payg',
      includedWeightedTokens: subscribed ? (planRow?.includedWeightedTokens ?? 0) : 0,
      includedComputeHours: subscribed ? (planRow?.includedComputeHours ?? 0) : 0,
      maxActiveSandboxes: planRow?.maxActiveSandboxes ?? 1,
      maxProjects: planRow?.maxProjects ?? 10,
      maxTeamMembers: planRow?.maxTeamMembers ?? 1,
      subscribed,
      subscriptionStatus: status,
    },
    periodStart: period.start,
    periodEnd: period.end,
  };
}

/** Plan name/tier for every team in the switcher, in one query. */
async function loadTeamPlans(
  teamIds: string[],
): Promise<Map<string, { name: string; tier: PlanTier }>> {
  if (teamIds.length === 0) return new Map();

  const rows = await db
    .select({
      teamId: subscriptions.teamId,
      status: subscriptions.status,
      name: plans.name,
      tier: plans.tier,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(inArray(subscriptions.teamId, teamIds));

  const out = new Map<string, { name: string; tier: PlanTier }>();
  for (const row of rows) {
    const live = ['active', 'trialing'].includes(row.status);
    out.set(
      row.teamId,
      live ? { name: row.name, tier: row.tier } : { name: 'Pay as you go', tier: 'payg' },
    );
  }
  return out;
}

export const loadShellContext = cache(async function loadShellContext(
  userId: string,
  teamId: string,
): Promise<ShellContext> {
  const { plan, periodStart, periodEnd } = await loadPlanForTeam(teamId);

  const [
    periodRow,
    balanceRow,
    sandboxCountRow,
    memberships,
    projectRows,
    notificationRows,
    announcement,
    maintenanceMode,
  ] = await Promise.all([
    db
      .select()
      .from(usagePeriods)
      .where(and(eq(usagePeriods.teamId, teamId), lte(usagePeriods.periodStart, new Date())))
      .orderBy(desc(usagePeriods.periodStart))
      .limit(1),
    db.select().from(paygBalances).where(eq(paygBalances.teamId, teamId)).limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxes)
      .where(
        and(eq(sandboxes.teamId, teamId), inArray(sandboxes.status, [...LIVE_SANDBOX_STATES])),
      ),
    listUserTeams(userId),
    db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        runtimeTarget: projects.runtimeTarget,
        archivedAt: projects.archivedAt,
      })
      .from(projects)
      .where(eq(projects.teamId, teamId))
      .orderBy(desc(projects.lastOpenedAt), desc(projects.updatedAt))
      .limit(60),
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(12),
    // Both are served from the 30-second settings cache, so the chrome pays a
    // query for them at most twice a minute per process rather than per page.
    getSetting(
      SETTING_KEYS.platformAnnouncement,
      settingDefault(SETTING_KEYS.platformAnnouncement),
    ),
    getSetting(
      SETTING_KEYS.platformMaintenanceMode,
      settingDefault(SETTING_KEYS.platformMaintenanceMode),
    ),
  ]);

  const period = periodRow[0];
  // A stale row from a previous month must not be read as this month's usage.
  const currentPeriod = period && period.periodEnd.getTime() > Date.now() ? period : null;

  const teamPlans = await loadTeamPlans(memberships.map((m) => m.team.id));

  return {
    plan,
    quota: {
      periodStart: (currentPeriod?.periodStart ?? periodStart).toISOString(),
      periodEnd: (currentPeriod?.periodEnd ?? periodEnd).toISOString(),
      weightedTokensUsed: currentPeriod?.weightedTokensUsed ?? 0,
      weightedTokensIncluded: plan.includedWeightedTokens,
      computeHoursUsed: currentPeriod?.computeHoursUsed ?? 0,
      computeHoursIncluded: plan.includedComputeHours,
      spendMicroUsd:
        (currentPeriod?.modelChargedMicroUsd ?? 0) +
        (currentPeriod?.computeChargedMicroUsd ?? 0),
      balanceMicroUsd: balanceRow[0]?.balanceMicroUsd ?? 0,
      activeSandboxes: sandboxCountRow[0]?.count ?? 0,
      maxActiveSandboxes: plan.maxActiveSandboxes,
    },
    teams: memberships.map((m) => {
      const teamPlan = teamPlans.get(m.team.id);
      return {
        id: m.team.id,
        name: m.team.name,
        slug: m.team.slug,
        isPersonal: m.team.isPersonal,
        role: m.role,
        planName: teamPlan?.name ?? 'Pay as you go',
        planTier: teamPlan?.tier ?? 'payg',
      };
    }),
    projects: projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      runtimeTarget: p.runtimeTarget,
      archived: p.archivedAt !== null,
    })),
    notifications: notificationRows.map((n) => ({
      id: n.id,
      level: n.level,
      title: n.title,
      body: n.body,
      actionLabel: n.actionLabel,
      actionHref: n.actionHref,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadNotifications: notificationRows.filter((n) => n.readAt === null).length,
    platform: {
      // A field cleared back to spaces means the operator has nothing to say,
      // and a bar holding one space is exactly the empty bar not worth drawing.
      announcement: announcement.trim(),
      maintenanceMode,
    },
  };
});

/* ------------------------------------------------------------------ *
 *  Project templates
 * ------------------------------------------------------------------ */

export type TemplateOption = {
  key: string;
  name: string;
  description: string;
  icon: string;
  language: string;
  tags: string[];
  devPort: number | null;
};

/**
 * Templates come from the `project.templates` admin setting so an operator can
 * add one without a deploy. The compiled seeds are the fallback, which is what
 * makes a fresh install usable before `npm run db:seed` has ever run.
 *
 * Only the card-facing fields cross to the client — the seed carries the full
 * file contents of every scaffold and none of that belongs in a bundle.
 */
export const loadProjectTemplates = cache(async function loadProjectTemplates(): Promise<
  TemplateOption[]
> {
  const { PROJECT_TEMPLATE_SEEDS } = await import('@/lib/db/seed-data/templates');
  const { PROJECT_TEMPLATES_SETTING_KEY } = await import('@/lib/db/seed-data/admin-settings');
  const { getSetting } = await import('@/lib/settings');

  const stored = await getSetting<unknown>(PROJECT_TEMPLATES_SETTING_KEY, null);
  const source = Array.isArray(stored) && stored.length > 0 ? stored : PROJECT_TEMPLATE_SEEDS;

  const out: TemplateOption[] = [];
  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Partial<TemplateOption> & { sortOrder?: number };
    if (typeof t.key !== 'string' || typeof t.name !== 'string') continue;
    out.push({
      key: t.key,
      name: t.name,
      description: typeof t.description === 'string' ? t.description : '',
      icon: typeof t.icon === 'string' ? t.icon : 'file',
      language: typeof t.language === 'string' ? t.language : 'Any',
      tags: Array.isArray(t.tags)
        ? t.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
      devPort: typeof t.devPort === 'number' ? t.devPort : null,
    });
  }
  return out;
});

/* ------------------------------------------------------------------ *
 *  Models
 * ------------------------------------------------------------------ */

export type ModelOption = {
  id: string;
  slug: string;
  displayName: string;
  family: string;
  description: string;
  contextWindow: number;
  supportsVision: boolean;
  isDefault: boolean;
  minPlanTier: PlanTier;
  inputMicroUsdPerMtok: number;
  outputMicroUsdPerMtok: number;
};

/** Enabled models with their *current* price row (`effectiveTo IS NULL`). */
export const loadModelOptions = cache(async function loadModelOptions(): Promise<
  ModelOption[]
> {
  const { models, modelPrices } = await import('@/lib/db/schema');

  const rows = await db
    .select({
      id: models.id,
      slug: models.slug,
      displayName: models.displayName,
      family: models.family,
      description: models.description,
      contextWindow: models.contextWindow,
      supportsVision: models.supportsVision,
      isDefault: models.isDefault,
      minPlanTier: models.minPlanTier,
      sortOrder: models.sortOrder,
      inputMicroUsdPerMtok: modelPrices.inputMicroUsdPerMtok,
      outputMicroUsdPerMtok: modelPrices.outputMicroUsdPerMtok,
    })
    .from(models)
    .leftJoin(
      modelPrices,
      and(eq(modelPrices.modelId, models.id), isNull(modelPrices.effectiveTo)),
    )
    .where(eq(models.isEnabled, true))
    .orderBy(models.family, models.sortOrder, models.displayName);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    family: r.family,
    description: r.description,
    contextWindow: r.contextWindow,
    supportsVision: r.supportsVision,
    isDefault: r.isDefault,
    minPlanTier: r.minPlanTier,
    inputMicroUsdPerMtok: r.inputMicroUsdPerMtok ?? 0,
    outputMicroUsdPerMtok: r.outputMicroUsdPerMtok ?? 0,
  }));
});

/* ------------------------------------------------------------------ *
 *  Plans
 * ------------------------------------------------------------------ */

export type PlanOption = {
  id: string;
  key: string;
  name: string;
  tier: PlanTier;
  tagline: string;
  priceMicroUsdMonthly: number;
  includedWeightedTokens: number;
  includedComputeHours: number;
  maxActiveSandboxes: number;
  maxTeamMembers: number;
  features: string[];
  highlight: boolean;
};

export const loadPlanOptions = cache(async function loadPlanOptions(): Promise<PlanOption[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, true), eq(plans.isPublic, true)))
    .orderBy(plans.sortOrder, plans.priceMicroUsdMonthly);

  return rows.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    tier: p.tier,
    tagline: p.tagline,
    priceMicroUsdMonthly: p.priceMicroUsdMonthly,
    includedWeightedTokens: p.includedWeightedTokens,
    includedComputeHours: p.includedComputeHours,
    maxActiveSandboxes: p.maxActiveSandboxes,
    maxTeamMembers: p.maxTeamMembers,
    features: p.features,
    highlight: p.highlight,
  }));
});

/* ------------------------------------------------------------------ *
 *  Own-server workers
 * ------------------------------------------------------------------ */

export type WorkerOption = {
  id: string;
  name: string;
  status: string;
  hostname: string | null;
};

/** Registered BYOS servers a project can be pinned to. */
export const loadWorkerOptions = cache(async function loadWorkerOptions(
  teamId: string,
): Promise<WorkerOption[]> {
  const { byosWorkers } = await import('@/lib/db/schema');

  const rows = await db
    .select({
      id: byosWorkers.id,
      name: byosWorkers.name,
      status: byosWorkers.status,
      hostname: byosWorkers.hostname,
    })
    .from(byosWorkers)
    .where(and(eq(byosWorkers.teamId, teamId), ne(byosWorkers.status, 'revoked')))
    .orderBy(byosWorkers.name);

  return rows;
});

/* ------------------------------------------------------------------ *
 *  Dashboard
 * ------------------------------------------------------------------ */

export type RecentProject = {
  id: string;
  name: string;
  description: string;
  template: string;
  runtimeTarget: RuntimeTarget;
  lastActivityAt: string;
  sandboxStatus: string | null;
};

export async function loadRecentProjects(teamId: string, limit = 6): Promise<RecentProject[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      template: projects.template,
      runtimeTarget: projects.runtimeTarget,
      lastOpenedAt: projects.lastOpenedAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(and(eq(projects.teamId, teamId), isNull(projects.archivedAt)))
    .orderBy(desc(projects.lastOpenedAt), desc(projects.updatedAt))
    .limit(limit);

  const statuses = await loadSandboxStatusByProject(
    teamId,
    rows.map((r) => r.id),
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    template: r.template,
    runtimeTarget: r.runtimeTarget,
    lastActivityAt: (r.lastOpenedAt ?? r.updatedAt).toISOString(),
    sandboxStatus: statuses.get(r.id) ?? null,
  }));
}

/**
 * One live sandbox status per project. A project can own several machines over
 * its life; the most recently touched one is the one whose state the card
 * should reflect.
 */
export async function loadSandboxStatusByProject(
  teamId: string,
  projectIds: string[],
): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();

  const rows = await db
    .select({
      projectId: sandboxes.projectId,
      status: sandboxes.status,
      updatedAt: sandboxes.updatedAt,
    })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.teamId, teamId),
        inArray(sandboxes.projectId, projectIds),
        ne(sandboxes.status, 'destroyed'),
      ),
    )
    .orderBy(desc(sandboxes.updatedAt));

  const out = new Map<string, string>();
  for (const row of rows) {
    if (!row.projectId || out.has(row.projectId)) continue;
    out.set(row.projectId, row.status);
  }
  return out;
}

export type RecentRun = {
  id: string;
  title: string;
  status: string;
  mode: string;
  projectId: string;
  projectName: string;
  weightedTokens: number;
  chargedMicroUsd: number;
  createdAt: string;
  finishedAt: string | null;
};

export async function loadRecentRuns(teamId: string, limit = 6): Promise<RecentRun[]> {
  const { agentRuns } = await import('@/lib/db/schema');

  const rows = await db
    .select({
      id: agentRuns.id,
      title: agentRuns.title,
      status: agentRuns.status,
      mode: agentRuns.mode,
      projectId: agentRuns.projectId,
      projectName: projects.name,
      weightedTokens: agentRuns.totalWeightedTokens,
      chargedMicroUsd: agentRuns.totalChargedMicroUsd,
      createdAt: agentRuns.createdAt,
      finishedAt: agentRuns.finishedAt,
    })
    .from(agentRuns)
    .innerJoin(projects, eq(projects.id, agentRuns.projectId))
    .where(eq(agentRuns.teamId, teamId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}

export type ActiveSandbox = {
  id: string;
  name: string;
  status: string;
  statusMessage: string | null;
  projectId: string | null;
  projectName: string | null;
  cpuCores: number;
  memoryMb: number;
  cpuPercent: number;
  memoryUsedMb: number;
  lastActiveAt: string | null;
};

export async function loadActiveSandboxes(teamId: string, limit = 5): Promise<ActiveSandbox[]> {
  const rows = await db
    .select({
      id: sandboxes.id,
      name: sandboxes.name,
      status: sandboxes.status,
      statusMessage: sandboxes.statusMessage,
      projectId: sandboxes.projectId,
      projectName: projects.name,
      cpuCores: sandboxes.cpuCores,
      memoryMb: sandboxes.memoryMb,
      cpuPercent: sandboxes.cpuPercent,
      memoryUsedMb: sandboxes.memoryUsedMb,
      lastActiveAt: sandboxes.lastActiveAt,
    })
    .from(sandboxes)
    .leftJoin(projects, eq(projects.id, sandboxes.projectId))
    .where(
      and(eq(sandboxes.teamId, teamId), inArray(sandboxes.status, [...LIVE_SANDBOX_STATES])),
    )
    .orderBy(desc(sandboxes.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    lastActiveAt: r.lastActiveAt?.toISOString() ?? null,
  }));
}

export type UsagePoint = {
  date: string;
  weightedTokens: number;
  chargedMicroUsd: number;
};

/** Fourteen dense days — gaps are filled with zeros so the axis never lies. */
export async function loadUsageTrend(teamId: string, days = 14): Promise<UsagePoint[]> {
  const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);

  const { usageEvents, computeEvents } = await import('@/lib/db/schema');

  const [modelRows, computeRows] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(${usageEvents.occurredAt}, 'YYYY-MM-DD')`,
        weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
        chargedMicroUsd: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
      })
      .from(usageEvents)
      .where(and(eq(usageEvents.teamId, teamId), gte(usageEvents.occurredAt, since)))
      .groupBy(sql`1`),
    db
      .select({
        date: sql<string>`to_char(${computeEvents.occurredAt}, 'YYYY-MM-DD')`,
        chargedMicroUsd: sql<number>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)::bigint`,
      })
      .from(computeEvents)
      .where(and(eq(computeEvents.teamId, teamId), gte(computeEvents.occurredAt, since)))
      .groupBy(sql`1`),
  ]);

  const byDate = new Map<string, UsagePoint>();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = day.toISOString().slice(0, 10);
    byDate.set(key, { date: key, weightedTokens: 0, chargedMicroUsd: 0 });
  }

  for (const row of modelRows) {
    const point = byDate.get(row.date);
    if (!point) continue;
    point.weightedTokens += Number(row.weightedTokens);
    point.chargedMicroUsd += Number(row.chargedMicroUsd);
  }
  for (const row of computeRows) {
    const point = byDate.get(row.date);
    if (!point) continue;
    point.chargedMicroUsd += Number(row.chargedMicroUsd);
  }

  return [...byDate.values()];
}
