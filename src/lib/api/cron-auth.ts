import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { assertCsrf } from '@/lib/api/csrf';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';

/**
 * Authorisation for maintenance endpoints that two very different callers share:
 * a scheduler with no browser, and a platform admin with one.
 *
 * Getting this right by hand turned out to be a trap, and all three routes that
 * tried fell into a different hole:
 *
 *  · leaving the blanket CSRF check on rejects the scheduler, because `curl`
 *    sends no `Origin`, no `Referer` and no session token — so the endpoint's own
 *    documented cron line returns 403 and the feature it exists to trigger never
 *    runs;
 *  · turning CSRF off and forgetting to re-apply it on the session path drops a
 *    layer the app deliberately keeps. `SameSite=Lax` does block the obvious
 *    cross-site POST, but `csrf.ts` says in as many words that the double-submit
 *    check is there for what Lax does not cover, so silently opting an
 *    admin-only, state-changing route out of it is a downgrade, not a wash.
 *
 * So the route declares `csrf: false` — the only setting under which a scheduler
 * can call it at all — and hands the decision here, where the scheduler path and
 * the human path each get exactly the check that fits them. Returns which caller
 * it was, so a route can record it; throws the usual API errors otherwise.
 */
export async function authorizeCronOrAdmin(req: Request): Promise<'scheduler' | 'admin'> {
  if (hasCronSecret(req)) return 'scheduler';

  // No scheduler credential, so this is a browser: prove the request came from
  // Karo before proving the human behind it is allowed to do this.
  await assertCsrf(req);
  await requireApiPlatformAdmin();
  return 'admin';
}

/**
 * Constant-time check of `Authorization: Bearer $CRON_SECRET`.
 *
 * Read from `process.env` rather than the parsed env object because
 * `CRON_SECRET` is optional infrastructure config: a deployment that never
 * schedules anything should not have to set it, and when it is unset every
 * caller falls through to the admin-session path.
 */
export function hasCronSecret(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!presented) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, and that throw would itself
  // leak the expected length, so lengths are compared first.
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
