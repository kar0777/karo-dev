import { and, eq, sql } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedSkills, skills } from '@/lib/db/schema';
import { skillUninstallSchema } from '@/lib/extensions/schemas';
import { pathParam } from '@/lib/extensions/service';
import { removeSkillCommands } from '@/lib/extensions/skill-commands';

/**
 * `POST /api/skills/[id]/uninstall` — remove one installation. The skill row
 * itself survives; a team may still have it installed in another project.
 */
export const POST = defineHandler(
  {
    auth: 'required',
    body: skillUninstallSchema,
    audit: { action: AUDIT_ACTIONS.skillUninstall, resourceType: 'skill', severity: 'notice' },
  },
  async ({ user, body, params, setAudit }) => {
    const skillId = pathParam(params, 'id');
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'skill.manage');

    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (!skill) throw new NotFoundError('Skill not found.');

    const [installation] = await db
      .select()
      .from(installedSkills)
      .where(
        and(
          eq(installedSkills.id, body.installationId),
          eq(installedSkills.teamId, team.id),
          eq(installedSkills.skillId, skill.id),
        ),
      )
      .limit(1);
    if (!installation) throw new NotFoundError('That installation does not exist.');

    await removeSkillCommands(team.id, skill.id, installation.projectId);
    await db.delete(installedSkills).where(eq(installedSkills.id, installation.id));

    await db
      .update(skills)
      .set({ installCount: sql`greatest(${skills.installCount} - 1, 0)` })
      .where(eq(skills.id, skill.id));

    setAudit({
      teamId: team.id,
      resourceId: skill.id,
      summary: `Skill "${skill.name}" uninstalled`,
      metadata: { scope: installation.scope, projectId: installation.projectId },
    });

    return json({ ok: true, installationId: installation.id });
  },
);
