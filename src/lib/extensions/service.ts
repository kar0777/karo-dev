import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { NotFoundError, QuotaExceededError } from '@/lib/api/errors';
import { decryptJson, encryptJson } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import {
  installedPlugins,
  installedSkills,
  mcpServers,
  plans,
  projects,
  subscriptions,
  type Plan,
  type PlanTier,
} from '@/lib/db/schema';
import { DEFAULT_AGENT_PERMISSIONS } from '@/lib/agent/policy';
import type { PlanLimitsView, ProjectOptionView } from '@/lib/extensions/types';

/**
 * Shared server helpers for the extensions slice.
 *
 * Plan limits live in the `plans` table — never hard-coded in a component — so
 * everything that gates an install goes through `loadTeamPlan` and one of the
 * `assert*` helpers below. They throw `QuotaExceededError`, which the API layer
 * turns into a 402 with copy that says which plan lifts the limit.
 */

export const PLAN_TIER_ORDER: Record<PlanTier, number> = {
  payg: 0,
  lite: 1,
  pro: 2,
  scale: 3,
  ultra: 4,
};

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  payg: 'Pay as you go',
  lite: 'Lite',
  pro: 'Pro',
  scale: 'Scale',
  ultra: 'Ultra',
};

export function tierAtLeast(actual: PlanTier, required: PlanTier): boolean {
  return PLAN_TIER_ORDER[actual] >= PLAN_TIER_ORDER[required];
}

/**
 * Reads a dynamic segment. Next hands them through as `string | string[]`, and
 * a missing segment can only mean the route was called in a way that does not
 * address a resource — a 404 is the honest answer, not a 500.
 */
export function pathParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new NotFoundError('Not found.');
  return value;
}

/**
 * The team's current plan. Falls back to the pay-as-you-go row when there is no
 * subscription, and to a synthetic minimal plan when the catalogue has not been
 * seeded — a missing seed should degrade the limits, not crash the page.
 */
export async function loadTeamPlan(teamId: string): Promise<Plan> {
  const [row] = await db
    .select({ plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.teamId, teamId))
    .limit(1);

  if (row) return row.plan;

  const [payg] = await db.select().from(plans).where(eq(plans.tier, 'payg')).limit(1);
  if (payg) return payg;

  throw new Error('No plan is configured. Run `npm run db:seed`.');
}

export function planLimitsView(plan: Plan): PlanLimitsView {
  return {
    tier: plan.tier,
    name: plan.name,
    maxSkills: plan.maxSkills,
    maxPlugins: plan.maxPlugins,
    maxMcpServers: plan.maxMcpServers,
    maxActiveSandboxes: plan.maxActiveSandboxes,
    maxSandboxCpuCores: plan.maxSandboxCpuCores,
    maxSandboxMemoryMb: plan.maxSandboxMemoryMb,
    allowCustomSandboxSize: plan.allowCustomSandboxSize,
    allowPrivateSkills: plan.allowPrivateSkills,
    allowDocker: plan.allowDocker,
  };
}

async function countRows(
  table: typeof mcpServers | typeof installedSkills | typeof installedPlugins,
  teamId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.teamId, teamId));
  return row?.count ?? 0;
}

export function countMcpServers(teamId: string): Promise<number> {
  return countRows(mcpServers, teamId);
}

export function countInstalledSkills(teamId: string): Promise<number> {
  return countRows(installedSkills, teamId);
}

export function countInstalledPlugins(teamId: string): Promise<number> {
  return countRows(installedPlugins, teamId);
}

function quota(used: number, limit: number, noun: string, plan: Plan): QuotaExceededError {
  return new QuotaExceededError(
    `The ${plan.name} plan includes ${limit} ${noun}${limit === 1 ? '' : 's'} and you already have ${used}. Remove one, or upgrade the plan to add more.`,
    { details: { used, limit, planKey: plan.key } },
  );
}

export async function assertMcpServerQuota(teamId: string, plan: Plan): Promise<void> {
  const used = await countMcpServers(teamId);
  if (used >= plan.maxMcpServers) throw quota(used, plan.maxMcpServers, 'MCP server', plan);
}

export async function assertSkillQuota(teamId: string, plan: Plan): Promise<void> {
  const used = await countInstalledSkills(teamId);
  if (used >= plan.maxSkills) throw quota(used, plan.maxSkills, 'installed skill', plan);
}

export async function assertPluginQuota(teamId: string, plan: Plan): Promise<void> {
  const used = await countInstalledPlugins(teamId);
  if (used >= plan.maxPlugins) throw quota(used, plan.maxPlugins, 'installed plugin', plan);
}

/**
 * Active projects for a team, in the shape the scope pickers and the agent
 * permission matrix both need. Archived projects are excluded — you cannot
 * scope a new extension to something that is no longer worked on.
 */
export async function loadProjectOptions(teamId: string): Promise<ProjectOptionView[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      defaultAgentMode: projects.defaultAgentMode,
      defaultModelId: projects.defaultModelId,
      permissions: projects.permissions,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .where(eq(projects.teamId, teamId))
    .orderBy(asc(projects.name));

  return rows
    .filter((row) => row.archivedAt === null)
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      defaultAgentMode: row.defaultAgentMode,
      defaultModelId: row.defaultModelId,
      permissions: normaliseAgentPermissions(row.permissions),
    }));
}

/** Only boolean entries are part of the matrix; list-valued rules live elsewhere. */
function normaliseAgentPermissions(
  stored: Record<string, boolean | string[]> | null,
): Record<string, boolean> {
  const out: Record<string, boolean> = { ...DEFAULT_AGENT_PERMISSIONS };
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Secret envelopes
 * ------------------------------------------------------------------ */

/**
 * Reads the key names out of an encrypted `{key: value}` envelope without ever
 * handing a value to a caller. Returns an empty list for a malformed or
 * key-rotated envelope so a stale row still renders.
 */
export function secretKeyNames(ciphertext: string | null | undefined): string[] {
  if (!ciphertext) return [];
  try {
    return Object.keys(decryptJson<Record<string, string>>(ciphertext)).sort();
  } catch {
    return [];
  }
}

/**
 * Merges a patch into an encrypted secret bag.
 * An empty-string value removes the key — that is how "Replace" clears one.
 * Returns `null` when nothing is left, so the column goes back to NULL.
 */
export function mergeSecrets(
  existingCiphertext: string | null | undefined,
  patch: Record<string, string>,
): string | null {
  let current: Record<string, string> = {};
  if (existingCiphertext) {
    try {
      current = decryptJson<Record<string, string>>(existingCiphertext);
    } catch {
      current = {};
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === '') delete current[key];
    else current[key] = value;
  }

  return Object.keys(current).length > 0 ? encryptJson(current) : null;
}

/** Builds a fresh envelope from scratch. Returns `null` when there is nothing. */
export function buildSecrets(entries: Record<string, string>): string | null {
  const filtered = Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== ''),
  );
  return Object.keys(filtered).length > 0 ? encryptJson(filtered) : null;
}

/* ------------------------------------------------------------------ *
 *  Installation lookups
 * ------------------------------------------------------------------ */

/** Account-scoped installations have a NULL `projectId`, which `eq` cannot match. */
export function scopeCondition(
  column: typeof installedSkills.projectId | typeof installedPlugins.projectId,
  projectId: string | null,
) {
  return projectId === null ? isNull(column) : eq(column, projectId);
}

export async function findInstalledSkill(teamId: string, installationId: string) {
  const [row] = await db
    .select()
    .from(installedSkills)
    .where(and(eq(installedSkills.id, installationId), eq(installedSkills.teamId, teamId)))
    .limit(1);
  return row ?? null;
}

export async function findInstalledPlugin(teamId: string, pluginId: string) {
  const [row] = await db
    .select()
    .from(installedPlugins)
    .where(and(eq(installedPlugins.pluginId, pluginId), eq(installedPlugins.teamId, teamId)))
    .limit(1);
  return row ?? null;
}

/**
 * Semver-ish comparison for the "Update available" badge. Non-numeric parts
 * compare as 0 so a malformed version never claims to be newer.
 */
export function isNewerVersion(candidate: string, installed: string): boolean {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(candidate);
  const b = parse(installed);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}
