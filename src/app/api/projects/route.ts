import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { assertWorkerBelongsToTeam } from '@/app/api/_shared/worker-ownership';
import { serializeProject } from '@/app/api/_shared/route-helpers';
import { ConflictError, QuotaExceededError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { conversations, projects, sandboxes, type RuntimeTarget } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { getTemplate, scaffoldProject } from '@/lib/projects/templates';
import { loadBillingContext } from '@/lib/usage/metering';
import { slugify } from '@/lib/utils';

/**
 * `/api/projects` — list and create.
 *
 * A project is the unit everything else hangs off: files, conversations,
 * sandboxes and the per-project agent permission matrix. Creating one scaffolds
 * its template into `project_files` immediately, so the workspace is never
 * empty when the user lands in it — the sandbox picks those files up when it is
 * first provisioned.
 */

export const dynamic = 'force-dynamic';

const RUNTIME_TARGETS = ['karo_cloud', 'own_server', 'external_sandbox', 'local'] as const;

const listQuery = z.object({
  teamId: z.string().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const GET = defineHandler(
  { auth: 'required', query: listQuery },
  async ({ user, query }) => {
    const { team, role } = await getActiveTeam(user.id, query.teamId ?? null);

    const rows = await db
      .select({
        project: projects,
        sandboxCount: sql<number>`(
        select count(*)::int from ${sandboxes}
        where ${sandboxes.projectId} = ${projects.id}
          and ${sandboxes.status} not in ('destroyed', 'failed')
      )`,
        conversationCount: sql<number>`(
        select count(*)::int from ${conversations}
        where ${conversations.projectId} = ${projects.id}
          and ${conversations.archivedAt} is null
      )`,
      })
      .from(projects)
      .where(
        query.includeArchived
          ? eq(projects.teamId, team.id)
          : and(eq(projects.teamId, team.id), isNull(projects.archivedAt)),
      )
      .orderBy(desc(projects.updatedAt))
      .limit(200);

    return json({
      projects: rows.map((row) => ({
        ...serializeProject(row.project),
        sandboxCount: row.sandboxCount,
        conversationCount: row.conversationCount,
      })),
      teamId: team.id,
      role,
    });
  },
);

const createBody = z.object({
  name: z.string().trim().min(1, 'Give the project a name.').max(80),
  description: z.string().trim().max(500).optional(),
  template: z.string().trim().min(1).max(64).default('blank'),
  runtimeTarget: z.enum(RUNTIME_TARGETS).default('karo_cloud'),
  workerId: z.string().trim().max(64).nullish(),
  modelId: z.string().trim().max(64).nullish(),
  agentMode: z.enum(['ask', 'plan', 'build', 'auto']).default('build'),
  shell: z.enum(['bash', 'sh', 'powershell', 'cmd']).default('bash'),
  teamId: z.string().trim().max(64).optional(),
});

export const POST = defineHandler(
  {
    auth: 'required',
    body: createBody,
    audit: { action: AUDIT_ACTIONS.projectCreate, resourceType: 'project' },
  },
  async ({ user, body, setAudit }) => {
    const { team } = await getActiveTeam(user.id, body.teamId ?? null);
    await assertWorkerBelongsToTeam(body.workerId, team.id);
    const access = await requireApiTeamPermission(team.id, 'project.create');

    /* ---- Plan limits ------------------------------------------------- */

    const billing = await loadBillingContext(team.id);
    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.teamId, team.id), isNull(projects.archivedAt)));

    const existing = countRows[0]?.count ?? 0;
    if (existing >= billing.plan.maxProjects) {
      throw new QuotaExceededError(
        `The ${billing.plan.name} plan includes ${billing.plan.maxProjects} active projects and you already have ${existing}. Archive one you have finished with, or upgrade the plan.`,
        { details: { limit: billing.plan.maxProjects, active: existing } },
      );
    }

    if (body.runtimeTarget === 'own_server' && !billing.plan.allowOwnServer) {
      throw new QuotaExceededError(
        `The ${billing.plan.name} plan cannot run projects on your own server. Upgrade the plan, or choose Karo Cloud.`,
      );
    }
    if (body.runtimeTarget === 'external_sandbox' && !billing.plan.allowExternalSandbox) {
      throw new QuotaExceededError(
        `The ${billing.plan.name} plan cannot use external sandbox providers. Upgrade the plan, or choose Karo Cloud.`,
      );
    }

    const allowedShells = billing.plan.allowedShells ?? ['bash'];
    if (!allowedShells.includes(body.shell)) {
      throw new QuotaExceededError(
        `The ${billing.plan.name} plan does not include the ${body.shell} shell. Available shells: ${allowedShells.join(', ')}.`,
        { details: { allowedShells } },
      );
    }

    /* ---- Slug ---------------------------------------------------------- */

    const base = slugify(body.name) || 'project';
    const slug = await uniqueSlug(team.id, base);

    const template = await getTemplate(body.template);
    const templateKey = template?.key ?? 'blank';

    const projectId = newId(ID_PREFIX.project);
    const now = new Date();

    const inserted = await db
      .insert(projects)
      .values({
        id: projectId,
        teamId: team.id,
        createdById: user.id,
        name: body.name,
        slug,
        description: body.description ?? template?.description ?? '',
        template: templateKey,
        runtimeTarget: body.runtimeTarget as RuntimeTarget,
        workerId: body.workerId ?? null,
        defaultModelId: body.modelId ?? null,
        defaultAgentMode: body.agentMode,
        defaultShell: body.shell,
        lastOpenedAt: now,
      })
      .returning();

    const project = inserted[0];
    if (!project) throw new ConflictError('The project could not be created. Try again.');

    const scaffold = await scaffoldProject(projectId, templateKey);

    // Every project starts with one chat, so the workspace has somewhere to
    // land instead of an empty-state inside an empty-state.
    const conversationId = newId(ID_PREFIX.conversation);
    await db.insert(conversations).values({
      id: conversationId,
      projectId,
      userId: user.id,
      title: 'New chat',
      modelId: body.modelId ?? null,
      agentMode: body.agentMode,
    });

    setAudit({
      teamId: team.id,
      resourceId: projectId,
      summary: `Created project ${project.name} from the ${template?.name ?? 'blank'} template`,
      metadata: {
        template: templateKey,
        runtimeTarget: body.runtimeTarget,
        filesCreated: scaffold.filesCreated,
        role: access.role,
      },
    });

    return created({
      project: serializeProject(project),
      conversationId,
      template: template
        ? {
            key: template.key,
            name: template.name,
            setupCommands: template.setupCommands,
            devCommand: template.devCommand,
            devPort: template.devPort,
          }
        : null,
      filesCreated: scaffold.filesCreated,
    });
  },
);

/** Slugs are unique per team; collisions get a numeric suffix, never a 409. */
async function uniqueSlug(teamId: string, base: string): Promise<string> {
  const taken = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.teamId, teamId));

  const used = new Set(taken.map((row) => row.slug));
  if (!used.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
