import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { accounts, users, type User } from '@/lib/db/schema';
import { encryptSecret } from '@/lib/crypto/secrets';
import { registerOAuthUser } from '@/lib/auth/service';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth:oauth');

/**
 * Sign in with GitHub or Google — both free for this use.
 *
 * The flow is the plain authorization-code dance: start → provider consent →
 * callback. `state` is a random value stored in a short-lived httpOnly cookie
 * and compared on the way back (CSRF), and the returned identity is matched to
 * a user through the `accounts` table — by (provider, provider account id)
 * first, then by verified email, which links an OAuth identity onto an existing
 * password account rather than creating a duplicate.
 */

export type OAuthProviderKey = 'github' | 'google';

export const OAUTH_PROVIDER_KEYS: readonly OAuthProviderKey[] = ['github', 'google'];

export function isOAuthProviderKey(value: string): value is OAuthProviderKey {
  return (OAUTH_PROVIDER_KEYS as readonly string[]).includes(value);
}

/** Providers with a full credential pair in the environment, display order. */
export function configuredOAuthProviders(): OAuthProviderKey[] {
  const configured: OAuthProviderKey[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) configured.push('github');
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) configured.push('google');
  return configured;
}

export function oauthIsConfigured(provider: OAuthProviderKey): boolean {
  return configuredOAuthProviders().includes(provider);
}

/** The redirect URI registered with the provider, derived from APP_URL. */
export function oauthRedirectUri(provider: OAuthProviderKey): string {
  const base = env.APP_URL.replace(/\/+$/, '');
  return `${base}/api/auth/oauth/${provider}/callback`;
}

type ProviderConfig = {
  label: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  scope: string;
  authorizeUrl: (redirectUri: string, state: string, clientId: string) => string;
  exchange: (code: string, redirectUri: string) => Promise<{ accessToken: string }>;
  profile: (accessToken: string) => Promise<OAuthProfile>;
};

type OAuthProfile = {
  providerAccountId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

const GITHUB: ProviderConfig = {
  label: 'GitHub',
  clientId: () => env.GITHUB_CLIENT_ID,
  clientSecret: () => env.GITHUB_CLIENT_SECRET,
  scope: 'read:user user:email',
  authorizeUrl: (redirectUri, state, clientId) => {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', GITHUB.scope);
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchange: async (code, redirectUri) => {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as { access_token?: string; error?: string };
    if (!payload.access_token) {
      throw new Error(payload.error ?? 'GitHub did not return an access token.');
    }
    return { accessToken: payload.access_token };
  },
  profile: async (accessToken) => {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    };
    const [profileResponse, emailsResponse] = await Promise.all([
      fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(15_000) }),
      fetch('https://api.github.com/user/emails', {
        headers,
        signal: AbortSignal.timeout(15_000),
      }),
    ]);
    if (!profileResponse.ok) throw new Error('GitHub profile request failed.');
    const profile = (await profileResponse.json()) as {
      id: number;
      login: string;
      name?: string | null;
      email?: string | null;
      avatar_url?: string | null;
    };

    // GitHub may not expose a public email; the emails endpoint carries the
    // verified one, which is the only address safe to key an account on.
    let email = profile.email;
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      email =
        emails.find((entry) => entry.primary && entry.verified)?.email ??
        emails.find((entry) => entry.verified)?.email ??
        email;
    }
    if (!email) throw new Error('GitHub did not share a verified email address.');

    return {
      providerAccountId: String(profile.id),
      email,
      name: profile.name ?? profile.login,
      avatarUrl: profile.avatar_url ?? null,
    };
  },
};

const GOOGLE: ProviderConfig = {
  label: 'Google',
  clientId: () => env.GOOGLE_CLIENT_ID,
  clientSecret: () => env.GOOGLE_CLIENT_SECRET,
  scope: 'openid email profile',
  authorizeUrl: (redirectUri, state, clientId) => {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE.scope);
    url.searchParams.set('state', state);
    // The consent screen only re-appears when access was revoked; email is
    // re-checked on every sign-in through the token exchange anyway.
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  },
  exchange: async (code, redirectUri) => {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID ?? '',
        client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json()) as { access_token?: string; error?: string };
    if (!payload.access_token) {
      throw new Error(payload.error ?? 'Google did not return an access token.');
    }
    return { accessToken: payload.access_token };
  },
  profile: async (accessToken) => {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Google profile request failed.');
    const payload = (await response.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!payload.email || payload.email_verified === false) {
      throw new Error('Google did not share a verified email address.');
    }
    return {
      providerAccountId: payload.sub,
      email: payload.email,
      name: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
    };
  },
};

const PROVIDERS: Record<OAuthProviderKey, ProviderConfig> = { github: GITHUB, google: GOOGLE };

export function oauthProviderLabel(provider: OAuthProviderKey): string {
  return PROVIDERS[provider].label;
}

/* ------------------------------------------------------------------ *
 *  State — a random nonce bound to the browser, not to the server
 * ------------------------------------------------------------------ */

export const OAUTH_STATE_COOKIE = 'karo_oauth';

export function oauthStateValue(nextPath: string): string {
  // The next path rides inside the state so a stolen callback cannot aim the
  // session anywhere but where the flow started.
  const nonce = randomBytes(16).toString('hex');
  const payload = `${nonce}:${nextPath}`;
  const mac = createHash('sha256')
    .update(`${payload}:${env.GITHUB_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET ?? 'karo'}`)
    .digest('hex')
    .slice(0, 32);
  return `${Buffer.from(payload).toString('base64url')}.${mac}`;
}

export function readOAuthState(value: string | undefined): { nextPath: string } | null {
  if (!value) return null;
  const [encoded, mac] = value.split('.');
  if (!encoded || !mac) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = createHash('sha256')
    .update(`${payload}:${env.GITHUB_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET ?? 'karo'}`)
    .digest('hex')
    .slice(0, 32);
  if (mac !== expected) return null;
  const [nonce, nextPath] = payload.split(':');
  if (!nonce || nonce.length !== 32) return null;
  return { nextPath: nextPath ?? '/app' };
}

export function oauthAuthorizeUrl(
  provider: OAuthProviderKey,
  nextPath: string,
): { url: string; state: string } {
  const config = PROVIDERS[provider];
  const clientId = config.clientId();
  if (!clientId || !config.clientSecret()) {
    throw new Error(`${config.label} OAuth is not configured in this deployment.`);
  }
  const state = oauthStateValue(nextPath);
  return { url: config.authorizeUrl(oauthRedirectUri(provider), state, clientId), state };
}

/* ------------------------------------------------------------------ *
 *  Sign-in — exchange the code, match or create the user, link
 * ------------------------------------------------------------------ */

export async function signInWithOAuth(
  provider: OAuthProviderKey,
  code: string,
): Promise<{ user: User; created: boolean }> {
  const config = PROVIDERS[provider];

  const { accessToken } = await config.exchange(code, oauthRedirectUri(provider));
  const profile = await config.profile(accessToken);

  // 1. An existing link wins: same GitHub/Google identity, same account.
  const [linked] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(
      and(
        eq(accounts.provider, provider),
        eq(accounts.providerAccountId, profile.providerAccountId),
      ),
    )
    .limit(1);

  if (linked) {
    const [row] = await db.select().from(users).where(eq(users.id, linked.userId)).limit(1);
    if (row) return { user: row, created: false };
  }

  // 2. Same verified email → link the identity onto that account.
  const { user, created } = await registerOAuthUser({
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
  });

  await db
    .insert(accounts)
    .values({
      id: newId(ID_PREFIX.account),
      userId: user.id,
      provider,
      providerAccountId: profile.providerAccountId,
      accessTokenEncrypted: encryptSecret(accessToken),
      scope: config.scope,
    })
    .onConflictDoNothing();

  log.info('OAuth sign-in', { provider, userId: user.id, created });
  return { user, created };
}
