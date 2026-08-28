import { and, eq } from 'drizzle-orm';

import { INVITATION_TTL_DAYS, invitationExpiry, invitationUrl } from '@/lib/account/team';
import { pathParam } from '@/lib/account/route-params';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { sendEmail, teamInviteEmail } from '@/lib/auth/email';
import { getActiveTeam } from '@/lib/auth/guards';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { invitations } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { newToken } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { ROLE_LABELS, assertCan } from '@/lib/rbac/permissions';

/**
 * Resend (`POST`) and revoke (`DELETE`) one invitation.
 *
 * Resend deliberately mints a **new** token and invalidates the old link. The
 * old one is unreproducible anyway — only its hash was kept — and rotating it
 * means a link forwarded to the wrong person stops working.
 */

const log = createLogger('api:team:invitations:id');

async function loadPending(teamId: string, id: string) {
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, id), eq(invitations.teamId, teamId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError('That invitation does not exist.', {
      title: 'Invitation not found',
      description:
        'It was revoked or already accepted. Reload the page to see what is pending.',
    });
  }
  return row;
}

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.teamInvite, resourceType: 'invitation' },
  },
  async ({ user, params, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'team.invite');

    const id = pathParam(params, 'id');
    const existing = await loadPending(team.id, id);

    if (existing.status !== 'pending') {
      throw new ConflictError('That invitation is no longer pending.', {
        title: `Invitation already ${existing.status}`,
        description:
          'Only pending invitations can be resent. Send a new invitation if this person still needs access.',
      });
    }

    const token = newToken(32);
    const expiresAt = invitationExpiry();

    await db
      .update(invitations)
      .set({ tokenHash: sha256(token), expiresAt, invitedById: user.id })
      .where(eq(invitations.id, id));

    const url = invitationUrl(env.APP_URL, token);

    try {
      await sendEmail({
        to: existing.email,
        ...teamInviteEmail(
          { email: existing.email },
          {
            teamName: team.name,
            roleLabel: ROLE_LABELS[existing.role],
            inviterName: user.name || user.email,
            url,
            expiresInDays: INVITATION_TTL_DAYS,
          },
        ),
      });
    } catch (error) {
      log.error('Could not resend the invitation email', { invitationId: id, error });
    }

    setAudit({
      teamId: team.id,
      resourceId: id,
      summary: `Invitation to ${existing.email} resent with a new link`,
      metadata: { email: existing.email, role: existing.role },
    });

    return json({
      invitation: {
        id: existing.id,
        email: existing.email,
        role: existing.role,
        invitedByName: user.name || user.email,
        createdAt: existing.createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        expired: false,
      },
      inviteUrl: url,
    });
  },
);

export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.teamInviteRevoke, resourceType: 'invitation' },
  },
  async ({ user, params, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'team.invite');

    const id = pathParam(params, 'id');
    const existing = await loadPending(team.id, id);

    await db
      .update(invitations)
      .set({
        status: 'revoked',
        // Burns the outstanding link immediately, not just at its expiry.
        tokenHash: sha256(`revoked:${id}:${newToken(16)}`),
      })
      .where(eq(invitations.id, id));

    setAudit({
      teamId: team.id,
      resourceId: id,
      severity: 'notice',
      summary: `Invitation to ${existing.email} revoked`,
      metadata: { email: existing.email },
    });

    return json({ ok: true });
  },
);
