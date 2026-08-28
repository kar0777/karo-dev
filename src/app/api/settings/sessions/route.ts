import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';

import { describeSession, type SessionView } from '@/lib/account/sessions';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { db } from '@/lib/db';
import { sessions } from '@/lib/db/schema';

/**
 * Active sessions. `GET` powers the device list, `DELETE` is "sign out
 * everywhere else" — it deliberately spares the caller's own session so the
 * click does not log you out of the page you clicked it on.
 */

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ user, session }) => {
    const rows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastUsedAt));

    const views: SessionView[] = rows.map((row) => describeSession(row, session.id));
    return json({ sessions: views });
  },
);

export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.authSessionsRevoked, resourceType: 'session' },
  },
  async ({ user, session, setAudit }) => {
    const revoked = await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, user.id),
          isNull(sessions.revokedAt),
          ne(sessions.id, session.id),
        ),
      )
      .returning({ id: sessions.id });

    setAudit({
      resourceId: user.id,
      severity: 'notice',
      summary: `Signed out of ${revoked.length} other session${revoked.length === 1 ? '' : 's'}`,
      metadata: { revokedSessions: revoked.length },
    });

    return json({ revoked: revoked.length });
  },
);
