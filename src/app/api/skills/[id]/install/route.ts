import { and, eq, sql } from 'drizzle-orm';

import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedSkills, projects, skills } from '@/lib/db/schema';
import { skillInstallSchema } from '@/lib/extensions/schemas';
import {
  assertSkillQuota,
  loadTeamPlan,
  pathParam,
  scopeCondition,
} from '@/lib/extensions/service';
import { writeSkillCommands } from '@/lib/extensions/skill-commands';
import { toInstalledSkillView } from '@/lib/extensions/skill-view';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * `POST /api/skills/[id]/install` — install a skill for the whole account or
 * for one project. The plan's `maxSkills` is enforced here, not in the UI: the
 * button being hidden is a courtesy, this is the rule.
 */
export const POST = defineHandler(
  {
    auth: 'required',
    body: skillInstallSchema,
    audit: { action: AUDIT_ACTIONS.skillInstall, resourceType: 'skill' },
  },
  async ({ user, body, params, setAudit }) => {
    const skillId = pathParam(params, 'id');
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'skill.manage');

    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (!skill) throw new NotFoundError('Skill not found.');

    if (skill.ownerTeamId && skill.ownerTeamId !== team.id) {
      throw new ForbiddenError('That skill belongs to another team.', {
        title: 'Not available',
        description: 'Private skills are only installable by the team that authored them.',
      });
    }

    let projectId: string | null = null;
    let projectName: string | null = null;
    if (body.scope === 'project') {
      if (!body.projectId) {
        throw new NotFoundError('Pick the project to install this skill into.', {
          title: 'No project selected',
          description:
            'A project-scoped install needs a project. Choose one, or install it for the whole account.',
        });
      }
      const [project] = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.teamId, team.id)))
        .limit(1);
      if (!project) throw new NotFoundError('Project not found.');
      projectId = project.id;
      projectName = project.name;
    }

    const [existing] = await db
      .select({ id: installedSkills.id })
      .from(installedSkills)
      .where(
        and(
          eq(installedSkills.teamId, team.id),
          eq(installedSkills.skillId, skill.id),
          scopeCondition(installedSkills.projectId, projectId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictError(`"${skill.name}" is already installed in that scope.`, {
        title: 'Already installed',
        description:
          'Open the Installed tab to configure or disable it. To install it elsewhere, pick a different project.',
      });
    }

    const plan = await loadTeamPlan(team.id);
    await assertSkillQuota(team.id, plan);

    const id = newId(ID_PREFIX.installedSkill);
    const [installation] = await db
      .insert(installedSkills)
      .values({
        id,
        skillId: skill.id,
        teamId: team.id,
        projectId,
        installedById: user.id,
        scope: body.scope,
        version: skill.version,
        config: {},
      })
      .returning();

    if (!installation) throw new ConflictError('The skill could not be installed. Try again.');

    await db
      .update(skills)
      .set({ installCount: sql`${skills.installCount} + 1` })
      .where(eq(skills.id, skill.id));

    await writeSkillCommands(team.id, skill, projectId, true);

    setAudit({
      teamId: team.id,
      resourceId: skill.id,
      summary: `Skill "${skill.name}" installed`,
      metadata: { scope: body.scope, projectId, version: skill.version },
    });

    return created({
      installation: toInstalledSkillView(installation, skill, projectName, team.id),
    });
  },
);
