import 'server-only';

import { and, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  agentRuns,
  auditEvents,
  computeEvents,
  plans,
  projects,
  subscriptions,
  teamMembers,
  teams,
  usageEvents,
  users,
} from '@/lib/db/schema';

import { toNumber } from './period';

/**
 * User administration reads.
 *
 * The list is deliberately server-driven: search and paging live in the URL so
 * a support conversation can be resumed by pasting a link, and so the table
 * works with JavaScript still loading.
 */

export const USERS_PAGE_SIZE = 25;

export type UserStatusFilter = 'all' | 'active' | 'suspended';
export type UserRoleFilter = 'all' | 'user' | 'admin';

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  platformRole: 'user' | 'admin';
  isSuspended: boolean;
  isDemo: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  teamId: string | null;
  teamName: string | null;
  teamSlug: string | null;
  planName: string;
  planTier: string;
  subscriptionStatus: string | null;
  teamCount: number;
};

export type AdminUserListQuery = {
  q?: string;
  page: number;
  status: UserStatusFilter;
  role: UserRoleFilter;
};

export type AdminUserList = {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageCount: number;
};

function listFilters(query: AdminUserListQuery) {
  const clauses = [];
  const term = query.q?.trim();
  if (term) {
    const pattern = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    clauses.push(or(ilike(users.email, pattern), ilike(users.name, pattern)));
  }
  if (query.status === 'active') clauses.push(eq(users.isSuspended, false));
  if (query.status === 'suspended') clauses.push(eq(users.isSuspended, true));
  if (query.role !== 'all') clauses.push(eq(users.platformRole, query.role));
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export async function listAdminUsers(query: AdminUserListQuery): Promise<AdminUserList> {
  const where = listFilters(query);
  const page = Math.max(1, query.page);

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(users).where(where),
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        platformRole: users.platformRole,
        isSuspended: users.isSuspended,
        isDemo: users.isDemo,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(USERS_PAGE_SIZE)
      .offset((page - 1) * USERS_PAGE_SIZE),
  ]);

  const total = totalRows[0]?.value ?? 0;
  const userIds = rows.map((row) => row.id);

  const memberships =
    userIds.length > 0
      ? await db
          .select({
            userId: teamMembers.userId,
            teamId: teams.id,
            teamName: teams.name,
            teamSlug: teams.slug,
            isPersonal: teams.isPersonal,
            planName: plans.name,
            planTier: plans.tier,
            subscriptionStatus: subscriptions.status,
          })
          .from(teamMembers)
          .innerJoin(teams, eq(teams.id, teamMembers.teamId))
          .leftJoin(subscriptions, eq(subscriptions.teamId, teams.id))
          .leftJoin(plans, eq(plans.id, subscriptions.planId))
          .where(inArray(teamMembers.userId, userIds))
      : [];

  const byUser = new Map<string, typeof memberships>();
  for (const row of memberships) {
    const bucket = byUser.get(row.userId);
    if (bucket) bucket.push(row);
    else byUser.set(row.userId, [row]);
  }

  return {
    rows: rows.map((row) => {
      const owned = byUser.get(row.id) ?? [];
      // The personal team is the billing entity for a solo user; fall back to
      // whichever team they joined first when they have no personal one.
      const primary = owned.find((t) => t.isPersonal) ?? owned[0];
      return {
        id: row.id,
        email: row.email,
        name: row.name,
        platformRole: row.platformRole,
        isSuspended: row.isSuspended,
        isDemo: row.isDemo,
        emailVerified: row.emailVerifiedAt !== null,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        teamId: primary?.teamId ?? null,
        teamName: primary?.teamName ?? null,
        teamSlug: primary?.teamSlug ?? null,
        planName: primary?.planName ?? 'Pay as you go',
        planTier: primary?.planTier ?? 'payg',
        subscriptionStatus: primary?.subscriptionStatus ?? null,
        teamCount: owned.length,
      };
    }),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)),
  };
}

/* ------------------------------------------------------------------ *
 *  Detail
 * ------------------------------------------------------------------ */

export type AdminUserTeam = {
  teamId: string;
  name: string;
  slug: string;
  role: string;
  isPersonal: boolean;
  planName: string;
  planTier: string;
  subscriptionStatus: string | null;
  projectCount: number;
};

export type AdminUserRun = {
  id: string;
  title: string;
  status: string;
  mode: string;
  weightedTokens: number;
  chargedMicroUsd: number;
  createdAt: string;
};

export type AdminUserAudit = {
  id: string;
  action: string;
  summary: string;
  severity: string;
  createdAt: string;
};

export type AdminUserDetail = {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    platformRole: 'user' | 'admin';
    isSuspended: boolean;
    isDemo: boolean;
    emailVerified: boolean;
    locale: string;
    createdAt: string;
    lastSeenAt: string | null;
  };
  teams: AdminUserTeam[];
  totals: {
    weightedTokens: number;
    modelChargedMicroUsd: number;
    modelUpstreamMicroUsd: number;
    computeHours: number;
    computeChargedMicroUsd: number;
    runs: number;
    lifetimeSpentMicroUsd: number;
  };
  recentRuns: AdminUserRun[];
  auditTrail: AdminUserAudit[];
};

export async function loadAdminUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user) return null;

  const [membershipRows, usageRow, computeRow, runRows, auditRows, projectRows] =
    await Promise.all([
      db
        .select({
          teamId: teams.id,
          name: teams.name,
          slug: teams.slug,
          isPersonal: teams.isPersonal,
          role: teamMembers.role,
          planName: plans.name,
          planTier: plans.tier,
          subscriptionStatus: subscriptions.status,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .leftJoin(subscriptions, eq(subscriptions.teamId, teams.id))
        .leftJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(teamMembers.userId, userId)),
      db
        .select({
          weighted: sql<string>`coalesce(sum(${usageEvents.weightedTokens}), 0)`,
          charged: sql<string>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)`,
          upstream: sql<string>`coalesce(sum(${usageEvents.upstreamCostMicroUsd}), 0)`,
        })
        .from(usageEvents)
        .where(eq(usageEvents.userId, userId)),
      db
        .select({
          hours: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
          charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
        })
        .from(computeEvents)
        .where(eq(computeEvents.userId, userId)),
      db
        .select({
          id: agentRuns.id,
          title: agentRuns.title,
          status: agentRuns.status,
          mode: agentRuns.mode,
          weightedTokens: agentRuns.totalWeightedTokens,
          chargedMicroUsd: agentRuns.totalChargedMicroUsd,
          createdAt: agentRuns.createdAt,
        })
        .from(agentRuns)
        .where(eq(agentRuns.userId, userId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(10),
      db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          summary: auditEvents.summary,
          severity: auditEvents.severity,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.userId, userId))
        .orderBy(desc(auditEvents.createdAt))
        .limit(20),
      db
        .select({ teamId: projects.teamId, value: count() })
        .from(projects)
        .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
        .where(eq(teamMembers.userId, userId))
        .groupBy(projects.teamId),
    ]);

  const runCountRows = await db
    .select({ value: count() })
    .from(agentRuns)
    .where(eq(agentRuns.userId, userId));

  const projectCounts = new Map(projectRows.map((r) => [r.teamId, r.value]));

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole,
      isSuspended: user.isSuspended,
      isDemo: user.isDemo,
      emailVerified: user.emailVerifiedAt !== null,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    },
    teams: membershipRows.map((row) => ({
      teamId: row.teamId,
      name: row.name,
      slug: row.slug,
      role: row.role,
      isPersonal: row.isPersonal,
      planName: row.planName ?? 'Pay as you go',
      planTier: row.planTier ?? 'payg',
      subscriptionStatus: row.subscriptionStatus ?? null,
      projectCount: projectCounts.get(row.teamId) ?? 0,
    })),
    totals: {
      weightedTokens: toNumber(usageRow[0]?.weighted),
      modelChargedMicroUsd: toNumber(usageRow[0]?.charged),
      modelUpstreamMicroUsd: toNumber(usageRow[0]?.upstream),
      computeHours: toNumber(computeRow[0]?.hours),
      computeChargedMicroUsd: toNumber(computeRow[0]?.charged),
      runs: runCountRows[0]?.value ?? 0,
      lifetimeSpentMicroUsd: toNumber(usageRow[0]?.charged) + toNumber(computeRow[0]?.charged),
    },
    recentRuns: runRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      mode: row.mode,
      weightedTokens: row.weightedTokens,
      chargedMicroUsd: row.chargedMicroUsd,
      createdAt: row.createdAt.toISOString(),
    })),
    auditTrail: auditRows.map((row) => ({
      id: row.id,
      action: row.action,
      summary: row.summary,
      severity: row.severity,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/** Headline counters above the users table. */
export async function loadUserStats(since: Date) {
  const rows = await db
    .select({
      total: sql<string>`count(*)`,
      suspended: sql<string>`count(*) filter (where ${users.isSuspended})`,
      admins: sql<string>`count(*) filter (where ${users.platformRole} = 'admin')`,
      recent: sql<string>`count(*) filter (where ${users.createdAt} >= ${since})`,
    })
    .from(users);

  const row = rows[0];
  return {
    total: toNumber(row?.total),
    suspended: toNumber(row?.suspended),
    admins: toNumber(row?.admins),
    recent: toNumber(row?.recent),
  };
}

/** Users seen in the last 24h — the "is anyone home?" number. */
export async function countActiveUsers(since: Date): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(users)
    .where(gte(users.lastSeenAt, since));
  return rows[0]?.value ?? 0;
}
