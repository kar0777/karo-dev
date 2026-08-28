import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { defineHandler } from '@/lib/api/handler';

/**
 * Serves the worker agent from the Karo install itself.
 *
 * The install one-liner used to point at `https://get.karo.dev/worker.sh`, a
 * domain that does not exist — so the command the UI handed people to paste on
 * their server could never do anything but fail. Nothing else served the script
 * either, which left `worker/karo-worker.mjs` reachable only by someone who
 * already had the repository checked out on the machine they were trying to
 * enrol. That is exactly the person who does not need an install command.
 *
 * Serving it from here removes the third party rather than replacing it: the
 * agent arrives from the same host the operator is already trusting with their
 * token, over the same connection, so there is one origin to verify instead of
 * two.
 *
 * Deliberately unauthenticated. The file is the published reference agent — it
 * is meant to be read before it is run — and it carries no secret. The token is
 * what grants access, and that is minted separately, per machine, and expires.
 */
export const GET = defineHandler({ auth: 'none', rateLimit: 'api.default' }, async () => {
  const source = await readFile(join(process.cwd(), 'worker', 'karo-worker.mjs'), 'utf8');

  return new Response(source, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'content-disposition': 'inline; filename="karo-worker.mjs"',
      // The agent is versioned with the deployment it talks to; a stale copy
      // would negotiate a protocol this control plane no longer speaks.
      'cache-control': 'no-store',
    },
  });
});
