import { publicUser, sessionOrigin } from '@/app/api/auth/_shared';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { loginDemoUser } from '@/lib/auth/service';
import { createSession } from '@/lib/auth/session';

/**
 * POST /api/auth/demo — one-click sign-in to the seeded demo account.
 *
 * Both gates live in `loginDemoUser`: the environment flag and the admin
 * setting. It also distinguishes "turned off" (403, with the reason) from "the
 * database was never seeded" (404, with the command to fix it) — which is the
 * difference between a policy decision and a broken install, and the person
 * pressing the button deserves to know which one they hit.
 */
export const POST = defineHandler(
  {
    auth: 'none',
    rateLimit: 'auth.login',
    audit: { action: AUDIT_ACTIONS.authDemoLogin, resourceType: 'user' },
  },
  async ({ req, ip, setAudit }) => {
    const user = await loginDemoUser();

    await createSession(user.id, sessionOrigin(req, ip));

    setAudit({
      resourceId: user.id,
      teamId: user.defaultTeamId,
      severity: 'notice',
      summary: 'Signed in to the shared demo account',
    });

    return json({ user: publicUser(user) }, { headers: { 'cache-control': 'no-store' } });
  },
);
