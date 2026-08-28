import { cookies } from 'next/headers';
import { cache } from 'react';

import { and, eq, gt, isNull, lt } from 'drizzle-orm';

import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { sessions, users, type Session, type User } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { ID_PREFIX, newId, newToken } from '@/lib/ids';
import { createLogger } from '@/lib/logger';

/**
 * Cookie sessions backed by the `sessions` table.
 *
 * Why a database session and not a JWT: Karo has to be able to *revoke*. A
 * password reset, a suspended account or a "sign out everywhere" click must
 * take effect on the next request, not in fifteen minutes. The cookie carries
 * an opaque random token; only its SHA-256 is stored, so a database dump does
 * not hand an attacker live sessions.
 */

const log = createLogger('auth:session');

export const SESSION_COOKIE = 'karo_session';

export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Extend the session when the remaining lifetime has dropped by this much. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

/** Do not write `lastUsedAt` on every single request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type ActiveSession = {
  session: Session;
  user: User;
};

export type SessionOrigin = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

type CookieAttributes = {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  expires: Date;
  maxAge: number;
};

function cookieAttributes(expiresAt: Date): CookieAttributes {
  return {
    httpOnly: true,
    // `lax` still sends the cookie on top-level navigations, which is what a
    // magic link or an OAuth callback needs, while blocking cross-site POSTs.
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  };
}

/**
 * Writing a cookie is only legal in a route handler or a Server Action; in a
 * Server Component render Next throws. Sliding renewal is opportunistic, so we
 * swallow that specific failure rather than breaking the page.
 */
async function trySetCookie(token: string, expiresAt: Date): Promise<void> {
  try {
    const store = await cookies();
    store.set(SESSION_COOKIE, token, cookieAttributes(expiresAt));
  } catch {
    /* read-only cookie context — the session row is still valid */
  }
}

async function readCookie(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(SESSION_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 *  Lifecycle
 * ------------------------------------------------------------------ */

/**
 * Issues a session and sets the cookie. Returns the raw token — the only
 * moment it exists outside the browser.
 */
export async function createSession(
  userId: string,
  origin: SessionOrigin = {},
): Promise<string> {
  const token = newToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    id: newId(ID_PREFIX.session),
    userId,
    tokenHash: sha256(token),
    csrfToken: newToken(24),
    userAgent: origin.userAgent?.slice(0, 512) ?? null,
    ipAddress: origin.ipAddress ?? null,
    expiresAt,
    lastUsedAt: now,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieAttributes(expiresAt));

  return token;
}

/**
 * Resolves the current session. Memoised per request with React `cache()`, so
 * a layout, three Server Components and a route handler share one query.
 *
 * Returns `null` — never throws — when the cookie is missing, the session is
 * revoked or expired, *or the database is unreachable*. A dead database must
 * render a signed-out page, not a 500 loop.
 */
export const getSession = cache(async (): Promise<ActiveSession | null> => {
  const token = await readCookie();
  if (!token) return null;

  const tokenHash = sha256(token);

  try {
    const rows = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const refreshed = await touchSession(row.session, token);
    return { session: refreshed, user: row.user };
  } catch (error) {
    log.error('Session lookup failed — treating the request as signed out', { error });
    return null;
  }
});

/**
 * Sliding renewal. Cheap path: bump `lastUsedAt` at most every few minutes.
 * Expensive path (once a day at most): extend the expiry and re-issue the
 * cookie so an active user is never signed out mid-session.
 */
async function touchSession(session: Session, token: string): Promise<Session> {
  const now = Date.now();
  const shouldRenew = session.expiresAt.getTime() - now < SESSION_TTL_MS - RENEW_AFTER_MS;
  const shouldTouch = now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS;

  if (!shouldRenew && !shouldTouch) return session;

  const lastUsedAt = new Date(now);
  const expiresAt = shouldRenew ? new Date(now + SESSION_TTL_MS) : session.expiresAt;

  try {
    await db.update(sessions).set({ lastUsedAt, expiresAt }).where(eq(sessions.id, session.id));
    if (shouldRenew) await trySetCookie(token, expiresAt);
  } catch (error) {
    log.warn('Could not refresh the session row', { sessionId: session.id, error });
    return session;
  }

  return { ...session, lastUsedAt, expiresAt };
}

/** Signs the current browser out. Safe to call when already signed out. */
export async function destroySession(): Promise<void> {
  const token = await readCookie();

  if (token) {
    try {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt)));
    } catch (error) {
      log.warn('Could not revoke the session row', { error });
    }
  }

  try {
    const store = await cookies();
    store.set(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    });
  } catch {
    /* read-only cookie context */
  }
}

/**
 * Revokes every live session for a user. Called on password reset, on
 * suspension, and from "sign out of all devices". Returns the number revoked.
 */
export async function destroyAllSessions(userId: string): Promise<number> {
  try {
    const revoked = await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return revoked.length;
  } catch (error) {
    log.error('Could not revoke sessions for user', { userId, error });
    return 0;
  }
}

/**
 * Replaces the current session with a fresh one, preserving the signed-in user.
 * Run this after any privilege change (password change, email verification) so
 * a stolen pre-change token stops working.
 */
export async function rotateSession(): Promise<string | null> {
  const active = await getSession();
  if (!active) return null;

  try {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, active.session.id));
  } catch (error) {
    log.warn('Could not revoke the previous session during rotation', { error });
  }

  return createSession(active.user.id, {
    userAgent: active.session.userAgent,
    ipAddress: active.session.ipAddress,
  });
}

/** The CSRF token bound to this session, or `null` when signed out. */
export async function getCsrfToken(): Promise<string | null> {
  const active = await getSession();
  return active?.session.csrfToken ?? null;
}

/** Convenience for Server Components that only need the user. */
export async function getCurrentUser(): Promise<User | null> {
  return (await getSession())?.user ?? null;
}

/** Every live session for a user — powers the "active devices" list. */
export async function listUserSessions(userId: string): Promise<Session[]> {
  try {
    return await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
  } catch (error) {
    log.error('Could not list sessions', { userId, error });
    return [];
  }
}

/** Housekeeping: drop rows whose expiry has long passed. */
export async function pruneExpiredSessions(olderThan = new Date()): Promise<number> {
  try {
    const removed = await db
      .delete(sessions)
      .where(lt(sessions.expiresAt, olderThan))
      .returning({ id: sessions.id });
    return removed.length;
  } catch (error) {
    log.error('Could not prune expired sessions', { error });
    return 0;
  }
}
