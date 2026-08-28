import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  INVITATION_TTL_DAYS,
  countSeats,
  invitationExpiry,
  invitationUrl,
  listPendingInvitations,
} from '@/lib/account/team';
import { ConflictError, ForbiddenError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { sendEmail, teamInviteEmail } from '@/lib/auth/email';
import { getActiveTeam } from '@/lib/auth/guards';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { invitations, teamMembers, users } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { ID_PREFIX, newId, newToken } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { ROLE_LABELS, assertCan, assignableRoles } from '@/lib/rbac/permissions';
import { loadBillingContext } from '@/lib/usage/metering';

/**
 * Team invitations.
 *
 * Only the SHA-256 of the token is stored, so the accept link is returned
 * exactly once — at creation and again on resend, which mints a fresh token.
 * That is why the UI offers "Resend" rather than "Copy link" on an old row:
 * Karo genuinely cannot reproduce a link it never kept.
 */

const log = createLogger('api:team:invitations');

const createSchema = z.object({
  email: z.email('Enter a valid email address').max(254),
  role: z.enum(['admin', 'developer', 'viewer']),
});

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ user }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'team.read');

    const billing = await loadBillingContext(team.id);
    const [pending, seats] = await Promise.all([
      listPendingInvitations(team.id),
      countSeats(team.id, billing.plan.maxTeamMembers),
    ]);

    return json({ invitations: pending, seats });
  },
);

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: createSchema,
    audit: { action: AUDIT_ACTIONS.teamInvite, resourceType: 'invitation' },
  },
  async ({ user, body, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'team.invite');

    if (!assignableRoles(role).includes(body.role)) {
      throw new ForbiddenError(`You cannot invite someone as ${ROLE_LABELS[body.role]}.`, {
        title: 'Role above your own',
        description: 'You can only invite people at or below your own role.',
      });
    }

    const email = body.email.trim().toLowerCase();
    const billing = await loadBillingContext(team.id);
    const seats = await countSeats(team.id, billing.plan.maxTeamMembers);

    if (seats.atLimit) {
      throw new ForbiddenError(
        `The ${billing.plan.name} plan includes ${billing.plan.maxTeamMembers} seat${billing.plan.maxTeamMembers === 1 ? '' : 's'}.`,
        {
          title: 'No seats left',
          description:
            'Every seat is taken by a member or a pending invitation. Revoke an invitation, remove a member, or upgrade the plan to add seats.',
          details: { seats },
        },
      );
    }

    const alreadyMember = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, team.id), sql`lower(${users.email}) = ${email}`))
      .limit(1);

    if (alreadyMember.length > 0) {
      throw new ConflictError(`${email} is already in this team.`, {
        title: 'Already a member',
        description: 'Change their role from the members table instead of inviting them again.',
      });
    }

    const outstanding = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.teamId, team.id),
          eq(invitations.status, 'pending'),
          sql`lower(${invitations.email}) = ${email}`,
        ),
      )
      .limit(1);

    if (outstanding.length > 0) {
      throw new ConflictError(`${email} already has a pending invitation.`, {
        title: 'Invitation already sent',
        description:
          'Use Resend on the pending invitation to issue a fresh link, or revoke it and start again.',
      });
    }

    const token = newToken(32);
    const expiresAt = invitationExpiry();
    const id = newId(ID_PREFIX.invitation);

    await db.insert(invitations).values({
      id,
      teamId: team.id,
      email,
      role: body.role,
      invitedById: user.id,
      tokenHash: sha256(token),
      status: 'pending',
      expiresAt,
    });

    const url = invitationUrl(env.APP_URL, token);

    try {
      await sendEmail({
        to: email,
        ...teamInviteEmail(
          { email },
          {
            teamName: team.name,
            roleLabel: ROLE_LABELS[body.role],
            inviterName: user.name || user.email,
            url,
            expiresInDays: INVITATION_TTL_DAYS,
          },
        ),
      });
    } catch (error) {
      // The link is still returned, so a broken mail transport does not block
      // the invite — the inviter can paste it into chat.
      log.error('Could not send the invitation email', { invitationId: id, error });
    }

    setAudit({
      teamId: team.id,
      resourceId: id,
      severity: 'notice',
      summary: `Invited ${email} as ${ROLE_LABELS[body.role]}`,
      metadata: { email, role: body.role },
    });

    return created({
      invitation: {
        id,
        email,
        role: body.role,
        invitedByName: user.name || user.email,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        expired: false,
      },
      // Shown once. The token itself is only stored as a hash.
      inviteUrl: url,
    });
  },
);
