import { and, eq, isNull } from 'drizzle-orm';

import { pathParam } from '@/lib/account/route-params';
import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { db } from '@/lib/db';
import { sessions } from '@/lib/db/schema';

/**
 * Revoke one session. Scoped to the caller's own rows, so an id belonging to
 * someone else is indistinguishable from an id that never existed.
 */
export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.authSessionsRevoked, resourceType: 'session' },
  },
  async ({ user, session, params, setAudit }) => {
    const sessionId = pathParam(params, 'sessionId');

    const revoked = await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });

    if (revoked.length === 0) {
      throw new NotFoundError('That session is not active.', {
        title: 'Session already ended',
        description:
          'It was signed out or expired before this request arrived. Refresh the list to see what is still active.',
      });
    }

    const wasCurrent = sessionId === session.id;

    setAudit({
      resourceId: sessionId,
      severity: 'notice',
      summary: wasCurrent ? 'Signed out of the current session' : 'Signed out of a session',
      metadata: { wasCurrent },
    });

    return json({ ok: true, wasCurrent });
  },
);
