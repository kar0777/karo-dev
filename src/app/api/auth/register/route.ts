import { publicUser, sessionOrigin } from '@/app/api/auth/_shared';
import { registerSchema } from '@/components/auth/schemas';
import { ForbiddenError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { isSignupEnabled, registerUser } from '@/lib/auth/service';
import { createSession } from '@/lib/auth/session';

/**
 * POST /api/auth/register — create an account and sign it in.
 *
 * `registerUser` provisions the personal team, the owner membership, the PAYG
 * balance and the entry subscription in one transaction, so there is never a
 * moment where a user exists without somewhere to work.
 */
export const POST = defineHandler(
  {
    auth: 'none',
    rateLimit: 'auth.register',
    body: registerSchema,
    audit: { action: AUDIT_ACTIONS.authRegister, resourceType: 'user' },
  },
  async ({ body, req, ip, setAudit }) => {
    if (!(await isSignupEnabled())) {
      throw new ForbiddenError('Public sign-up is switched off on this deployment.', {
        title: 'Sign-up is closed here',
        description:
          'An administrator disabled public registration for this installation. Ask a team owner to send you an invitation — accepting it creates your account.',
      });
    }

    const user = await registerUser({
      email: body.email,
      password: body.password,
      name: body.name,
    });

    await createSession(user.id, sessionOrigin(req, ip));

    setAudit({
      resourceId: user.id,
      teamId: user.defaultTeamId,
      summary: `New account for ${user.email}`,
    });

    return created({ user: publicUser(user) }, { headers: { 'cache-control': 'no-store' } });
  },
);
