import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { skillDocumentSchema } from '@/lib/extensions/schemas';
import { toSkillView, uniqueSkillKey } from '@/lib/extensions/skill-view';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * `POST /api/skills/import` — create a team skill from an exported document.
 *
 * Accepts either the parsed object (`{ skill: {...} }`) or the raw file text
 * (`{ json: "..." }`), because the dialog supports both paste and file upload
 * and neither should have to parse on the client to be validated on the server.
 */

const importSchema = z
  .object({
    skill: skillDocumentSchema.optional(),
    json: z.string().max(200_000).optional(),
  })
  .refine((value) => value.skill !== undefined || value.json !== undefined, {
    message: 'Paste a skill document or choose a file to import.',
  });

export const POST = defineHandler(
  {
    auth: 'required',
    body: importSchema,
    audit: { action: AUDIT_ACTIONS.skillCreate, resourceType: 'skill' },
  },
  async ({ user, body, setAudit }) => {
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'skill.manage');

    let candidate: unknown = body.skill;
    if (candidate === undefined) {
      try {
        candidate = JSON.parse(body.json ?? '');
      } catch {
        throw new ValidationError(
          'That file is not valid JSON.',
          [
            {
              path: 'json',
              message: 'The document could not be parsed.',
              code: 'invalid_json',
            },
          ],
          {
            title: 'Could not read the file',
            description:
              'Export a skill from Karo to see the expected shape, then paste the whole file including the outer braces.',
          },
        );
      }
    }

    const parsed = skillDocumentSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ValidationError(
        'That document is not a valid Karo skill.',
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
          code: issue.code,
        })),
        {
          title: 'The skill document is incomplete',
          description:
            'Every skill needs a name, a description and instructions. Fix the fields listed below and import again.',
        },
      );
    }

    const document = parsed.data;

    const [duplicate] = await db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.ownerTeamId, team.id), eq(skills.name, document.name)))
      .limit(1);
    if (duplicate) {
      throw new ConflictError(`Your team already has a skill called "${document.name}".`, {
        title: 'Name already used',
        description:
          'Rename the skill inside the document, or edit the existing one instead of importing a second copy.',
      });
    }

    const id = newId(ID_PREFIX.skill);
    const [row] = await db
      .insert(skills)
      .values({
        id,
        key: await uniqueSkillKey(document.key ?? document.name),
        name: document.name,
        description: document.description,
        instructions: document.instructions,
        version: document.version,
        author: document.author,
        icon: document.icon,
        category: document.category,
        allowedTools: document.allowedTools,
        requiredPlugins: document.requiredPlugins,
        slashCommands: document.slashCommands,
        environmentSchema: document.environmentSchema,
        origin: 'custom',
        ownerTeamId: team.id,
        isPublic: false,
      })
      .returning();

    if (!row) throw new ConflictError('The skill could not be imported. Try again.');

    setAudit({
      teamId: team.id,
      resourceId: id,
      summary: `Skill "${document.name}" imported`,
      metadata: { key: row.key, source: body.skill ? 'object' : 'file' },
    });

    return created({ skill: toSkillView(row, team.id) });
  },
);
