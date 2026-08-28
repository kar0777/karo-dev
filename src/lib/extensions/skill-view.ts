import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { skills, type installedSkills } from '@/lib/db/schema';
import { secretKeyNames } from '@/lib/extensions/service';
import type { InstalledSkillView, SkillView } from '@/lib/extensions/types';
import { slugify } from '@/lib/utils';

export function toSkillView(
  skill: typeof skills.$inferSelect,
  teamId: string | null,
): SkillView {
  return {
    id: skill.id,
    key: skill.key,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    version: skill.version,
    author: skill.author,
    icon: skill.icon,
    category: skill.category,
    allowedTools: skill.allowedTools ?? [],
    requiredPlugins: skill.requiredPlugins ?? [],
    slashCommands: skill.slashCommands ?? [],
    environmentSchema: skill.environmentSchema ?? [],
    origin: skill.origin,
    isOwnedByTeam: Boolean(teamId && skill.ownerTeamId === teamId),
    installCount: skill.installCount,
    updatedAt: skill.updatedAt.toISOString(),
  };
}

export function toInstalledSkillView(
  installation: typeof installedSkills.$inferSelect,
  skill: typeof skills.$inferSelect,
  projectName: string | null,
  teamId: string,
): InstalledSkillView {
  return {
    id: installation.id,
    skillId: installation.skillId,
    scope: installation.scope,
    projectId: installation.projectId,
    projectName,
    isEnabled: installation.isEnabled,
    version: installation.version,
    config: installation.config ?? {},
    secretKeys: secretKeyNames(installation.secretsCiphertext),
    lastUsedAt: installation.lastUsedAt?.toISOString() ?? null,
    installedAt: installation.createdAt.toISOString(),
    skill: toSkillView(skill, teamId),
  };
}

/**
 * `skills.key` is globally unique, so a team authoring "Deploy helper" when
 * another team already owns `deploy-helper` must not collide. Suffixes are
 * numeric and bounded — a caller that cannot get a key in 50 tries is being
 * pathological and deserves the error.
 */
export async function uniqueSkillKey(preferred: string): Promise<string> {
  const base = slugify(preferred).slice(0, 48) || 'custom-skill';

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.key, candidate))
      .limit(1);
    if (!existing) return candidate;
  }

  throw new Error(`Could not derive a free skill key from "${preferred}".`);
}

/** The exported file format. Kept in step with `skillDocumentSchema`. */
export function toSkillDocument(skill: typeof skills.$inferSelect) {
  return {
    karoSkillVersion: 1 as const,
    key: skill.key,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    version: skill.version,
    author: skill.author,
    icon: skill.icon,
    category: skill.category,
    allowedTools: skill.allowedTools ?? [],
    requiredPlugins: skill.requiredPlugins ?? [],
    slashCommands: skill.slashCommands ?? [],
    environmentSchema: skill.environmentSchema ?? [],
  };
}
