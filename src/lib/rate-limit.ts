import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { getRedis } from '@/lib/redis';

/**
 * Rate limiting.
 *
 * Algorithm: **weighted two-bucket sliding window**. A fixed window is trivial
 * to implement but lets a caller burst 2× the limit across a window boundary; a
 * true sorted-set sliding window needs Redis commands we deliberately do not
 * depend on (the in-memory fallback would have to reimplement them). Weighting
 * the previous bucket by the fraction of it still inside the window gives a
 * smooth, cheap approximation that never exceeds the limit by more than a few
 * percent, and needs only GET/INCR/EXPIRE.
 */

const log = createLogger('rate-limit');

const KEY_PREFIX = 'karo:rl';

export type RateLimitScope =
  /** One bucket per client IP. */
  | 'ip'
  /** One bucket per authenticated user (falls back to IP when anonymous). */
  | 'user'
  /** IP plus a caller-supplied identifier such as the submitted email. */
  | 'ip+identifier'
  /** A single bucket for the whole deployment. */
  | 'global';

export type RateLimitPolicy = {
  readonly limit: number;
  readonly windowSeconds: number;
  readonly scope: RateLimitScope;
  readonly description: string;
};

/**
 * Named policies. Route handlers reference these by key so a limit is changed
 * in exactly one place and shows up in the admin UI with its rationale.
 */
export const RATE_LIMITS = {
  'auth.login': {
    limit: 10,
    windowSeconds: 5 * 60,
    scope: 'ip+identifier',
    description: 'Sign-in attempts per IP and email address.',
  },
  'auth.register': {
    limit: 5,
    windowSeconds: 60 * 60,
    scope: 'ip',
    description: 'New accounts created per IP address.',
  },
  'auth.reset': {
    limit: 5,
    windowSeconds: 60 * 60,
    scope: 'ip+identifier',
    description: 'Password-reset and email-verification requests.',
  },
  'chat.message': {
    limit: 60,
    windowSeconds: 60,
    scope: 'user',
    description: 'Chat messages sent to the agent.',
  },
  'terminal.command': {
    limit: 120,
    windowSeconds: 60,
    scope: 'user',
    description: 'Commands submitted to a sandbox terminal.',
  },
  'sandbox.create': {
    limit: 10,
    windowSeconds: 60 * 60,
    scope: 'user',
    description: 'Sandboxes created.',
  },
  'api.default': {
    limit: 300,
    windowSeconds: 60,
    scope: 'user',
    description: 'Default ceiling for every authenticated API route.',
  },
  'observability.clientError': {
    limit: 20,
    windowSeconds: 60,
    scope: 'ip',
    description:
      'Client-side crash reports accepted per IP address. Scoped by IP rather than user because a crash on the sign-in screen has no session, and kept far below the default ceiling because the endpoint writes to the log: a genuinely broken page reports once per render attempt, so anything past this is abuse.',
  },
  webhook: {
    limit: 1000,
    windowSeconds: 60,
    scope: 'global',
    description: 'Inbound provider webhooks (Stripe, catalogue sync).',
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  /** Whole requests left in the current window; never negative. */
  remaining: number;
  resetAt: Date;
  /** `0` when allowed. Suitable for a `Retry-After` header. */
  retryAfterSeconds: number;
};

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowSeconds: number;
};

function unlimited(limit: number, windowSeconds: number): RateLimitResult {
  return {
    allowed: true,
    limit,
    remaining: limit,
    resetAt: new Date(Date.now() + windowSeconds * 1000),
    retryAfterSeconds: 0,
  };
}

export async function rateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { key, limit, windowSeconds } = options;

  if (env.RATE_LIMIT_DISABLED) return unlimited(limit, windowSeconds);
  if (limit <= 0 || windowSeconds <= 0) return unlimited(Math.max(limit, 0), 1);

  const redis = getRedis();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucket = Math.floor(now / windowMs);
  const elapsed = now - bucket * windowMs;
  const currentKey = `${KEY_PREFIX}:${key}:${bucket}`;
  const previousKey = `${KEY_PREFIX}:${key}:${bucket - 1}`;
  const resetAt = new Date((bucket + 1) * windowMs);

  try {
    const previousRaw = await redis.get(previousKey);
    const current = await redis.incr(currentKey);
    if (current === 1) {
      // Two windows of retention so the weighting above always has its input.
      await redis.expire(currentKey, windowSeconds * 2 + 1);
    }

    const previous = previousRaw ? Number.parseInt(previousRaw, 10) : 0;
    const weight = 1 - elapsed / windowMs;
    const estimate = current + (Number.isFinite(previous) ? previous : 0) * weight;

    const allowed = estimate <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, Math.floor(limit - estimate)),
      resetAt,
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((resetAt.getTime() - now) / 1000)),
    };
  } catch (error) {
    // Availability beats enforcement: a broken counter must not lock users out.
    log.error('Rate-limit check failed — allowing the request', { key, error });
    return unlimited(limit, windowSeconds);
  }
}

/** Applies a named policy. The caller supplies the already-scoped key part. */
export async function rateLimitPolicy(
  name: RateLimitName,
  keySuffix: string,
): Promise<RateLimitResult> {
  const policy = RATE_LIMITS[name];
  return rateLimit({
    key: `${name}:${keySuffix}`,
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
  });
}

/* ------------------------------------------------------------------ *
 *  Request helpers
 * ------------------------------------------------------------------ */

const IP_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'x-vercel-forwarded-for',
  'fly-client-ip',
  'true-client-ip',
] as const;

/**
 * The client IP, taken from the forwarding chain in the one position a client
 * cannot forge.
 *
 * This function used to read the **left-most** `x-forwarded-for` entry, which is
 * the opposite of safe: a client sends `X-Forwarded-For: 1.2.3.4`, the proxy
 * *appends* the real address, and the left-most value is therefore whatever the
 * attacker typed. Every IP-scoped limit — including `auth.login` — could be
 * bypassed with a fresh header per request, which is unlimited password
 * brute-forcing, and the forged address also landed in the audit log and the
 * "active devices" list.
 *
 * The right-most entries are appended by infrastructure, so the trustworthy
 * value is `TRUST_PROXY_HOPS` positions from the **right**:
 *
 *     X-Forwarded-For: <client-supplied…>, <real client>, <inner proxy>
 *                                          ^ hops = 1
 *
 * `TRUST_PROXY_HOPS=0` means "no proxy in front": forwarding headers are then
 * ignored entirely, since anything they contain is attacker-controlled.
 */
export function clientIpFromRequest(request: Request): string {
  const hops = trustedProxyHops();
  if (hops <= 0) return 'unknown';

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const chain = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Fewer entries than trusted hops means the chain is shorter than
    // configured; the left-most is then the closest thing to the real peer.
    const candidate = chain[Math.max(0, chain.length - hops)];
    if (candidate) return candidate;
  }

  // Single-value platform headers are overwritten by the platform that sets
  // them, so they are only meaningful when such a proxy is actually in front —
  // which is what a non-zero hop count asserts.
  for (const header of IP_HEADERS) {
    if (header === 'x-forwarded-for') continue;
    const raw = request.headers.get(header);
    const value = raw?.split(',')[0]?.trim();
    if (value) return value;
  }

  return 'unknown';
}

/**
 * How many proxies sit in front of the app. Defaults to 1 because every shipped
 * deployment topology (docker-compose.prod.yml, and any managed host) terminates
 * TLS at a load balancer that appends the real client address.
 */
function trustedProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === '') return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

/** Derives a rate-limit key from the forwarded IP, optionally namespaced. */
export function rateLimitKeyFromRequest(request: Request, suffix?: string): string {
  const ip = clientIpFromRequest(request);
  return suffix ? `${ip}:${suffix.toLowerCase()}` : ip;
}

/** Standard headers so clients can back off intelligently. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'x-ratelimit-limit': String(result.limit),
    'x-ratelimit-remaining': String(result.remaining),
    'x-ratelimit-reset': String(Math.floor(result.resetAt.getTime() / 1000)),
  };
  if (!result.allowed) headers['retry-after'] = String(result.retryAfterSeconds);
  return headers;
}
