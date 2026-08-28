import { eq } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { pathParam } from '@/lib/extensions/service';
import { toSkillDocument } from '@/lib/extensions/skill-view';

/**
 * `GET /api/skills/[id]/export` — downloads the skill as JSON.
 *
 * The document is exactly what `/api/skills/import` accepts, so exporting an
 * official skill, editing the instructions and importing it back is the
 * supported way to fork one.
 */
export const GET = defineHandler({ auth: 'required' }, async ({ user, params }) => {
  const skillId = pathParam(params, 'id');
  const { team } = await getActiveTeam(user.id);
  await requireApiTeamPermission(team.id, 'skill.read');

  const [skill] = await db.select().from(skills).where(eq(skills.id, skillId)).limit(1);

  if (!skill || (skill.ownerTeamId !== null && skill.ownerTeamId !== team.id)) {
    throw new NotFoundError('Skill not found.');
  }

  const document = toSkillDocument(skill);
  const filename = `${skill.key || 'skill'}.karo-skill.json`;

  return new Response(`${JSON.stringify(document, null, 2)}\n`, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
});
