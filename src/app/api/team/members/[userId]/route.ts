import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { pathParam } from '@/lib/account/route-params';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { teamMembers, users } from '@/lib/db/schema';
import { ROLE_LABELS, assertCan, assignableRoles, outranks } from '@/lib/rbac/permissions';

/**
 * One membership.
 *
 * Three invariants the UI mirrors but the server owns:
 *  · the **owner** is untouchable — not demotable, not removable;
 *  · you may never grant a role **above your own**, or act on someone who
 *    outranks you (or equals you: two admins cannot demote each other);
 *  · **leaving** is always allowed for a non-owner, even without
 *    `team.member.remove` — nobody should need permission to walk out.
 */

const patchSchema = z.object({
  role: z.enum(['owner', 'admin', 'developer', 'viewer']),
});

async function loadMembership(teamId: string, userId: string) {
  const rows = await db
    .select({ membership: teamMembers, user: users })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError('That person is not in this team.', {
      title: 'Member not found',
      description:
        'They already left or were removed. Reload the page to see the current roster.',
    });
  }
  return row;
}

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: patchSchema,
    audit: { action: AUDIT_ACTIONS.teamRoleChange, resourceType: 'team_member' },
  },
  async ({ user, body, params, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'team.role.update');

    const targetUserId = pathParam(params, 'userId');
    const target = await loadMembership(team.id, targetUserId);

    if (target.user.id === team.ownerId) {
      throw new ForbiddenError('The owner’s role cannot be changed.', {
        title: 'The owner keeps full control',
        description:
          'Every team needs exactly one owner. Transfer ownership first if this person should no longer have it.',
      });
    }

    if (body.role === 'owner') {
      throw new ForbiddenError('Ownership is transferred, not assigned.', {
        title: 'Cannot promote to owner',
        description:
          'A team has one owner. Ownership transfer is a separate, deliberate action — ask support if you need it moved.',
      });
    }

    if (!outranks(role, target.membership.role)) {
      throw new ForbiddenError(
        `Your role (${ROLE_LABELS[role]}) cannot change a ${ROLE_LABELS[target.membership.role]}.`,
        {
          title: 'You cannot change this member',
          description:
            'You can only change members below your own role. Ask an owner to make this change.',
        },
      );
    }

    if (!assignableRoles(role).includes(body.role)) {
      throw new ForbiddenError(`You cannot grant the ${ROLE_LABELS[body.role]} role.`, {
        title: 'Role above your own',
        description: 'You can only assign roles at or below your own level.',
      });
    }

    if (target.membership.role === body.role) {
      return json({ member: { userId: target.user.id, role: body.role }, changed: false });
    }

    await db
      .update(teamMembers)
      .set({ role: body.role })
      .where(eq(teamMembers.id, target.membership.id));

    setAudit({
      teamId: team.id,
      resourceId: target.user.id,
      severity: 'notice',
      summary: `${target.user.email} changed from ${ROLE_LABELS[target.membership.role]} to ${ROLE_LABELS[body.role]}`,
      metadata: { from: target.membership.role, to: body.role },
    });

    return json({ member: { userId: target.user.id, role: body.role }, changed: true });
  },
);

export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.teamMemberRemove, resourceType: 'team_member' },
  },
  async ({ user, params, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);

    const targetUserId = pathParam(params, 'userId');
    const leaving = targetUserId === user.id;

    if (!leaving) assertCan(role, 'team.member.remove');

    const target = await loadMembership(team.id, targetUserId);

    if (target.user.id === team.ownerId) {
      throw new ForbiddenError('The owner cannot be removed from their own team.', {
        title: 'Owners cannot be removed',
        description: leaving
          ? 'Transfer ownership to someone else first, or delete the team from Settings → Danger zone.'
          : 'Transfer ownership before removing this person.',
      });
    }

    if (!leaving && !outranks(role, target.membership.role)) {
      throw new ForbiddenError(
        `Your role (${ROLE_LABELS[role]}) cannot remove a ${ROLE_LABELS[target.membership.role]}.`,
        {
          title: 'You cannot remove this member',
          description:
            'You can only remove members below your own role. Ask an owner to do it.',
        },
      );
    }

    await db.delete(teamMembers).where(eq(teamMembers.id, target.membership.id));

    setAudit({
      teamId: team.id,
      resourceId: target.user.id,
      severity: 'notice',
      summary: leaving
        ? `${target.user.email} left the team`
        : `${target.user.email} removed from the team`,
      metadata: { role: target.membership.role, selfService: leaving },
    });

    return json({ ok: true, left: leaving });
  },
);
