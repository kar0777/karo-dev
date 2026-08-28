import { resetPasswordSchema } from '@/components/auth/schemas';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { resetPassword } from '@/lib/auth/service';
import { destroySession } from '@/lib/auth/session';

/**
 * POST /api/auth/reset-password — consume a reset token and set a new password.
 *
 * `resetPassword` revokes every session for the account, including whichever one
 * is making this request. Clearing the cookie afterwards keeps the browser
 * honest about that rather than leaving it holding a token that silently no
 * longer resolves.
 *
 * No new session is issued: proving you can read an inbox should not be enough
 * to be signed in, and the sign-in screen is one tap away.
 */
export const POST = defineHandler(
  {
    auth: 'optional',
    rateLimit: 'auth.reset',
    body: resetPasswordSchema,
    audit: { action: AUDIT_ACTIONS.authPasswordReset, resourceType: 'user' },
  },
  async ({ body, setAudit }) => {
    const user = await resetPassword(body.token, body.password);

    await destroySession();

    setAudit({
      resourceId: user.id,
      severity: 'notice',
      summary: `Password reset completed for ${user.email}`,
    });

    return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  },
);
