/**
 * The CSRF header name, on its own.
 *
 * Both sides of the double-submit check need this constant, but they live in
 * very different worlds: `@/lib/api/csrf` verifies the token and therefore
 * reaches into the session, the database and `next/headers`, while
 * `@/lib/client/api` only has to spell the header correctly. Importing the
 * former from the latter pulled the entire server graph — postgres, `net`,
 * `tls` — into every browser bundle that made an API call.
 *
 * Keeping the name in a dependency-free leaf module is what stops that: this
 * file must never import anything.
 */
export const CSRF_HEADER = 'x-karo-csrf';
