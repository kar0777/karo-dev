import { publicUser } from '@/app/api/auth/_shared';
import { verifyEmailSchema } from '@/components/auth/schemas';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { verifyEmail } from '@/lib/auth/service';
import { rotateSession } from '@/lib/auth/session';

/**
 * POST /api/auth/verify-email — consume a confirmation token.
 *
 * `auth: 'optional'` because the link is frequently opened in a browser that is
 * not signed in — a phone, a different profile — and that should still confirm
 * the address. When there *is* a session and it belongs to the account being
 * confirmed, it is rotated: verification changes what the account may do, so a
 * token captured beforehand should stop working.
 */
export const POST = defineHandler(
  {
    auth: 'optional',
    rateLimit: 'auth.reset',
    body: verifyEmailSchema,
    audit: { action: AUDIT_ACTIONS.authEmailVerified, resourceType: 'user' },
  },
  async ({ body, user, setAudit }) => {
    const verified = await verifyEmail(body.token);

    if (user?.id === verified.id) {
      await rotateSession();
    }

    setAudit({
      resourceId: verified.id,
      summary: `${verified.email} confirmed their email address`,
    });

    return json({ user: publicUser(verified) }, { headers: { 'cache-control': 'no-store' } });
  },
);
