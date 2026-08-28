import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { invitations, teamMembers, teams } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { ROLE_LABELS } from '@/lib/rbac/permissions';
import { loadBillingContext } from '@/lib/usage/metering';

/**
 * Accept a team invitation.
 *
 * The token is a bearer capability: whoever holds the link may join, as the
 * signed-in account. That is deliberate — invitations get forwarded to a work
 * address, and refusing anything but an exact email match turns a normal
 * situation into a support ticket. The join screen shows which address the
 * invitation was sent to and which account is about to be added, so the
 * decision is never silent, and the audit entry records both.
 */

const bodySchema = z.object({
  token: z.string().min(10, 'That invitation link is not valid').max(400),
});

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: { action: AUDIT_ACTIONS.teamInviteAccept, resourceType: 'invitation' },
  },
  async ({ user, body, setAudit }) => {
    const tokenHash = sha256(body.token.trim());

    const rows = await db
      .select({ invitation: invitations, team: teams })
      .from(invitations)
      .innerJoin(teams, eq(teams.id, invitations.teamId))
      .where(eq(invitations.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundError('This invitation link is not valid.', {
        title: 'Invitation not found',
        description:
          'The link may have been revoked, already used, or replaced by a newer one. Ask the team to send a fresh invitation.',
      });
    }

    const { invitation, team } = row;

    if (invitation.status !== 'pending') {
      throw new ConflictError(`This invitation was already ${invitation.status}.`, {
        title:
          invitation.status === 'accepted'
            ? 'Invitation already used'
            : 'Invitation no longer valid',
        description:
          invitation.status === 'accepted'
            ? 'Someone already joined with this link. Ask the team for a new invitation if you still need access.'
            : 'The team revoked this invitation. Ask them to send a new one.',
      });
    }

    if (invitation.expiresAt.getTime() < Date.now()) {
      await db
        .update(invitations)
        .set({ status: 'expired' })
        .where(eq(invitations.id, invitation.id));

      throw new ConflictError('This invitation has expired.', {
        title: 'Invitation expired',
        description:
          'Invitations are valid for seven days. Ask a team admin to resend it — that issues a fresh link.',
      });
    }

    const existing = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(invitations)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));

      return json({
        team: { id: team.id, name: team.name, slug: team.slug },
        role: invitation.role,
        alreadyMember: true,
      });
    }

    const billing = await loadBillingContext(team.id);
    const members = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, team.id));

    if (members.length >= billing.plan.maxTeamMembers) {
      throw new ForbiddenError(`${team.name} has no seats left.`, {
        title: 'The team is full',
        description: `Its ${billing.plan.name} plan includes ${billing.plan.maxTeamMembers} seat${billing.plan.maxTeamMembers === 1 ? '' : 's'}, and they are all taken. Ask an owner to upgrade the plan or free a seat, then use this link again.`,
      });
    }

    await db.transaction(async (tx) => {
      await tx.insert(teamMembers).values({
        id: newId(ID_PREFIX.teamMember),
        teamId: team.id,
        userId: user.id,
        role: invitation.role,
      });

      await tx
        .update(invitations)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
    });

    setAudit({
      teamId: team.id,
      resourceId: invitation.id,
      severity: 'notice',
      summary: `${user.email} joined as ${ROLE_LABELS[invitation.role]}`,
      metadata: {
        invitedEmail: invitation.email,
        acceptedByEmail: user.email,
        emailMatched: invitation.email.toLowerCase() === user.email.toLowerCase(),
        role: invitation.role,
      },
    });

    return json({
      team: { id: team.id, name: team.name, slug: team.slug },
      role: invitation.role,
      alreadyMember: false,
    });
  },
);
