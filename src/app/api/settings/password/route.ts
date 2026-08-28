import { z } from 'zod';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { changePassword } from '@/lib/auth/service';
import { createSession, destroyAllSessions } from '@/lib/auth/session';
import { MIN_PASSWORD_LENGTH } from '@/lib/crypto/password';

/**
 * Change password for a signed-in user.
 *
 * Every other session is revoked and the current one is re-issued. A password
 * change is usually a reaction to "someone may have my old one", so leaving
 * previously-issued cookies alive would defeat the point.
 */

const bodySchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(256),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(256),
});

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'auth.reset',
    body: bodySchema,
    audit: { action: AUDIT_ACTIONS.authPasswordChanged, resourceType: 'user' },
  },
  async ({ user, body, req, ip, setAudit }) => {
    await changePassword(user.id, body.currentPassword, body.newPassword);

    const revoked = await destroyAllSessions(user.id);
    await createSession(user.id, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: ip === 'unknown' ? null : ip,
    });

    setAudit({
      resourceId: user.id,
      severity: 'notice',
      summary: 'Password changed and other sessions signed out',
      metadata: { revokedSessions: Math.max(0, revoked - 1) },
    });

    return json({
      ok: true,
      // `revoked` counts the current session too; it was immediately replaced.
      signedOutSessions: Math.max(0, revoked - 1),
    });
  },
);
