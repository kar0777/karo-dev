import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { ConflictError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedSkills, projects, skills } from '@/lib/db/schema';
import { skillDraftSchema } from '@/lib/extensions/schemas';
import { loadTeamPlan } from '@/lib/extensions/service';
import { toInstalledSkillView, toSkillView, uniqueSkillKey } from '@/lib/extensions/skill-view';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * `/api/skills` — the catalogue plus this team's installations.
 *
 * A skill is a system-prompt fragment, so authoring one is a privileged action:
 * `skill.manage` is required, and the row is stamped with `ownerTeamId` so it
 * never leaks into another team's browse list.
 */

export const GET = defineHandler({ auth: 'required' }, async ({ user }) => {
  const { team } = await getActiveTeam(user.id);
  await requireApiTeamPermission(team.id, 'skill.read');

  const catalogue = await db
    .select()
    .from(skills)
    .where(or(isNull(skills.ownerTeamId), eq(skills.ownerTeamId, team.id)))
    .orderBy(asc(skills.name));

  const installations = await db
    .select({ installation: installedSkills, skill: skills, projectName: projects.name })
    .from(installedSkills)
    .innerJoin(skills, eq(skills.id, installedSkills.skillId))
    .leftJoin(projects, eq(projects.id, installedSkills.projectId))
    .where(eq(installedSkills.teamId, team.id))
    .orderBy(asc(skills.name));

  const plan = await loadTeamPlan(team.id);

  return json({
    skills: catalogue.map((row) => toSkillView(row, team.id)),
    installed: installations.map((row) =>
      toInstalledSkillView(row.installation, row.skill, row.projectName, team.id),
    ),
    limits: { maxSkills: plan.maxSkills, used: installations.length, planName: plan.name },
  });
});

export const POST = defineHandler(
  {
    auth: 'required',
    body: skillDraftSchema,
    audit: { action: AUDIT_ACTIONS.skillCreate, resourceType: 'skill' },
  },
  async ({ user, body, setAudit }) => {
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'skill.manage');

    const duplicateCommand = findDuplicateCommand(body.slashCommands);
    if (duplicateCommand) {
      throw new ConflictError(`The slash command /${duplicateCommand} is listed twice.`, {
        title: 'Duplicate slash command',
        description:
          'Each command in a skill needs a unique name. Rename or remove one of them.',
      });
    }

    const [existingName] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.ownerTeamId, team.id), eq(skills.name, body.name)))
      .limit(1);
    if (existingName) {
      throw new ConflictError(`Your team already has a skill called "${body.name}".`, {
        title: 'Name already used',
        description: 'Pick a different name, or edit the existing skill instead.',
      });
    }

    const id = newId(ID_PREFIX.skill);
    const [row] = await db
      .insert(skills)
      .values({
        id,
        key: await uniqueSkillKey(body.name),
        name: body.name,
        description: body.description,
        instructions: body.instructions,
        version: body.version,
        author: user.name || user.email,
        icon: body.icon,
        category: body.category,
        allowedTools: body.allowedTools,
        requiredPlugins: body.requiredPlugins,
        slashCommands: body.slashCommands,
        environmentSchema: body.environmentSchema,
        origin: 'custom',
        ownerTeamId: team.id,
        isPublic: false,
      })
      .returning();

    if (!row) throw new ConflictError('The skill could not be saved. Try again.');

    setAudit({
      teamId: team.id,
      resourceId: id,
      summary: `Skill "${body.name}" authored`,
      metadata: { key: row.key, commands: body.slashCommands.map((c) => c.name) },
    });

    return created({ skill: toSkillView(row, team.id) });
  },
);

function findDuplicateCommand(commands: Array<{ name: string }>): string | null {
  const seen = new Set<string>();
  for (const command of commands) {
    if (seen.has(command.name)) return command.name;
    seen.add(command.name);
  }
  return null;
}
