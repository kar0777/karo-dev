import { z } from 'zod';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { reportError } from '@/lib/observability/report';

/**
 * `POST /api/observability/client-error` — where a crashed browser says so.
 *
 * Every `error.tsx` in this app used to end in `console.error`, which writes to
 * the *visitor's* devtools. If the billing page throws for one customer on one
 * browser, nobody operating Karo finds out; the customer emails support and the
 * only artefact is a screenshot. This route is the missing half: the boundary
 * posts here, and the failure lands in the server log next to everything else.
 *
 * It is an unauthenticated writer into the log, so it is deliberately narrow:
 *
 *  · `auth: 'optional'` — the sign-in and marketing screens have no session, and
 *    those are exactly the pages whose breakage costs a sale. A session is used
 *    when present and never required.
 *  · Its own rate-limit bucket, 20/minute per IP, well under the API default.
 *  · Every field is length-capped in the schema, so the body cannot be used to
 *    write megabytes into the log.
 *  · Nothing from the request is echoed back, and the reporter redacts secret
 *    shapes out of the message and stack before either is written or forwarded.
 *  · No audit row: these are not actor-initiated events, and one broken page
 *    would otherwise flood the audit trail that exists for accountability.
 *
 * ---------------------------------------------------------------------------
 * WHY CSRF IS OFF HERE
 * ---------------------------------------------------------------------------
 * Karo's double-submit token lives in a module variable that the app shell sets
 * at render time (`setCsrfToken` in `@/lib/client/api`). `global-error.tsx`
 * replaces the entire document, root layout included — so in the one boundary
 * that catches the *worst* failures, that variable is gone and the header cannot
 * be sent. Leaving the check on would therefore drop exactly the reports most
 * worth having, and do it silently.
 *
 * That is an acceptable trade only because of what this route is: it changes no
 * state, reads nothing back, returns the same 202 to everyone, and is capped at
 * 20 requests per minute per IP. The whole of what a forged cross-site POST can
 * achieve is 20 junk lines a minute in a log — which an attacker can already do
 * by requesting a page that 500s. Nothing else in this app may copy this
 * reasoning without the same three properties holding.
 */

const body = z.object({
  message: z.string().min(1).max(2_000),
  name: z.string().max(200).optional(),
  stack: z.string().max(10_000).optional(),
  /**
   * The `digest` React puts on a Server Component error. This is the one field
   * that makes a client report worth having: it is printed on the error screen,
   * so a user can quote it and an operator can grep the server log for the
   * original stack that produced it.
   */
  digest: z.string().max(200).optional(),
  /** Where it happened, as the browser saw it. */
  path: z.string().max(500).optional(),
  /** Which boundary caught it — `app`, `admin`, `billing`, `global`, … */
  boundary: z.string().max(80).optional(),
});

export const POST = defineHandler(
  {
    auth: 'optional',
    csrf: false, // see the docblock — global-error.tsx cannot hold the token
    rateLimit: 'observability.clientError',
    body,
  },
  async ({ body: input, user }) => {
    await reportError({
      message: input.message,
      name: input.name,
      stack: input.stack,
      source: 'client',
      path: input.path,
      digest: input.digest,
      // Attached only when a session happens to exist. Never looked up, and
      // never required — see the docblock.
      userId: user?.id,
      extra: input.boundary ? { boundary: input.boundary } : undefined,
    });

    // 202: the report is recorded, and there is nothing for the client to do
    // with the outcome either way. A failed report must not turn into a second
    // error inside an error boundary.
    return json({ recorded: true }, { status: 202 });
  },
);
