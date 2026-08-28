import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { destroySession } from '@/lib/auth/session';

/**
 * POST /api/auth/logout — revoke this browser's session.
 *
 * `auth: 'optional'` because signing out twice, or from a tab whose session has
 * already expired, must succeed quietly. An error here would strand somebody on
 * a page they are trying to leave.
 */
export const POST = defineHandler(
  {
    auth: 'optional',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.authLogout, resourceType: 'session' },
  },
  async ({ session, setAudit }) => {
    await destroySession();

    if (session) {
      setAudit({ resourceId: session.id, summary: 'Signed out of this device' });
    } else {
      // Nothing happened, so there is nothing worth a row in the audit table.
      setAudit({ record: false });
    }

    return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  },
);
