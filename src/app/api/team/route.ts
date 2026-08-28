import { eq, ne, and } from 'drizzle-orm';
import { z } from 'zod';

import { AVATAR_COLORS } from '@/lib/account/preferences';
import { countSeats, listMembers, listPendingInvitations } from '@/lib/account/team';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { teams } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';
import { loadBillingContext } from '@/lib/usage/metering';
import { slugify } from '@/lib/utils';

/** The team itself: roster, seats and the owner-editable identity fields. */

const patchSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the team a name').max(60).optional(),
    slug: z
      .string()
      .trim()
      .min(2, 'Use at least 2 characters')
      .max(40)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Lower-case letters, numbers and hyphens only')
      .optional(),
    avatarColor: z.enum(AVATAR_COLORS).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ user }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'team.read');

    const billing = await loadBillingContext(team.id);
    const [members, invitations, seats] = await Promise.all([
      listMembers(team.id, team.ownerId),
      listPendingInvitations(team.id),
      countSeats(team.id, billing.plan.maxTeamMembers),
    ]);

    return json({
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        avatarColor: team.avatarColor,
        isPersonal: team.isPersonal,
        ownerId: team.ownerId,
      },
      role,
      members,
      invitations,
      seats,
      plan: {
        name: billing.plan.name,
        tier: billing.plan.tier,
        maxTeamMembers: billing.plan.maxTeamMembers,
      },
    });
  },
);

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: patchSchema,
    audit: { action: AUDIT_ACTIONS.teamUpdate, resourceType: 'team' },
  },
  async ({ user, body, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'team.update');

    const nextSlug = body.slug ? slugify(body.slug) : undefined;

    if (nextSlug && nextSlug !== team.slug) {
      const taken = await db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.slug, nextSlug), ne(teams.id, team.id)))
        .limit(1);

      if (taken.length > 0) {
        throw new ConflictError(`The handle "${nextSlug}" is already taken.`, {
          title: 'Handle already in use',
          description:
            'Team handles are unique across Karo because they appear in URLs. Try adding a word or a number.',
        });
      }
    }

    const updated = await db
      .update(teams)
      .set({
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(nextSlug === undefined ? {} : { slug: nextSlug }),
        ...(body.avatarColor === undefined ? {} : { avatarColor: body.avatarColor }),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, team.id))
      .returning();

    const row = updated[0];
    if (!row) throw new NotFoundError('Team not found.');

    setAudit({
      teamId: team.id,
      resourceId: team.id,
      summary: `Team settings updated`,
      metadata: { fields: Object.keys(body) },
    });

    return json({
      team: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        avatarColor: row.avatarColor,
        isPersonal: row.isPersonal,
        ownerId: row.ownerId,
      },
    });
  },
);
