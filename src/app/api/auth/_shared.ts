import type { NextRequest } from 'next/server';

import type { SessionOrigin } from '@/lib/auth/session';
import type { User } from '@/lib/db/schema';

/**
 * Shapes shared by the auth route handlers.
 *
 * Not a `route.ts`, so the App Router never treats it as an endpoint.
 */

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  platformRole: User['platformRole'];
  isDemo: boolean;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  locale: string;
};

/**
 * The only user shape that crosses the wire. Field names match `SessionUser` in
 * the app shell so a client can hand one to the other unchanged, and timestamps
 * collapse to booleans because that is the whole question the UI ever asks of
 * them.
 *
 * Everything sensitive — the password hash, the suspension flag, the default
 * team id — is left out by construction rather than by deletion.
 */
export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    platformRole: user.platformRole,
    isDemo: user.isDemo,
    emailVerified: Boolean(user.emailVerifiedAt),
    onboardingCompleted: Boolean(user.onboardingCompletedAt),
    locale: user.locale,
  };
}

/**
 * Provenance stamped on a new session row — it is what makes the "active
 * devices" list in Settings mean anything. `unknown` is the sentinel
 * `clientIpFromRequest` returns when there is no proxy header to read; storing
 * it as a literal string would be worse than storing nothing.
 */
export function sessionOrigin(req: NextRequest, ip: string): SessionOrigin {
  return {
    userAgent: req.headers.get('user-agent'),
    ipAddress: ip === 'unknown' ? null : ip,
  };
}
