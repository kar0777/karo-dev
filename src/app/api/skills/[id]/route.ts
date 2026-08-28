import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json, noContent } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedSkills, projects, skills } from '@/lib/db/schema';
import { skillConfigureSchema, skillDraftSchema } from '@/lib/extensions/schemas';
import {
  removeAllSkillCommands,
  setSkillCommandsEnabled,
  syncSkillCommands,
} from '@/lib/extensions/skill-commands';
import { mergeSecrets, pathParam } from '@/lib/extensions/service';
import { toInstalledSkillView, toSkillView } from '@/lib/extensions/skill-view';

/**
 * `/api/skills/[id]` — edit a skill your team authored, or reconfigure one of
 * your installations of it.
 *
 * Both live behind one endpoint because they address the same resource from the
 * user's point of view ("this skill"). The `kind` discriminator keeps the
 * server side unambiguous rather than guessing from which fields turned up.
 */

const patchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('definition'), ...skillDraftSchema.shape }),
  z.object({ kind: z.literal('installation'), ...skillConfigureSchema.shape }),
]);

export const PATCH = defineHandler(
  {
    auth: 'required',
    body: patchSchema,
    audit: { action: AUDIT_ACTIONS.skillInstall, resourceType: 'skill' },
  },
  async ({ user, body, params, setAudit }) => {
    const skillId = pathParam(params, 'id');
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'skill.manage');

    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (!skill) throw new NotFoundError('Skill not found.');

    if (body.kind === 'definition') {
      if (skill.ownerTeamId !== team.id) {
        throw new ForbiddenError('Only the team that authored a skill can edit it.', {
          title: 'This skill is read-only',
          description:
            'Official skills ship with Karo and cannot be edited. Export it, change what you need, and import it back as your own.',
        });
      }

      const [updated] = await db
        .update(skills)
        .set({
          name: body.name,
          description: body.description,
          instructions: body.instructions,
          version: body.version,
          icon: body.icon,
          category: body.category,
          allowedTools: body.allowedTools,
          requiredPlugins: body.requiredPlugins,
          slashCommands: body.slashCommands,
          environmentSchema: body.environmentSchema,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, skill.id))
        .returning();

      if (!updated) throw new ConflictError('The skill could not be saved. Try again.');

      await syncSkillCommands(team.id, updated);

      setAudit({
        teamId: team.id,
        resourceId: skill.id,
        summary: `Skill "${updated.name}" edited`,
        metadata: { version: updated.version },
      });

      return json({ skill: toSkillView(updated, team.id) });
    }

    /* installation branch ------------------------------------------------ */
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

    const declared = new Map(
      (skill.environmentSchema ?? []).map((field) => [field.key, field]),
    );

    const config: Record<string, string> = { ...(installation.config ?? {}) };
    for (const [key, value] of Object.entries(body.config ?? {})) {
      const field = declared.get(key);
      // Undeclared keys and secret fields are refused here — a secret must go
      // through `secrets` so it is encrypted rather than stored in the clear.
      if (!field || field.secret) continue;
      config[key] = value;
    }

    const secretPatch: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.secrets ?? {})) {
      const field = declared.get(key);
      if (!field || !field.secret) continue;
      secretPatch[key] = value;
    }

    const [updated] = await db
      .update(installedSkills)
      .set({
        isEnabled: body.isEnabled ?? installation.isEnabled,
        config,
        secretsCiphertext:
          Object.keys(secretPatch).length > 0
            ? mergeSecrets(installation.secretsCiphertext, secretPatch)
            : installation.secretsCiphertext,
        updatedAt: new Date(),
      })
      .where(eq(installedSkills.id, installation.id))
      .returning();

    if (!updated) throw new ConflictError('The configuration could not be saved. Try again.');

    await setSkillCommandsEnabled(team.id, skill.id, updated.projectId, updated.isEnabled);

    let projectName: string | null = null;
    if (updated.projectId) {
      const [project] = await db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, updated.projectId))
        .limit(1);
      projectName = project?.name ?? null;
    }

    setAudit({
      teamId: team.id,
      resourceId: skill.id,
      summary: `Skill "${skill.name}" reconfigured`,
      metadata: {
        installationId: updated.id,
        isEnabled: updated.isEnabled,
        secretKeys: Object.keys(secretPatch),
      },
    });

    return json({ installation: toInstalledSkillView(updated, skill, projectName, team.id) });
  },
);

export const DELETE = defineHandler(
  {
    auth: 'required',
    audit: { action: AUDIT_ACTIONS.skillUninstall, resourceType: 'skill', severity: 'notice' },
  },
  async ({ user, params, setAudit }) => {
    const skillId = pathParam(params, 'id');
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'skill.manage');

    const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);
    if (!skill) throw new NotFoundError('Skill not found.');

    if (skill.ownerTeamId !== team.id) {
      throw new ForbiddenError('Only the team that authored a skill can delete it.', {
        title: 'This skill is read-only',
        description:
          'Official skills ship with Karo. Uninstall it from your team instead of deleting the catalogue entry.',
      });
    }

    // Installations cascade with the skill row; the command projection does not.
    await removeAllSkillCommands(team.id, skill.id);
    await db.delete(skills).where(eq(skills.id, skill.id));

    setAudit({
      teamId: team.id,
      resourceId: skill.id,
      summary: `Skill "${skill.name}" deleted`,
      metadata: { key: skill.key },
    });

    return noContent();
  },
);
