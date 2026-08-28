import { publicUser, sessionOrigin } from '@/app/api/auth/_shared';
import { loginSchema } from '@/components/auth/schemas';
import { ApiError, RateLimitError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { authenticate } from '@/lib/auth/service';
import { createSession } from '@/lib/auth/session';
import type { User } from '@/lib/db/schema';
import { rateLimitPolicy } from '@/lib/rate-limit';

/**
 * POST /api/auth/login — exchange credentials for a session cookie.
 *
 * `authenticate()` is deliberately the only thing that decides *why* a sign-in
 * failed; this route just makes sure both the successful and the failed attempt
 * end up in the audit trail, since a run of failures on one address is the
 * signal a security review is actually looking for.
 */
export const POST = defineHandler(
  {
    auth: 'none',
    rateLimit: 'auth.login',
    body: loginSchema,
    audit: { action: AUDIT_ACTIONS.authLogin, resourceType: 'user' },
  },
  async ({ body, req, ip, setAudit }) => {
    // `auth.login` is scoped `ip+identifier`, and `defineHandler` can only cap
    // the IP half — the address is not known until the body is parsed. This is
    // the second, narrower bucket that makes the policy what it claims to be.
    const perAccount = await rateLimitPolicy('auth.login', `${ip}:${body.email}`);
    if (!perAccount.allowed) {
      throw new RateLimitError(
        perAccount.retryAfterSeconds,
        'Too many sign-in attempts for this email address.',
      );
    }

    let user: User;
    try {
      user = await authenticate({ email: body.email, password: body.password });
    } catch (error) {
      await recordAudit({
        action: AUDIT_ACTIONS.authLoginFailed,
        actorType: 'system',
        resourceType: 'user',
        severity: 'warning',
        summary: `Failed sign-in for ${body.email}`,
        metadata: {
          email: body.email,
          reason: error instanceof ApiError ? error.code : 'unknown',
        },
        request: req,
      });
      throw error;
    }

    await createSession(user.id, sessionOrigin(req, ip));

    setAudit({
      resourceId: user.id,
      teamId: user.defaultTeamId,
      summary: `${user.email} signed in`,
    });

    return json({ user: publicUser(user) }, { headers: { 'cache-control': 'no-store' } });
  },
);
