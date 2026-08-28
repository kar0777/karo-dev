import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { customCommands, installedSkills, skills } from '@/lib/db/schema';
import { sha256 } from '@/lib/crypto/secrets';

/**
 * Slash commands contributed by an installed skill are projected into
 * `custom_commands`, so the chat composer can list every available command with
 * one cheap query instead of loading and parsing every installed skill.
 *
 * The projection is derived state: install, edit and uninstall all rebuild it.
 * Row ids are deterministic (`cmd_<hash of skill+scope+name>`) so a rebuild is
 * idempotent and never accumulates duplicates.
 */

function commandId(skillId: string, projectId: string | null, name: string): string {
  return `cmd_${sha256(`${skillId}|${projectId ?? 'account'}|${name}`).slice(0, 24)}`;
}

export async function writeSkillCommands(
  teamId: string,
  skill: typeof skills.$inferSelect,
  projectId: string | null,
  isEnabled: boolean,
): Promise<void> {
  for (const command of skill.slashCommands ?? []) {
    await db
      .insert(customCommands)
      .values({
        id: commandId(skill.id, projectId, command.name),
        teamId,
        projectId,
        name: command.name,
        description: command.description,
        category: skill.category,
        prompt: command.prompt,
        source: 'skill',
        sourceRef: skill.id,
        isEnabled,
      })
      .onConflictDoUpdate({
        target: customCommands.id,
        set: {
          description: command.description,
          prompt: command.prompt,
          category: skill.category,
          isEnabled,
          updatedAt: new Date(),
        },
      });
  }
}

export async function removeSkillCommands(
  teamId: string,
  skillId: string,
  projectId: string | null,
): Promise<void> {
  const rows = await db
    .select({ id: customCommands.id, projectId: customCommands.projectId })
    .from(customCommands)
    .where(and(eq(customCommands.teamId, teamId), eq(customCommands.sourceRef, skillId)));

  for (const row of rows) {
    if (row.projectId !== projectId) continue;
    await db.delete(customCommands).where(eq(customCommands.id, row.id));
  }
}

export async function removeAllSkillCommands(teamId: string, skillId: string): Promise<void> {
  await db
    .delete(customCommands)
    .where(and(eq(customCommands.teamId, teamId), eq(customCommands.sourceRef, skillId)));
}

export async function setSkillCommandsEnabled(
  teamId: string,
  skillId: string,
  projectId: string | null,
  isEnabled: boolean,
): Promise<void> {
  const rows = await db
    .select({ id: customCommands.id, projectId: customCommands.projectId })
    .from(customCommands)
    .where(and(eq(customCommands.teamId, teamId), eq(customCommands.sourceRef, skillId)));

  for (const row of rows) {
    if (row.projectId !== projectId) continue;
    await db
      .update(customCommands)
      .set({ isEnabled, updatedAt: new Date() })
      .where(eq(customCommands.id, row.id));
  }
}

/** Rebuilds the projection for every installation this team has of one skill. */
export async function syncSkillCommands(
  teamId: string,
  skill: typeof skills.$inferSelect,
): Promise<void> {
  const installations = await db
    .select()
    .from(installedSkills)
    .where(and(eq(installedSkills.teamId, teamId), eq(installedSkills.skillId, skill.id)));

  await removeAllSkillCommands(teamId, skill.id);

  for (const installation of installations) {
    await writeSkillCommands(teamId, skill, installation.projectId, installation.isEnabled);
  }
}
