export const dynamic = 'force-dynamic';

import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import { BarChart3 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import { deriveWorkerStatus, type WorkerLiveStatus } from '@/lib/account/byos-shared';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { byosWorkers, computeEvents, projects, sandboxes, type Sandbox } from '@/lib/db/schema';
import { can } from '@/lib/rbac/permissions';
import { PROVIDER_META, type SandboxProviderKey } from '@/lib/sandbox';
import { loadBillingContext } from '@/lib/usage/metering';
import { formatHours, formatMicroUsd, formatNumber } from '@/lib/utils';

import { SandboxesView, type SandboxFilter, type TeamSandboxView } from './sandboxes-view';

/**
 * The team's real computers.
 *
 * Every figure here is read at request time from the same tables the metering
 * code writes: `sandboxes` for shape and live telemetry, `compute_events` for
 * what the current billing period has actually cost. Nothing is estimated —
 * a running machine's open window is deliberately shown as uptime rather than
 * money, because it is only priced when it closes.
 *
 * The platform-wide view of the same rows is `/admin/sandboxes`; the status
 * vocabulary is shared through `SANDBOX_STATUS_META`.
 */

export const metadata: Metadata = {
  title: 'Sandboxes',
  description: 'The Linux machines your projects run on, and what their compute has cost.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Matches the cap on `GET /api/sandboxes`. Hitting it is disclosed in the list. */
const LIST_LIMIT = 200;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `sum()` over a bigint or numeric column arrives from postgres.js as a string,
 * so aggregates are coerced rather than trusted — a string reaching
 * `formatMicroUsd` would silently render an em dash where a charge belongs.
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Seconds the open compute window has been running; 0 when there is none. */
function uptimeSeconds(sandbox: Sandbox): number {
  if (sandbox.status !== 'running' || !sandbox.startedAt) return 0;
  return Math.max(0, Math.round((Date.now() - sandbox.startedAt.getTime()) / 1000));
}

/**
 * The provider's user-facing name. `sandboxes.provider` is a plain text column,
 * so a key this build does not know about is shown as itself instead of being
 * mislabelled as something else.
 */
function providerMeta(provider: string): { label: string; billed: boolean } {
  if (!Object.hasOwn(PROVIDER_META, provider)) return { label: provider, billed: true };
  const meta = PROVIDER_META[provider as SandboxProviderKey];
  return { label: meta.label, billed: meta.billed };
}

/** Preview endpoints the provider exposed, recorded on the row at create time. */
function previewUrls(
  metadata: Record<string, unknown> | null,
): { port: string; url: string }[] {
  const exposed = metadata?.exposedPorts;
  if (!exposed || typeof exposed !== 'object') return [];
  return Object.entries(exposed as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([port, url]) => ({ port, url }))
    .sort((a, b) => Number(a.port) - Number(b.port));
}

function toView(
  sandbox: Sandbox,
  projectName: string | null,
  compute: { hours: number; charged: number; windows: number },
  worker: { name: string; status: WorkerLiveStatus } | null,
): TeamSandboxView {
  const provider = providerMeta(sandbox.provider);

  return {
    id: sandbox.id,
    name: sandbox.name,
    status: sandbox.status,
    statusMessage: sandbox.statusMessage,
    providerLabel: provider.label,
    providerBilled: provider.billed,
    projectId: sandbox.projectId,
    projectName,
    cpuCores: sandbox.cpuCores,
    memoryMb: sandbox.memoryMb,
    diskGb: sandbox.diskGb,
    cpuPercent: sandbox.cpuPercent,
    memoryUsedMb: sandbox.memoryUsedMb,
    diskUsedMb: sandbox.diskUsedMb,
    processCount: sandbox.processCount,
    computeMultiplier: sandbox.computeMultiplier,
    autoSleepMinutes: sandbox.autoSleepMinutes,
    networkPolicy: sandbox.networkPolicy,
    allowDocker: sandbox.allowDocker,
    uptimeSeconds: uptimeSeconds(sandbox),
    totalActiveSeconds: sandbox.totalActiveSeconds,
    periodComputeHours: compute.hours,
    periodChargedMicroUsd: compute.charged,
    periodWindows: compute.windows,
    previewUrls: previewUrls(sandbox.metadata),
    worker,
    lastActiveAt: sandbox.lastActiveAt?.toISOString() ?? null,
  };
}

export default async function SandboxesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  const filter: SandboxFilter = firstParam(params.status) === 'all' ? 'all' : 'current';

  // The period boundary drives the compute aggregate below, so billing has to
  // resolve before the rest of the queries can be issued.
  const billing = await loadBillingContext(team.id);
  const plan = billing.plan;

  const [rows, computeRows, workerRows, countRows] = await Promise.all([
    db
      .select({ sandbox: sandboxes, projectName: projects.name })
      .from(sandboxes)
      .leftJoin(projects, eq(projects.id, sandboxes.projectId))
      .where(
        filter === 'all'
          ? eq(sandboxes.teamId, team.id)
          : // Matches the default of `GET /api/sandboxes`: destroyed rows are
            // history, not machines you can act on.
            and(eq(sandboxes.teamId, team.id), ne(sandboxes.status, 'destroyed')),
      )
      .orderBy(desc(sandboxes.updatedAt))
      .limit(LIST_LIMIT),
    db
      .select({
        sandboxId: computeEvents.sandboxId,
        hours: sql<string>`coalesce(sum(${computeEvents.billedComputeHours}), 0)`,
        charged: sql<string>`coalesce(sum(${computeEvents.chargedMicroUsd}), 0)`,
        windows: sql<number>`count(*)::int`,
      })
      .from(computeEvents)
      .where(
        and(
          eq(computeEvents.teamId, team.id),
          gte(computeEvents.occurredAt, billing.periodStart),
        ),
      )
      .groupBy(computeEvents.sandboxId),
    db.select().from(byosWorkers).where(eq(byosWorkers.teamId, team.id)),
    db
      .select({
        occupied: sql<number>`count(*) filter (where ${sandboxes.status} in ('creating', 'starting', 'running', 'sleeping', 'stopping'))::int`,
        running: sql<number>`count(*) filter (where ${sandboxes.status} = 'running')::int`,
        sleeping: sql<number>`count(*) filter (where ${sandboxes.status} = 'sleeping')::int`,
        idle: sql<number>`count(*) filter (where ${sandboxes.status} in ('stopped', 'failed'))::int`,
        // Only used to tell "never had one" apart from "all of them are gone" in
        // the empty state, so the copy cannot claim a destruction that never
        // happened. Free — it rides on the aggregate that is already running.
        destroyed: sql<number>`count(*) filter (where ${sandboxes.status} = 'destroyed')::int`,
      })
      .from(sandboxes)
      .where(eq(sandboxes.teamId, team.id)),
  ]);

  const computeById = new Map(
    computeRows.map((row) => [
      row.sandboxId,
      { hours: toNumber(row.hours), charged: toNumber(row.charged), windows: row.windows },
    ]),
  );
  const workerById = new Map(
    workerRows.map((worker) => [
      worker.id,
      { name: worker.name, status: deriveWorkerStatus(worker) },
    ]),
  );

  const views = rows.map(({ sandbox, projectName }) =>
    toView(
      sandbox,
      projectName,
      computeById.get(sandbox.id) ?? { hours: 0, charged: 0, windows: 0 },
      (sandbox.workerId ? workerById.get(sandbox.workerId) : null) ?? null,
    ),
  );

  // Summed from the same grouped rows the cards read, so the tiles and the list
  // can never disagree about what this period cost.
  const periodCharged = computeRows.reduce((total, row) => total + toNumber(row.charged), 0);
  const periodWindows = computeRows.reduce((total, row) => total + row.windows, 0);

  const counts = countRows[0];
  const occupied = counts?.occupied ?? 0;
  const atLimit = occupied >= plan.maxActiveSandboxes;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Sandboxes"
        description={`The Linux machines your projects run on. Compute is metered only while a machine is running — a sleeping or stopped sandbox costs nothing — and each one puts itself to sleep after ${plan.autoSleepMinutes} minutes without a command.`}
        breadcrumbs={[{ label: 'Karo', href: '/app' }, { label: 'Sandboxes' }]}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/app/usage">
              <BarChart3 aria-hidden="true" />
              Usage
            </Link>
          </Button>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Running now"
          value={formatNumber(counts?.running ?? 0)}
          tone="primary"
          caption={`${formatNumber(counts?.sleeping ?? 0)} asleep · ${formatNumber(counts?.idle ?? 0)} stopped or failed`}
        />
        <Stat
          label="Plan slots in use"
          value={formatNumber(occupied)}
          caption={
            atLimit
              ? `At the ${plan.name} limit of ${formatNumber(plan.maxActiveSandboxes)}. Stop or destroy one before starting another.`
              : `of ${formatNumber(plan.maxActiveSandboxes)} on ${plan.name}. Sleeping machines still hold a slot.`
          }
        />
        <Stat
          label="Compute this period"
          value={formatHours(billing.computeHoursUsed)}
          tone="ember"
          caption={
            billing.hasActiveSubscription
              ? `${formatHours(billing.quotaRemainingComputeHours)} of ${formatHours(plan.includedComputeHours)} included still left`
              : 'One base hour is 0.25 vCPU with 512 MB of RAM, billed per second'
          }
        />
        <Stat
          label="Compute charged"
          value={formatMicroUsd(periodCharged)}
          tone="ember"
          caption={`Across ${formatNumber(periodWindows)} closed ${periodWindows === 1 ? 'run' : 'runs'}. A machine running now is priced when it stops.`}
        />
      </StatGrid>

      <SandboxesView
        sandboxes={views}
        filter={filter}
        destroyedCount={counts?.destroyed ?? 0}
        truncated={rows.length === LIST_LIMIT}
        canStart={can(role, 'sandbox.create')}
        canStop={can(role, 'sandbox.stop')}
      />
    </div>
  );
}
