import { NextResponse } from 'next/server';

import { defineHandler } from '@/lib/api/handler';
import {
  configuredOAuthProviders,
  isOAuthProviderKey,
  oauthAuthorizeUrl,
  OAUTH_STATE_COOKIE,
} from '@/lib/auth/oauth';

/**
 * `GET /api/auth/oauth/<provider>` — the start of the OAuth dance.
 *
 * Redirects to the provider's consent screen carrying a signed state value
 * that comes back on the callback; the same value is set as a short-lived
 * httpOnly cookie, so a callback this server never started is refused. An
 * unconfigured provider bounces back to /login with a notice instead of a
 * stack trace.
 */

export const GET = defineHandler(
  { auth: 'none', csrf: false, rateLimit: 'auth.login' },
  async ({ req, params }) => {
    const raw = params.provider;
    const provider = Array.isArray(raw) ? raw[0] : raw;

    if (!provider || !isOAuthProviderKey(provider)) {
      return NextResponse.redirect(new URL('/login', req.url));
    }

    if (!configuredOAuthProviders().includes(provider)) {
      const url = new URL('/login', req.url);
      url.searchParams.set('error', 'oauth_not_configured');
      return NextResponse.redirect(url);
    }

    const nextPath = new URL(req.url).searchParams.get('next') ?? '/app';
    const { url: authorizeUrl, state } = oauthAuthorizeUrl(provider, nextPath);

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(OAUTH_STATE_COOKIE, `${provider}:${state}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    return response;
  },
);
