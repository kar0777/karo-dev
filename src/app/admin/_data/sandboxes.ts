import 'server-only';

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { computeEvents, projects, sandboxes, teams, type SandboxStatus } from '@/lib/db/schema';

import { toNumber } from './period';

/** Fleet view: every sandbox on the platform, whoever owns it. */

export type AdminSandboxRow = {
  id: string;
  name: string;
  status: string;
  statusMessage: string | null;
  provider: string;
  teamId: string;
  teamName: string;
  projectId: string | null;
  projectName: string | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  computeMultiplier: number;
  cpuPercent: number;
  memoryUsedMb: number;
  totalActiveSeconds: number;
  /** Seconds since the current running window started; 0 when not running. */
  uptimeSeconds: number;
  lifetimeChargedMicroUsd: number;
  lifetimeUpstreamMicroUsd: number;
  createdAt: string;
  lastActiveAt: string | null;
};

export type AdminSandboxStats = {
  total: number;
  running: number;
  sleeping: number;
  failed: number;
  totalMemoryMb: number;
  totalCpuCores: number;
  computeHoursToday: number;
  chargedTodayMicroUsd: number;
};

const LIVE_STATUSES: SandboxStatus[] = [
  'creating',
  'starting',
  'running',
  'sleeping',
  'stopping',
];

export const SANDBOX_STATUS_VALUES: SandboxStatus[] = [
  'creating',
  'starting',
  'running',
  'sleeping',
  'stopping',
  'stopped',
  'failed',
  'destroyed',
];

function asSandboxStatus(value: string): SandboxStatus | null {
  return (SANDBOX_STATUS_VALUES as string[]).includes(value) ? (value as SandboxStatus) : null;
}

export async function loadSandboxFleet(options: {
  status?: string;
  provider?: string;
  limit?: number;
}): Promise<AdminSandboxRow[]> {
  const clauses = [];
  if (options.status && options.status !== 'all') {
    if (options.status === 'live') {
      clauses.push(inArray(sandboxes.status, LIVE_STATUSES));
    } else {
      const status = asSandboxStatus(options.status);
      if (status) clauses.push(eq(sandboxes.status, status));
    }
  }
  if (options.provider && options.provider !== 'all') {
    clauses.push(eq(sandboxes.provider, options.provider));
  }

  const rows = await db
    .select({
      sandbox: sandboxes,
      teamName: teams.name,
      projectName: projects.name,
    })
    .from(sandboxes)
    .innerJoin(teams, eq(teams.id, sandboxes.teamId))
    .leftJoin(projects, eq(projects.id, sandboxes.projectId))
    .where(clauses.length > 0 ? and(...clauses) : undefined)
    .orderBy(desc(sandboxes.updatedAt))
    .limit(options.limit ?? 200);

  const ids = rows.map((r) => r.sandbox.id);
  const costRows =
    ids.length > 0
      ? await db
          .select({
            sandboxId: computeEvents.sandboxId,
            charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
            upstream: sql<string>`coalesce(sum(${computeEvents.upstreamCostMicroUsd}), 0)`,
          })
          .from(computeEvents)
          .where(inArray(computeEvents.sandboxId, ids))
          .groupBy(computeEvents.sandboxId)
      : [];

  const costById = new Map(costRows.map((r) => [r.sandboxId ?? '', r]));
  const now = Date.now();

  return rows.map(({ sandbox, teamName, projectName }) => {
    const cost = costById.get(sandbox.id);
    const running = sandbox.status === 'running';
    const uptimeSeconds =
      running && sandbox.startedAt
        ? Math.max(0, Math.round((now - sandbox.startedAt.getTime()) / 1000))
        : 0;

    return {
      id: sandbox.id,
      name: sandbox.name,
      status: sandbox.status,
      statusMessage: sandbox.statusMessage,
      provider: sandbox.provider,
      teamId: sandbox.teamId,
      teamName,
      projectId: sandbox.projectId,
      projectName,
      cpuCores: sandbox.cpuCores,
      memoryMb: sandbox.memoryMb,
      diskGb: sandbox.diskGb,
      computeMultiplier: sandbox.computeMultiplier,
      cpuPercent: sandbox.cpuPercent,
      memoryUsedMb: sandbox.memoryUsedMb,
      totalActiveSeconds: sandbox.totalActiveSeconds,
      uptimeSeconds,
      lifetimeChargedMicroUsd: toNumber(cost?.charged),
      lifetimeUpstreamMicroUsd: toNumber(cost?.upstream),
      createdAt: sandbox.createdAt.toISOString(),
      lastActiveAt: sandbox.lastActiveAt?.toISOString() ?? null,
    };
  });
}

export async function loadSandboxStats(): Promise<AdminSandboxStats> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [fleetRows, todayRows] = await Promise.all([
    db
      .select({
        total: sql<string>`count(*)`,
        running: sql<string>`count(*) filter (where ${sandboxes.status} = 'running')`,
        sleeping: sql<string>`count(*) filter (where ${sandboxes.status} = 'sleeping')`,
        failed: sql<string>`count(*) filter (where ${sandboxes.status} = 'failed')`,
        memory: sql<string>`coalesce(sum(${sandboxes.memoryMb}) filter (where ${sandboxes.status} = 'running'), 0)`,
        cpu: sql<string>`coalesce(sum(${sandboxes.cpuCores}) filter (where ${sandboxes.status} = 'running'), 0)`,
      })
      .from(sandboxes)
      .where(inArray(sandboxes.status, LIVE_STATUSES)),
    db
      .select({
        hours: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
        charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
      })
      .from(computeEvents)
      .where(gte(computeEvents.occurredAt, startOfDay)),
  ]);

  const fleet = fleetRows[0];
  const today = todayRows[0];

  return {
    total: toNumber(fleet?.total),
    running: toNumber(fleet?.running),
    sleeping: toNumber(fleet?.sleeping),
    failed: toNumber(fleet?.failed),
    totalMemoryMb: toNumber(fleet?.memory),
    totalCpuCores: toNumber(fleet?.cpu),
    computeHoursToday: toNumber(today?.hours),
    chargedTodayMicroUsd: toNumber(today?.charged),
  };
}

/** Distinct provider keys currently present in the fleet, for the filter. */
export async function sandboxProviderKeys(): Promise<string[]> {
  const rows = await db
    .select({ provider: sandboxes.provider })
    .from(sandboxes)
    .groupBy(sandboxes.provider);
  return rows.map((r) => r.provider).sort();
}
