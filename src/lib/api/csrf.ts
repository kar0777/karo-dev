import { CSRF_HEADER } from '@/lib/api/csrf-header';
import { ForbiddenError } from '@/lib/api/errors';
import { getCsrfToken } from '@/lib/auth/session';
import { constantTimeEqual } from '@/lib/crypto/secrets';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

/**
 * Double-submit CSRF protection.
 *
 * The session cookie is `SameSite=Lax`, which already blocks cross-site POSTs
 * from modern browsers. This is the second layer for the cases Lax does not
 * cover (old browsers, some redirect flows) and it is cheap:
 *
 *  · a request carrying `x-karo-csrf` equal to the session's CSRF token passes
 *    — a cross-origin page cannot read that token, only the app can send it;
 *  · a request whose `Origin`/`Referer` is the app's own origin passes, which
 *    keeps `<form>` posts and same-origin `fetch` working without plumbing the
 *    token through every component.
 *
 * Webhook routes opt out explicitly (`csrf: false`) — they authenticate with a
 * provider signature instead and have no session to compare against.
 */

const log = createLogger('api:csrf');

// Re-exported so every existing `from '@/lib/api/csrf'` import keeps working;
// the constant itself lives in a leaf module the browser can safely reach.
export { CSRF_HEADER };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The origins that count as "us": the configured public URL plus whatever host
 * actually served this request (preview deployments, tunnels, `localhost` vs
 * `127.0.0.1` — all legitimate, none of them worth a config change).
 */
function trustedOrigins(request: Request): Set<string> {
  const origins = new Set<string>();

  const configured = originOf(env.APP_URL);
  if (configured) origins.add(configured);

  const self = originOf(request.url);
  if (self) origins.add(self);

  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host) {
    const proto =
      request.headers.get('x-forwarded-proto') ??
      (self?.startsWith('https') ? 'https' : 'http');
    const candidate = originOf(`${proto}://${host}`);
    if (candidate) origins.add(candidate);
  }

  return origins;
}

/** True when `Origin` or `Referer` names one of our own origins. */
export function isSameOrigin(request: Request): boolean {
  const allowed = trustedOrigins(request);
  const origin = request.headers.get('origin');

  if (origin) {
    // `null` is sent by sandboxed iframes and some redirects — never trust it.
    return origin !== 'null' && allowed.has(origin);
  }

  const referer = originOf(request.headers.get('referer'));
  return referer !== null && allowed.has(referer);
}

/**
 * Throws `ForbiddenError` when a state-changing request cannot be proven to
 * come from the app itself. No-ops for GET/HEAD/OPTIONS.
 */
export async function assertCsrf(request: Request): Promise<void> {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const provided = request.headers.get(CSRF_HEADER);
  if (provided) {
    const expected = await getCsrfToken();
    if (expected && constantTimeEqual(provided, expected)) return;

    log.warn('CSRF token mismatch', {
      method: request.method,
      path: safePath(request.url),
      hadSession: Boolean(expected),
    });
    throw csrfError();
  }

  if (isSameOrigin(request)) return;

  log.warn('CSRF check failed: no token and no same-origin proof', {
    method: request.method,
    path: safePath(request.url),
    origin: request.headers.get('origin'),
  });
  throw csrfError();
}

function csrfError(): ForbiddenError {
  return new ForbiddenError('This request could not be verified as coming from Karo.', {
    code: 'csrf_failed',
    title: 'Request could not be verified',
    description:
      'Your session may have expired in another tab. Reload the page and try again — nothing was changed.',
  });
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '[unparseable]';
  }
}
