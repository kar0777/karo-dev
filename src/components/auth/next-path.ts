/**
 * `?next=` handling.
 *
 * The value is attacker-controllable — a phishing link can point at
 * `/login?next=https://evil.example` and hope the app performs the redirect for
 * it. Everything that is not an ordinary same-origin path collapses to the
 * fallback instead of throwing: a malformed `next` must never stop somebody
 * signing in, it just loses the deep link.
 *
 * Shared by the auth pages (Server Components) and the forms (Client
 * Components), so this module deliberately has no server-only imports.
 */

export const DEFAULT_AFTER_AUTH = '/app';

/** Redirecting back into the auth flow would loop the user straight back here. */
const AUTH_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/api',
];

/**
 * Written as a scan rather than a regex so the literal control characters never
 * have to appear in this file.
 */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function safeNextPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_AFTER_AUTH,
): string {
  if (typeof value !== 'string') return fallback;

  const candidate = value.trim();
  if (candidate === '') return fallback;

  // Must be a rooted path. This rejects `https://evil.example`, `evil.example`
  // and every other absolute form in one check.
  if (!candidate.startsWith('/')) return fallback;

  // `//evil.example` and `/\evil.example` are read as protocol-relative URLs by
  // browsers, and a backslash is normalised to a slash on the way there.
  if (candidate.startsWith('//') || candidate.includes('\\')) return fallback;

  // Control characters can smuggle a second target past a naive parser.
  if (hasControlCharacters(candidate)) return fallback;

  const path = candidate.split(/[?#]/)[0] ?? '';
  if (AUTH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return fallback;
  }

  return candidate;
}

/** First value of a `searchParams` entry, which Next may hand over as an array. */
export function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
