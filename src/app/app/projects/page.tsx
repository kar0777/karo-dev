import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { desc, eq, sql } from 'drizzle-orm';

import { ProjectsBrowser } from '@/components/app/projects/projects-browser';
import type { ProjectView } from '@/components/app/projects/types';
import {
  loadModelOptions,
  loadProjectTemplates,
  loadSandboxStatusByProject,
  loadShellContext,
  loadWorkerOptions,
} from '@/components/app/shell-data';
import { ACTIVE_TEAM_COOKIE } from '@/components/app/team-switcher';
import { PageHeader } from '@/components/ui/page-header';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { conversations, models, plans, projects } from '@/lib/db/schema';
import { can } from '@/lib/rbac/permissions';
import { pluralize } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireUser();
  if (!user.onboardingCompletedAt) redirect('/app/onboarding');

  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);

  const active = await getActiveTeam(
    user.id,
    cookieStore.get(ACTIVE_TEAM_COOKIE)?.value ?? null,
  ).catch(() => getActiveTeam(user.id, null));

  const teamId = active.team.id;
  const context = await loadShellContext(user.id, teamId);

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      description: projects.description,
      template: projects.template,
      runtimeTarget: projects.runtimeTarget,
      workerId: projects.workerId,
      defaultModelId: projects.defaultModelId,
      defaultAgentMode: projects.defaultAgentMode,
      defaultShell: projects.defaultShell,
      modelName: models.displayName,
      archivedAt: projects.archivedAt,
      lastOpenedAt: projects.lastOpenedAt,
      updatedAt: projects.updatedAt,
      createdAt: projects.createdAt,
      conversationCount: sql<number>`(
        select count(*)::int from ${conversations}
        where ${conversations.projectId} = ${projects.id}
          and ${conversations.archivedAt} is null
      )`,
    })
    .from(projects)
    .leftJoin(models, eq(models.id, projects.defaultModelId))
    .where(eq(projects.teamId, teamId))
    .orderBy(desc(projects.lastOpenedAt), desc(projects.updatedAt));

  const [templates, modelOptions, workers, statuses, planRows] = await Promise.all([
    loadProjectTemplates(),
    loadModelOptions(),
    loadWorkerOptions(teamId),
    loadSandboxStatusByProject(
      teamId,
      rows.map((r) => r.id),
    ),
    db
      .select({
        allowOwnServer: plans.allowOwnServer,
        allowExternalSandbox: plans.allowExternalSandbox,
        maxProjects: plans.maxProjects,
      })
      .from(plans)
      .where(eq(plans.id, context.plan.id))
      .limit(1),
  ]);

  const planRow = planRows[0];

  const views: ProjectView[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    template: row.template,
    runtimeTarget: row.runtimeTarget,
    workerId: row.workerId,
    defaultModelId: row.defaultModelId,
    defaultAgentMode: row.defaultAgentMode,
    defaultShell: row.defaultShell,
    modelName: row.modelName,
    archived: row.archivedAt !== null,
    lastActivityAt: (row.lastOpenedAt ?? row.updatedAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
    sandboxStatus: statuses.get(row.id) ?? null,
    conversationCount: Number(row.conversationCount),
  }));

  const activeCount = views.filter((v) => !v.archived).length;
  const archivedCount = views.length - activeCount;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
      <PageHeader
        title="Projects"
        description={
          views.length === 0
            ? 'Every project is a workspace plus the machine it runs on. Create one to get started.'
            : `${activeCount} active ${pluralize(activeCount, 'project')}${
                archivedCount > 0 ? `, ${archivedCount} archived` : ''
              } in ${active.team.name}.`
        }
      />

      <div className="mt-4">
        <ProjectsBrowser
          projects={views}
          templates={templates}
          models={modelOptions}
          workers={workers}
          allowOwnServer={planRow?.allowOwnServer ?? true}
          allowExternalSandbox={planRow?.allowExternalSandbox ?? false}
          planName={context.plan.name}
          maxProjects={planRow?.maxProjects ?? context.plan.maxProjects}
          canCreate={can(active.role, 'project.create')}
          canUpdate={can(active.role, 'project.update')}
          canDelete={can(active.role, 'project.delete')}
          initialCreateOpen={params.new === '1'}
        />
      </div>
    </div>
  );
}
