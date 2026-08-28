import { NextResponse } from 'next/server';

import { defineHandler } from '@/lib/api/handler';
import { createSession, type SessionOrigin } from '@/lib/auth/session';
import {
  isOAuthProviderKey,
  OAUTH_STATE_COOKIE,
  readOAuthState,
  signInWithOAuth,
} from '@/lib/auth/oauth';

/**
 * `GET /api/auth/oauth/<provider>/callback` — the consent screen comes back
 * here with `code` and `state`.
 *
 * The state must match the cookie set at the start, name the same provider,
 * and be younger than ten minutes; the code is exchanged for a token, the
 * token for a profile, and the profile for a session — matched by provider
 * account id first, then by verified email (which links the identity onto an
 * existing password account instead of duplicating it). A suspended account
 * gets the same refusal a password login would give.
 */

export const GET = defineHandler(
  { auth: 'none', csrf: false, rateLimit: 'auth.login' },
  async ({ req, params, ip, setAudit }) => {
    const raw = params.provider;
    const provider = Array.isArray(raw) ? raw[0] : raw;
    const url = new URL(req.url);

    const fail = (notice: string) => {
      const target = new URL('/login', req.url);
      target.searchParams.set('error', notice);
      const response = NextResponse.redirect(target);
      response.cookies.delete(OAUTH_STATE_COOKIE);
      return response;
    };

    const providerError = url.searchParams.get('error');
    if (providerError) return fail('oauth_denied');

    if (!provider || !isOAuthProviderKey(provider)) return fail('oauth_failed');

    const code = url.searchParams.get('code');
    const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
    const [stateProvider, ...stateRest] = cookieState?.split(':') ?? [];
    const state = readOAuthState(stateRest.join(':'));
    if (!code || !state || stateProvider !== provider) return fail('oauth_state');

    try {
      const { user, created } = await signInWithOAuth(provider, code);

      if (user.isSuspended) return fail('account_suspended');

      const origin: SessionOrigin = {
        ipAddress: ip ?? null,
        userAgent: req.headers.get('user-agent'),
      };
      await createSession(user.id, origin);

      setAudit({
        resourceId: user.id,
        teamId: user.defaultTeamId,
        summary: created
          ? `New account via ${provider} OAuth for ${user.email}`
          : `Signed in via ${provider} OAuth`,
      });

      const target = new URL(state.nextPath ?? '/app', req.url);
      const response = NextResponse.redirect(target);
      response.cookies.delete(OAUTH_STATE_COOKIE);
      return response;
    } catch {
      return fail('oauth_failed');
    }
  },
);
