import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { assertWorkerBelongsToTeam } from '@/app/api/_shared/worker-ownership';
import { serializeSandbox } from '@/app/api/_shared/route-helpers';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import {
  getActiveTeam,
  requireApiProjectAccess,
  requireApiTeamPermission,
} from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { projects, sandboxes } from '@/lib/db/schema';
import { SANDBOX_SIZE_PRESETS, calculateComputeMultiplier } from '@/lib/pricing/compute';
import { createSandboxForProject } from '@/lib/sandbox/service';
import { loadBillingContext } from '@/lib/usage/metering';

/**
 * `/api/sandboxes` — list and provision machines.
 *
 * `GET` also returns the plan's sandbox allowance and the size presets the plan
 * can actually select, so the creation dialog never offers a choice that the
 * `POST` would reject. Limits come from the `plans` row every time — no tier
 * numbers are hard-coded anywhere in the product.
 */

export const dynamic = 'force-dynamic';

const listQuery = z.object({
  projectId: z.string().trim().max(64).optional(),
  includeDestroyed: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const GET = defineHandler(
  { auth: 'required', query: listQuery },
  async ({ user, query }) => {
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'sandbox.read');

    const filters = [eq(sandboxes.teamId, team.id)];
    if (query.projectId) filters.push(eq(sandboxes.projectId, query.projectId));
    if (!query.includeDestroyed) filters.push(ne(sandboxes.status, 'destroyed'));

    const rows = await db
      .select({ sandbox: sandboxes, projectName: projects.name, projectSlug: projects.slug })
      .from(sandboxes)
      .leftJoin(projects, eq(sandboxes.projectId, projects.id))
      .where(and(...filters))
      .orderBy(desc(sandboxes.createdAt))
      .limit(200);

    const billing = await loadBillingContext(team.id);
    const plan = billing.plan;

    const activeRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.teamId, team.id),
          sql`${sandboxes.status} in ('creating', 'starting', 'running', 'sleeping', 'stopping')`,
        ),
      );

    const active = activeRows[0]?.count ?? 0;

    return json({
      sandboxes: rows.map((row) => ({
        ...serializeSandbox(row.sandbox),
        projectName: row.projectName,
        projectSlug: row.projectSlug,
      })),
      limits: {
        planName: plan.name,
        planTier: plan.tier,
        active,
        maxActiveSandboxes: plan.maxActiveSandboxes,
        maxSandboxCpuCores: plan.maxSandboxCpuCores,
        maxSandboxMemoryMb: plan.maxSandboxMemoryMb,
        maxDiskGb: plan.storageGb,
        allowCustomSandboxSize: plan.allowCustomSandboxSize,
        allowOwnServer: plan.allowOwnServer,
        allowExternalSandbox: plan.allowExternalSandbox,
        includedComputeHours: plan.includedComputeHours,
        remainingComputeHours: billing.quotaRemainingComputeHours,
      },
      presets: SANDBOX_SIZE_PRESETS.map((preset) => ({
        ...preset,
        available:
          preset.cpuCores <= plan.maxSandboxCpuCores &&
          preset.memoryMb <= plan.maxSandboxMemoryMb,
        computeMultiplier: calculateComputeMultiplier({
          cpuCores: preset.cpuCores,
          memoryMb: preset.memoryMb,
          diskGb: preset.diskGb,
        }).value,
      })),
    });
  },
);

const createBody = z.object({
  projectId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80).optional(),
  cpuCores: z.number().min(0.25).max(16),
  memoryMb: z.number().int().min(256).max(65_536),
  diskGb: z.number().int().min(1).max(1_000),
  provider: z.enum(['mock', 'local-docker', 'daytona', 'remote-docker', 'external']).optional(),
  workerId: z.string().trim().max(64).nullish(),
});

export const POST = defineHandler(
  { auth: 'required', rateLimit: 'sandbox.create', body: createBody },
  async ({ body, user }) => {
    const access = await requireApiProjectAccess(body.projectId, 'sandbox.create');
    await assertWorkerBelongsToTeam(body.workerId, access.team.id);

    const sandbox = await createSandboxForProject({
      project: access.project,
      team: access.team,
      user: access.user,
      size: { cpuCores: body.cpuCores, memoryMb: body.memoryMb, diskGb: body.diskGb },
      name: body.name,
      provider: body.provider,
      workerId: body.workerId ?? undefined,
    });

    return created({
      sandbox: serializeSandbox(sandbox),
      createdBy: user.id,
      multiplierExplanation: calculateComputeMultiplier({
        cpuCores: sandbox.cpuCores,
        memoryMb: sandbox.memoryMb,
        diskGb: sandbox.diskGb,
      }).explanation,
    });
  },
);
