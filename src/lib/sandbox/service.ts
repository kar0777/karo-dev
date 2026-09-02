import 'server-only';

import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';

import { resolveAgentPermissions } from '@/lib/agent/policy';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  QuotaExceededError,
} from '@/lib/api/errors';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { redactText } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import {
  projectFiles,
  projects,
  sandboxSessions,
  sandboxes,
  terminalSessions,
  type PlanTier,
  type Project,
  type Sandbox as SandboxRow,
  type Team,
  type User,
  byosWorkers,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { calculateComputeMultiplier, presetFor } from '@/lib/pricing/compute';
import {
  PROVIDER_META,
  getDaytonaProvider,
  getMockProvider,
  getProvider,
  getRemoteDockerProvider,
  resolveProviderForTarget,
} from '@/lib/sandbox';
import {
  SandboxError,
  type CreateSandboxOptions,
  type SandboxMetrics,
  type SandboxProvider,
  type SandboxProviderKey,
} from '@/lib/sandbox/types';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';
import { loadBillingContext, recordComputeUsage } from '@/lib/usage/metering';

/**
 * Database-aware sandbox lifecycle.
 *
 * The providers in `src/lib/sandbox/providers` know how to make a machine
 * appear; they know nothing about plans, quota, metering or audit. This module
 * is the seam between the two: it decides whether a sandbox is *allowed*, keeps
 * the `sandboxes` row and the real machine in agreement, and makes sure every
 * running second lands in `compute_events` exactly once.
 *
 * Every state transition here follows the same order:
 *   authorise → write the intent → call the provider → reconcile the row → audit
 *
 * Writing the intent first is deliberate. If the process dies mid-create, the
 * row is left in `creating`/`failed` and the sweeper can reason about it; a
 * machine with no row would just leak.
 */

const log = createLogger('sandbox:service');

/** Statuses that occupy one of the plan's active-sandbox slots. */
const OCCUPIED_STATUSES = ['creating', 'starting', 'running', 'sleeping', 'stopping'] as const;

const TIER_RANK: Record<PlanTier, number> = { payg: 0, lite: 1, pro: 2, scale: 3, ultra: 4 };

export type SandboxSize = {
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
};

export type CreateSandboxForProjectInput = {
  project: Project;
  team: Team;
  user: User;
  size: SandboxSize;
  name?: string;
  /** Overrides the project's runtime target. Still plan-gated. */
  provider?: SandboxProviderKey;
  workerId?: string | null;
};

export type LifecycleOptions = {
  userId?: string | null;
  reason?: string;
};

/* ------------------------------------------------------------------ *
 *  Loading & provider rehydration
 * ------------------------------------------------------------------ */

export async function loadSandbox(sandboxId: string): Promise<SandboxRow> {
  const rows = await db.select().from(sandboxes).where(eq(sandboxes.id, sandboxId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Sandbox not found.', {
      title: 'Sandbox not found',
      description: 'This sandbox no longer exists. Create a new one to keep working.',
    });
  }
  return row;
}

/**
 * Returns the provider for a stored sandbox, re-teaching it the external id it
 * lost when the process restarted.
 *
 * The Daytona and remote-docker providers keep their id/route maps in memory —
 * deliberately, because those maps are per-process routing state, not durable
 * data. The durable copy is the `sandboxes` row, and this is where the two are
 * put back in touch.
 */
export function rehydrateProvider(row: SandboxRow): SandboxProvider {
  const key = (row.provider || 'mock') as SandboxProviderKey;

  if (key === 'daytona' && row.externalId) {
    getDaytonaProvider().registerExternalId(row.id, row.externalId);
  }
  if (key === 'remote-docker' && row.externalId && row.workerId) {
    getRemoteDockerProvider().registerRoute(row.id, row.workerId, row.externalId);
  }
  if (key === 'mock' || key === 'external') {
    // The simulator keeps machines in process memory. Feeding it the row's
    // shape before every operation lets it rebuild a machine lost to a server
    // restart instead of answering "no longer exists" until the row expires.
    getMockProvider().rememberSnapshot({
      sandboxId: row.id,
      cpuCores: row.cpuCores,
      memoryMb: row.memoryMb,
      diskGb: row.diskGb,
    });
  }

  return getProvider(key);
}

/**
 * What Karo pays for one base compute hour on this provider. Providers that
 * report 0 but are billed (Karo Cloud containers on our own hardware) fall back
 * to the operator-tunable platform rate.
 */
async function upstreamRatePerBaseHour(provider: SandboxProvider): Promise<number> {
  if (provider.upstreamMicroUsdPerBaseHour > 0) return provider.upstreamMicroUsdPerBaseHour;
  if (!PROVIDER_META[provider.key].billed) return 0;
  return getSetting(
    SETTING_KEYS.computeUpstreamMicroUsdPerBaseHour,
    settingDefault(SETTING_KEYS.computeUpstreamMicroUsdPerBaseHour),
  );
}

/* ------------------------------------------------------------------ *
 *  Create
 * ------------------------------------------------------------------ */

export async function createSandboxForProject(
  input: CreateSandboxForProjectInput,
): Promise<SandboxRow> {
  const { project, team, user, size } = input;
  const billing = await loadBillingContext(team.id);
  const plan = billing.plan;

  /* ---- Plan limits ---------------------------------------------------- */

  const occupiedRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sandboxes)
    .where(
      and(eq(sandboxes.teamId, team.id), inArray(sandboxes.status, [...OCCUPIED_STATUSES])),
    );

  const occupied = occupiedRows[0]?.count ?? 0;
  if (occupied >= plan.maxActiveSandboxes) {
    throw new QuotaExceededError(
      `The ${plan.name} plan allows ${plan.maxActiveSandboxes} sandbox${
        plan.maxActiveSandboxes === 1 ? '' : 'es'
      } at a time and ${occupied} ${occupied === 1 ? 'is' : 'are'} already allocated. Stop or destroy one from Sandboxes, or upgrade the plan for more.`,
      { details: { limit: plan.maxActiveSandboxes, active: occupied, planKey: plan.key } },
    );
  }

  if (size.cpuCores > plan.maxSandboxCpuCores) {
    throw new QuotaExceededError(
      `The ${plan.name} plan tops out at ${plan.maxSandboxCpuCores} vCPU per sandbox; you asked for ${size.cpuCores}. Pick a smaller size or upgrade the plan.`,
      {
        details: {
          limit: plan.maxSandboxCpuCores,
          requested: size.cpuCores,
          field: 'cpuCores',
        },
      },
    );
  }
  if (size.memoryMb > plan.maxSandboxMemoryMb) {
    throw new QuotaExceededError(
      `The ${plan.name} plan tops out at ${plan.maxSandboxMemoryMb} MB of RAM per sandbox; you asked for ${size.memoryMb} MB. Pick a smaller size or upgrade the plan.`,
      {
        details: {
          limit: plan.maxSandboxMemoryMb,
          requested: size.memoryMb,
          field: 'memoryMb',
        },
      },
    );
  }
  if (size.diskGb > plan.storageGb) {
    throw new QuotaExceededError(
      `The ${plan.name} plan includes ${plan.storageGb} GB of sandbox disk; you asked for ${size.diskGb} GB. Reduce the disk or upgrade the plan.`,
      { details: { limit: plan.storageGb, requested: size.diskGb, field: 'diskGb' } },
    );
  }

  const preset = presetFor(size.cpuCores, size.memoryMb);
  if (!preset && !plan.allowCustomSandboxSize) {
    throw new QuotaExceededError(
      `The ${plan.name} plan can only use the standard sandbox sizes. Choose one of the presets, or upgrade to configure CPU and memory freely.`,
      { details: { requested: size, planKey: plan.key } },
    );
  }
  if (preset && TIER_RANK[preset.minPlanTier] > TIER_RANK[plan.tier]) {
    throw new QuotaExceededError(
      `The ${preset.label} sandbox size needs the ${preset.minPlanTier} plan or higher. Pick a smaller size, or upgrade to unlock it.`,
      { details: { size: preset.key, requiredTier: preset.minPlanTier, planTier: plan.tier } },
    );
  }

  /* ---- Provider ------------------------------------------------------- */

  const provider = input.provider
    ? getProvider(input.provider)
    : await resolveProviderForTarget(project.runtimeTarget);

  let workerId = input.workerId ?? project.workerId ?? null;

  if (provider.key === 'remote-docker') {
    if (!plan.allowOwnServer) {
      throw new ForbiddenError(
        `The ${plan.name} plan cannot run sandboxes on your own server. Upgrade the plan, or switch this project to Karo Cloud.`,
      );
    }
    // A stale attachment must not block creation: a revoked worker, or one
    // that stopped heartbeating, would fail every run with "offline". Fall
    // back to the team's freshest online worker and re-attach.
    if (workerId) {
      const [attached] = await db
        .select({ status: byosWorkers.status, lastHeartbeatAt: byosWorkers.lastHeartbeatAt })
        .from(byosWorkers)
        .where(eq(byosWorkers.id, workerId))
        .limit(1);
      const fresh =
        attached &&
        attached.status !== 'revoked' &&
        attached.lastHeartbeatAt !== null &&
        Date.now() - attached.lastHeartbeatAt.getTime() < 2 * 60_000;
      if (!fresh) workerId = null;
    }
    if (!workerId) {
      // Auto-attach: the team's freshest online worker. Demanding a manual
      // pick in project settings meant "Create a sandbox" could never succeed
      // for a team with exactly one server — which is most teams.
      const twoMinutesAgo = new Date(Date.now() - 2 * 60_000);
      const [candidate] = await db
        .select({ id: byosWorkers.id })
        .from(byosWorkers)
        .where(
          and(
            eq(byosWorkers.teamId, team.id),
            eq(byosWorkers.status, 'online'),
            gte(byosWorkers.lastHeartbeatAt, twoMinutesAgo),
          ),
        )
        .orderBy(desc(byosWorkers.lastHeartbeatAt))
        .limit(1);

      if (!candidate) {
        const registeredRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(byosWorkers)
          .where(and(eq(byosWorkers.teamId, team.id), ne(byosWorkers.status, 'revoked')));
        const registered = Number(registeredRows[0]?.count ?? 0);

        throw new ConflictError(
          registered > 0
            ? 'Your server is not connected right now.'
            : 'No server is registered on this team yet.',
          {
            title: registered > 0 ? 'Your server is offline' : 'No server registered',
            description:
              registered > 0
                ? 'Start the karo-worker service on your machine, give it a minute to come online, then create the sandbox again.'
                : 'Register your computer under Settings → Servers to run sandboxes on your own hardware.',
          },
        );
      }

      workerId = candidate.id;
      // Persist the attachment so the workspace view and later runs agree.
      await db
        .update(projects)
        .set({ workerId: candidate.id, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
    }
  }
  if (provider.key === 'daytona' && !plan.allowExternalSandbox) {
    throw new ForbiddenError(
      `The ${plan.name} plan cannot use external sandbox providers. Upgrade the plan, or switch this project to Karo Cloud.`,
    );
  }

  /* ---- Shape & policy -------------------------------------------------- */

  const multiplier = calculateComputeMultiplier({
    cpuCores: size.cpuCores,
    memoryMb: size.memoryMb,
    diskGb: size.diskGb,
    providerMultiplier: provider.computeMultiplier,
  });

  const agentPermissions = resolveAgentPermissions(
    project.permissions as Parameters<typeof resolveAgentPermissions>[0],
    project.defaultAgentMode,
  );
  const networkPolicy: CreateSandboxOptions['networkPolicy'] = agentPermissions.networkAccess
    ? 'restricted'
    : 'none';
  const allowDocker = plan.allowDocker && agentPermissions.dockerAccess;

  const executionTimeoutSeconds = await getSetting(
    SETTING_KEYS.agentToolTimeoutSeconds,
    settingDefault(SETTING_KEYS.agentToolTimeoutSeconds),
  );

  // Process ceiling scales with the machine: a nano box gets 64, a 4 vCPU box
  // gets enough for a monorepo build without letting a fork storm take the host.
  const maxProcesses = Math.min(512, Math.max(64, Math.round((size.cpuCores / 0.25) * 64)));

  const sandboxId = newId(ID_PREFIX.sandbox);
  const name = (input.name ?? `${project.name} sandbox`).slice(0, 80);
  const image = env.SANDBOX_IMAGE;

  await db.insert(sandboxes).values({
    id: sandboxId,
    teamId: team.id,
    projectId: project.id,
    createdById: user.id,
    name,
    provider: provider.key,
    workerId,
    status: 'creating',
    image,
    cpuCores: size.cpuCores,
    memoryMb: size.memoryMb,
    diskGb: size.diskGb,
    computeMultiplier: multiplier.value,
    autoSleepMinutes: plan.autoSleepMinutes,
    autoDestroyHours: plan.autoDestroyHours,
    networkPolicy,
    allowDocker,
  });

  /* ---- Provision ------------------------------------------------------- */

  try {
    const created = await provider.createSandbox({
      sandboxId,
      teamId: team.id,
      projectId: project.id,
      name,
      image,
      cpuCores: size.cpuCores,
      memoryMb: size.memoryMb,
      diskGb: size.diskGb,
      executionTimeoutSeconds,
      maxProcesses,
      networkPolicy,
      allowDocker,
      env: (project.envVars as Record<string, string> | null) ?? {},
      initialFiles: await workspaceSeedFiles(project.id),
      labels: { 'karo.team': team.id, 'karo.project': project.id, 'karo.sandbox': sandboxId },
      workerId,
      region: null,
    });

    const now = new Date();
    const updated = await db
      .update(sandboxes)
      .set({
        externalId: created.externalId,
        status: created.status,
        statusMessage: null,
        startedAt: now,
        lastActiveAt: now,
        metadata: { ...(created.metadata ?? {}), exposedPorts: created.exposedPorts ?? {} },
        updatedAt: now,
      })
      .where(eq(sandboxes.id, sandboxId))
      .returning();

    const row = updated[0];
    if (!row) throw new Error('The sandbox row disappeared while it was being created.');

    await openSession(row, now);

    await recordAudit({
      action: AUDIT_ACTIONS.sandboxCreate,
      teamId: team.id,
      userId: user.id,
      resourceType: 'sandbox',
      resourceId: sandboxId,
      summary: `Created ${name} (${size.cpuCores} vCPU · ${size.memoryMb} MB) on ${provider.displayName}`,
      metadata: {
        provider: provider.key,
        projectId: project.id,
        computeMultiplier: multiplier.value,
        explanation: multiplier.explanation,
      },
    });

    return row;
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : String(error));
    await db
      .update(sandboxes)
      .set({ status: 'failed', statusMessage: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(sandboxes.id, sandboxId));

    log.error('Sandbox provisioning failed', {
      sandboxId,
      provider: provider.key,
      projectId: project.id,
      error: message,
    });

    await recordAudit({
      action: AUDIT_ACTIONS.sandboxCreate,
      teamId: team.id,
      userId: user.id,
      resourceType: 'sandbox',
      resourceId: sandboxId,
      severity: 'warning',
      summary: `Failed to create ${name} on ${provider.displayName}`,
      metadata: { provider: provider.key, error: message },
    });

    throw error;
  }
}

/** The project's files, uploaded into `/workspace` when the machine appears. */
async function workspaceSeedFiles(projectId: string) {
  const rows = await db
    .select({
      path: projectFiles.path,
      content: projectFiles.content,
      isDirectory: projectFiles.isDirectory,
      isBinary: projectFiles.isBinary,
    })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .limit(1000);

  return rows
    .filter((row) => !row.isDirectory)
    .map((row) => ({
      path: row.path,
      content: row.content,
      encoding: (row.isBinary ? 'base64' : 'utf8') as 'base64' | 'utf8',
    }));
}

/**
 * The project's environment variables, read fresh: a machine rebuilt after the
 * provider lost it has to be handed the same environment as the one it replaces,
 * or every `process.env` lookup the project depends on comes back empty.
 */
async function projectEnvVars(projectId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ envVars: projects.envVars })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return rows[0]?.envVars ?? {};
}

/* ------------------------------------------------------------------ *
 *  Start / stop / restart / destroy
 * ------------------------------------------------------------------ */

export async function startSandbox(
  sandboxId: string,
  options: LifecycleOptions = {},
): Promise<SandboxRow> {
  const row = await loadSandbox(sandboxId);
  if (row.status === 'destroyed') {
    throw new NotFoundError('This sandbox was destroyed.', {
      title: 'Sandbox destroyed',
      description: 'Its machine has been released. Create a new sandbox to keep working.',
    });
  }
  if (row.status === 'running') return row;

  const provider = rehydrateProvider(row);
  await setStatus(row.id, 'starting');

  try {
    await provider.startSandbox(row.id);
  } catch (error) {
    // The provider lost the machine (process restart on the mock/Daytona
    // providers, container pruned on the host). Re-provision rather than
    // stranding the user with a row that can never start again.
    if (error instanceof SandboxError && error.code === 'not_found') {
      await reprovision(row, provider);
    } else {
      const message = redactText(error instanceof Error ? error.message : String(error));
      await db
        .update(sandboxes)
        .set({ status: 'failed', statusMessage: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(sandboxes.id, row.id));
      throw error;
    }
  }

  const now = new Date();
  const updated = await db
    .update(sandboxes)
    .set({
      status: 'running',
      statusMessage: null,
      startedAt: now,
      lastActiveAt: now,
      stoppedAt: null,
      updatedAt: now,
    })
    .where(eq(sandboxes.id, row.id))
    .returning();

  const next = updated[0] ?? row;
  await openSession(next, now);

  await recordAudit({
    action: AUDIT_ACTIONS.sandboxStart,
    teamId: row.teamId,
    userId: options.userId ?? null,
    resourceType: 'sandbox',
    resourceId: row.id,
    summary: `Started ${row.name}`,
    metadata: { reason: options.reason ?? 'manual', provider: row.provider },
  });

  return next;
}

export async function stopSandbox(
  sandboxId: string,
  options: LifecycleOptions & { sleep?: boolean } = {},
): Promise<SandboxRow> {
  const row = await loadSandbox(sandboxId);
  if (row.status === 'destroyed') {
    throw new NotFoundError('This sandbox was destroyed.', {
      title: 'Sandbox destroyed',
      description: 'Its machine has been released. Create a new sandbox to keep working.',
    });
  }

  const provider = rehydrateProvider(row);
  await setStatus(row.id, 'stopping');

  try {
    await provider.stopSandbox(row.id);
  } catch (error) {
    // A machine that is already gone is a stopped machine. Anything else is a
    // real failure and the row must reflect it.
    if (!(error instanceof SandboxError && error.code === 'not_found')) {
      const message = redactText(error instanceof Error ? error.message : String(error));
      await db
        .update(sandboxes)
        .set({ status: 'failed', statusMessage: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(sandboxes.id, row.id));
      throw error;
    }
  }

  const reason = options.reason ?? (options.sleep ? 'auto-sleep' : 'manual');
  const activeSeconds = await closeSession(row, reason, options.userId ?? null);

  const now = new Date();
  const updated = await db
    .update(sandboxes)
    .set({
      status: options.sleep ? 'sleeping' : 'stopped',
      statusMessage: options.sleep
        ? 'Asleep after inactivity — it wakes on your next command.'
        : null,
      stoppedAt: now,
      cpuPercent: 0,
      memoryUsedMb: 0,
      processCount: 0,
      totalActiveSeconds: sql`${sandboxes.totalActiveSeconds} + ${activeSeconds}`,
      updatedAt: now,
    })
    .where(eq(sandboxes.id, row.id))
    .returning();

  await recordAudit({
    action: AUDIT_ACTIONS.sandboxStop,
    teamId: row.teamId,
    userId: options.userId ?? null,
    resourceType: 'sandbox',
    resourceId: row.id,
    summary: `${options.sleep ? 'Put to sleep' : 'Stopped'} ${row.name} after ${activeSeconds}s`,
    metadata: { reason, activeSeconds, provider: row.provider },
  });

  return updated[0] ?? row;
}

export async function restartSandbox(
  sandboxId: string,
  options: LifecycleOptions = {},
): Promise<SandboxRow> {
  await stopSandbox(sandboxId, {
    ...options,
    reason: options.reason ?? 'restart',
    sleep: false,
  });
  return startSandbox(sandboxId, { ...options, reason: options.reason ?? 'restart' });
}

export async function destroySandbox(
  sandboxId: string,
  options: LifecycleOptions = {},
): Promise<SandboxRow> {
  const row = await loadSandbox(sandboxId);
  if (row.status === 'destroyed') return row;

  const provider = rehydrateProvider(row);
  const reason = options.reason ?? 'manual';

  try {
    await provider.destroySandbox(row.id);
  } catch (error) {
    // Destroy is best-effort by design: the row must end up gone either way, or
    // the user is stuck paying for a slot they cannot release.
    log.warn('Provider could not destroy the sandbox — releasing the row anyway', {
      sandboxId,
      provider: row.provider,
      error: String(error),
    });
  }

  const activeSeconds = await closeSession(row, reason, options.userId ?? null);
  const now = new Date();

  const updated = await db
    .update(sandboxes)
    .set({
      status: 'destroyed',
      statusMessage: null,
      externalId: null,
      destroyedAt: now,
      stoppedAt: row.stoppedAt ?? now,
      cpuPercent: 0,
      memoryUsedMb: 0,
      processCount: 0,
      totalActiveSeconds: sql`${sandboxes.totalActiveSeconds} + ${activeSeconds}`,
      updatedAt: now,
    })
    .where(eq(sandboxes.id, row.id))
    .returning();

  await db
    .update(terminalSessions)
    .set({ isActive: false, closedAt: now })
    .where(and(eq(terminalSessions.sandboxId, row.id), eq(terminalSessions.isActive, true)));

  await recordAudit({
    action: AUDIT_ACTIONS.sandboxDestroy,
    teamId: row.teamId,
    userId: options.userId ?? null,
    resourceType: 'sandbox',
    resourceId: row.id,
    severity: 'notice',
    summary: `Destroyed ${row.name}`,
    metadata: { reason, provider: row.provider, activeSeconds },
  });

  return updated[0] ?? row;
}

/* ------------------------------------------------------------------ *
 *  Telemetry
 * ------------------------------------------------------------------ */

/**
 * Polls the provider and writes the numbers onto the row so pages that render
 * a sandbox card do not each have to talk to the provider.
 */
export async function refreshMetrics(sandboxId: string): Promise<SandboxMetrics | null> {
  const row = await loadSandbox(sandboxId);
  if (row.status !== 'running' && row.status !== 'starting') return null;

  const provider = rehydrateProvider(row);

  try {
    const metrics = await provider.getMetrics(row.id);
    await db
      .update(sandboxes)
      .set({
        cpuPercent: metrics.cpuPercent,
        memoryUsedMb: metrics.memoryUsedMb,
        diskUsedMb: metrics.diskUsedMb,
        processCount: metrics.processCount,
        updatedAt: new Date(),
      })
      .where(eq(sandboxes.id, row.id));

    return metrics;
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : String(error));
    log.warn('Could not read sandbox metrics', { sandboxId, error: message });
    await db
      .update(sandboxes)
      .set({ statusMessage: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(sandboxes.id, row.id));
    return null;
  }
}

/** Marks the sandbox as used, which is what postpones auto-sleep. */
export async function touchSandbox(sandboxId: string): Promise<void> {
  await db
    .update(sandboxes)
    .set({ lastActiveAt: new Date() })
    .where(eq(sandboxes.id, sandboxId));
}

/* ------------------------------------------------------------------ *
 *  Idle sweeping
 * ------------------------------------------------------------------ */

export type SweepResult = {
  slept: string[];
  destroyed: string[];
};

/**
 * Puts idle sandboxes to sleep and releases the ones that have been asleep too
 * long, using each row's own plan-derived thresholds.
 *
 * Exported but never scheduled here: what triggers it (a cron container, an
 * external scheduler, an admin button) is a deployment decision, and a
 * `setInterval` in a Next.js module would run once per worker process.
 */
export async function sweepIdleSandboxes(): Promise<SweepResult> {
  const result: SweepResult = { slept: [], destroyed: [] };

  const idle = await db
    .select()
    .from(sandboxes)
    .where(
      and(
        inArray(sandboxes.status, ['running', 'starting']),
        sql`coalesce(${sandboxes.lastActiveAt}, ${sandboxes.startedAt}, ${sandboxes.createdAt}) < now() - make_interval(mins => ${sandboxes.autoSleepMinutes})`,
      ),
    )
    .limit(200);

  for (const row of idle) {
    try {
      await stopSandbox(row.id, { sleep: true, reason: 'auto-sleep' });
      result.slept.push(row.id);
    } catch (error) {
      log.warn('Auto-sleep failed for a sandbox', { sandboxId: row.id, error: String(error) });
    }
  }

  const expired = await db
    .select()
    .from(sandboxes)
    .where(
      and(
        inArray(sandboxes.status, ['sleeping', 'stopped', 'failed']),
        sql`coalesce(${sandboxes.stoppedAt}, ${sandboxes.updatedAt}) < now() - make_interval(hours => ${sandboxes.autoDestroyHours})`,
      ),
    )
    .limit(200);

  for (const row of expired) {
    try {
      await destroySandbox(row.id, { reason: 'auto-destroy' });
      result.destroyed.push(row.id);
    } catch (error) {
      log.warn('Auto-destroy failed for a sandbox', {
        sandboxId: row.id,
        error: String(error),
      });
    }
  }

  if (result.slept.length || result.destroyed.length) {
    log.info('Swept idle sandboxes', {
      slept: result.slept.length,
      destroyed: result.destroyed.length,
    });
  }

  return result;
}

/* ------------------------------------------------------------------ *
 *  Internals
 * ------------------------------------------------------------------ */

async function setStatus(sandboxId: string, status: SandboxRow['status']): Promise<void> {
  await db
    .update(sandboxes)
    .set({ status, updatedAt: new Date() })
    .where(eq(sandboxes.id, sandboxId));
}

/** Opens a billing window, unless one is already open. */
async function openSession(row: SandboxRow, startedAt: Date): Promise<void> {
  const open = await db
    .select({ id: sandboxSessions.id })
    .from(sandboxSessions)
    .where(and(eq(sandboxSessions.sandboxId, row.id), isNull(sandboxSessions.stoppedAt)))
    .limit(1);

  if (open.length > 0) return;

  await db.insert(sandboxSessions).values({
    id: newId(ID_PREFIX.sandboxSession),
    sandboxId: row.id,
    teamId: row.teamId,
    startedAt,
  });
}

/**
 * Closes the open billing window and meters it. Returns the seconds billed so
 * the caller can fold them into the row's lifetime total.
 */
async function closeSession(
  row: SandboxRow,
  reason: string,
  userId: string | null,
): Promise<number> {
  const rows = await db
    .select()
    .from(sandboxSessions)
    .where(and(eq(sandboxSessions.sandboxId, row.id), isNull(sandboxSessions.stoppedAt)))
    .orderBy(desc(sandboxSessions.startedAt))
    .limit(1);

  const session = rows[0];
  if (!session) return 0;

  const stoppedAt = new Date();
  const activeSeconds = Math.max(
    0,
    Math.round((stoppedAt.getTime() - session.startedAt.getTime()) / 1000),
  );

  await db
    .update(sandboxSessions)
    .set({ stoppedAt, activeSeconds, stopReason: reason })
    .where(eq(sandboxSessions.id, session.id));

  const provider = getProvider((row.provider || 'mock') as SandboxProviderKey);

  try {
    const billing = await loadBillingContext(row.teamId);
    await recordComputeUsage({
      context: billing,
      userId: userId ?? row.createdById,
      projectId: row.projectId,
      sandboxId: row.id,
      sandboxSessionId: session.id,
      providerKey: row.provider,
      cpuCores: row.cpuCores,
      memoryMb: row.memoryMb,
      diskGb: row.diskGb,
      computeMultiplier: row.computeMultiplier,
      startedAt: session.startedAt,
      stoppedAt,
      activeSeconds,
      isOwnServer: row.provider === 'remote-docker',
      upstreamMicroUsdPerBaseHour: await upstreamRatePerBaseHour(provider),
    });
  } catch (error) {
    // Metering must never block a stop; the session row already records the
    // window, so the charge can be replayed.
    log.error('Could not meter a sandbox session', {
      sandboxId: row.id,
      sessionId: session.id,
      error: String(error),
    });
  }

  return activeSeconds;
}

/** Re-creates the machine for an existing row after the provider lost it. */
async function reprovision(row: SandboxRow, provider: SandboxProvider): Promise<void> {
  log.info('Re-provisioning a sandbox the provider no longer knows about', {
    sandboxId: row.id,
    provider: row.provider,
  });

  const executionTimeoutSeconds = await getSetting(
    SETTING_KEYS.agentToolTimeoutSeconds,
    settingDefault(SETTING_KEYS.agentToolTimeoutSeconds),
  );

  const created = await provider.createSandbox({
    sandboxId: row.id,
    teamId: row.teamId,
    projectId: row.projectId,
    name: row.name,
    image: row.image,
    cpuCores: row.cpuCores,
    memoryMb: row.memoryMb,
    diskGb: row.diskGb,
    executionTimeoutSeconds,
    maxProcesses: Math.min(512, Math.max(64, Math.round((row.cpuCores / 0.25) * 64))),
    networkPolicy: (row.networkPolicy as CreateSandboxOptions['networkPolicy']) ?? 'restricted',
    allowDocker: row.allowDocker,
    env: row.projectId ? await projectEnvVars(row.projectId) : {},
    initialFiles: row.projectId ? await workspaceSeedFiles(row.projectId) : [],
    labels: {
      'karo.team': row.teamId,
      ...(row.projectId ? { 'karo.project': row.projectId } : {}),
      'karo.sandbox': row.id,
    },
    workerId: row.workerId,
    region: row.region,
  });

  await db
    .update(sandboxes)
    .set({
      externalId: created.externalId,
      metadata: { ...(created.metadata ?? {}), exposedPorts: created.exposedPorts ?? {} },
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.id, row.id));
}
