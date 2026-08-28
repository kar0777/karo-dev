import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  iso,
  routeParam,
  serializeConversation,
  serializeProject,
  serializeSandbox,
} from '@/app/api/_shared/route-helpers';
import { assertWorkerBelongsToTeam } from '@/app/api/_shared/worker-ownership';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { conversations, projectFiles, projects, sandboxes } from '@/lib/db/schema';
import { destroySandbox } from '@/lib/sandbox/service';

/**
 * `/api/projects/[projectId]` — read, configure, delete.
 *
 * `DELETE` archives by default and only removes rows when the caller explicitly
 * asks for it: a project holds the user's code, and an accidental double-click
 * should not be able to destroy work. Either way the project's machines are
 * released first, because a sandbox with no project can never be reached again.
 */

export const dynamic = 'force-dynamic';

export const GET = defineHandler({ auth: 'required' }, async ({ params }) => {
  const projectId = routeParam(params, 'projectId');
  const access = await requireApiProjectAccess(projectId, 'project.read');

  const [fileStats] = await db
    .select({
      files: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${projectFiles.pendingChangeKind} is not null)::int`,
      bytes: sql<number>`coalesce(sum(${projectFiles.sizeBytes}), 0)::int`,
    })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId));

  const projectSandboxes = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.projectId, projectId), sql`${sandboxes.status} <> 'destroyed'`))
    .orderBy(desc(sandboxes.createdAt))
    .limit(10);

  const recentConversations = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), isNull(conversations.archivedAt)))
    .orderBy(desc(conversations.updatedAt))
    .limit(20);

  // Opening a project is what orders the "recent" list in the sidebar.
  await db.update(projects).set({ lastOpenedAt: new Date() }).where(eq(projects.id, projectId));

  return json({
    project: serializeProject(access.project),
    role: access.role,
    stats: {
      files: fileStats?.files ?? 0,
      pendingChanges: fileStats?.pending ?? 0,
      totalBytes: fileStats?.bytes ?? 0,
    },
    sandboxes: projectSandboxes.map(serializeSandbox),
    conversations: recentConversations.map(serializeConversation),
  });
});

const patchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  defaultModelId: z.string().trim().max(64).nullish(),
  defaultAgentMode: z.enum(['ask', 'plan', 'build', 'auto']).optional(),
  defaultShell: z.enum(['bash', 'sh', 'powershell', 'cmd']).optional(),
  runtimeTarget: z.enum(['karo_cloud', 'own_server', 'external_sandbox', 'local']).optional(),
  workerId: z.string().trim().max(64).nullish(),
  gitRemoteUrl: z.string().trim().max(500).nullish(),
  gitBranch: z.string().trim().min(1).max(200).optional(),
  /** The per-project agent permission matrix. */
  permissions: z.record(z.string(), z.boolean()).optional(),
  /** Replaces the whole environment map. Values are write-only. */
  envVars: z.record(z.string(), z.string().max(8_000)).optional(),
  archived: z.boolean().optional(),
});

export const PATCH = defineHandler(
  {
    auth: 'required',
    body: patchBody,
    audit: { action: AUDIT_ACTIONS.projectUpdate, resourceType: 'project' },
  },
  async ({ params, body, setAudit }) => {
    const projectId = routeParam(params, 'projectId');
    const access = await requireApiProjectAccess(projectId, 'project.update');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    const changed: string[] = [];

    if (body.name !== undefined) {
      patch.name = body.name;
      changed.push('name');
    }
    if (body.description !== undefined) {
      patch.description = body.description;
      changed.push('description');
    }
    if (body.defaultModelId !== undefined) {
      patch.defaultModelId = body.defaultModelId ?? null;
      changed.push('defaultModelId');
    }
    if (body.defaultAgentMode !== undefined) {
      patch.defaultAgentMode = body.defaultAgentMode;
      changed.push('defaultAgentMode');
    }
    if (body.defaultShell !== undefined) {
      patch.defaultShell = body.defaultShell;
      changed.push('defaultShell');
    }
    if (body.runtimeTarget !== undefined) {
      patch.runtimeTarget = body.runtimeTarget;
      changed.push('runtimeTarget');
    }
    if (body.workerId !== undefined) {
      await assertWorkerBelongsToTeam(body.workerId, access.team.id);
      patch.workerId = body.workerId ?? null;
      changed.push('workerId');
    }
    if (body.gitRemoteUrl !== undefined) {
      patch.gitRemoteUrl = body.gitRemoteUrl || null;
      changed.push('gitRemoteUrl');
    }
    if (body.gitBranch !== undefined) {
      patch.gitBranch = body.gitBranch;
      changed.push('gitBranch');
    }
    if (body.permissions !== undefined) {
      patch.permissions = body.permissions;
      changed.push('permissions');
    }
    if (body.envVars !== undefined) {
      patch.envVars = body.envVars;
      changed.push('envVars');
    }
    if (body.archived !== undefined) {
      patch.archivedAt = body.archived ? new Date() : null;
      changed.push(body.archived ? 'archived' : 'restored');
    }

    const updated = await db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, projectId))
      .returning();

    const project = updated[0] ?? access.project;

    setAudit({
      teamId: access.team.id,
      resourceId: projectId,
      summary: `Updated ${project.name} (${changed.join(', ') || 'no changes'})`,
      // Never the values: `envVars` holds credentials by definition.
      metadata: { fields: changed },
    });

    return json({ project: serializeProject(project) });
  },
);

const deleteQuery = z.object({
  /** `true` removes the rows; anything else archives. */
  purge: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const DELETE = defineHandler(
  {
    auth: 'required',
    query: deleteQuery,
    audit: { action: AUDIT_ACTIONS.projectDelete, resourceType: 'project' },
  },
  async ({ params, query, user, setAudit }) => {
    const projectId = routeParam(params, 'projectId');
    const access = await requireApiProjectAccess(
      projectId,
      query.purge ? 'project.delete' : 'project.update',
    );

    // Release the machines first — after the row is gone there is nothing left
    // to route a destroy call through.
    const live = await db
      .select({ id: sandboxes.id })
      .from(sandboxes)
      .where(and(eq(sandboxes.projectId, projectId), sql`${sandboxes.status} <> 'destroyed'`));

    for (const row of live) {
      await destroySandbox(row.id, {
        userId: user.id,
        reason: query.purge ? 'project-deleted' : 'project-archived',
      });
    }

    if (query.purge) {
      await db.delete(projects).where(eq(projects.id, projectId));
      setAudit({
        teamId: access.team.id,
        resourceId: projectId,
        severity: 'notice',
        summary: `Deleted project ${access.project.name} and ${live.length} sandbox(es)`,
        metadata: { purged: true, sandboxes: live.length },
      });
      return json({ deleted: true, archived: false, sandboxesReleased: live.length });
    }

    const archivedAt = new Date();
    await db
      .update(projects)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(eq(projects.id, projectId));

    // Archiving is a different event from deleting, and `setAudit` can only
    // enrich the configured action — so this one is written by hand and the
    // automatic `project.delete` record is suppressed.
    setAudit({ record: false });
    await recordAudit({
      action: AUDIT_ACTIONS.projectArchive,
      teamId: access.team.id,
      userId: user.id,
      resourceType: 'project',
      resourceId: projectId,
      summary: `Archived project ${access.project.name}`,
      metadata: { sandboxesReleased: live.length },
    });

    return json({
      deleted: false,
      archived: true,
      archivedAt: iso(archivedAt),
      sandboxesReleased: live.length,
    });
  },
);
