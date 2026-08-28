import { z } from 'zod';

import { authenticateWorker, markWorkerSeen } from '@/app/api/worker/_auth';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { complete } from '@/lib/sandbox/worker-bus';

/**
 * `POST /api/worker/result` — the reply to a queued command. Step 4 of the
 * Karo Worker Protocol v1.
 *
 * Resolving the promise the sandbox provider is awaiting is the entire job. A
 * result for a command the bus no longer knows about — one that already timed
 * out, or that belonged to a process that has since restarted — is *dropped,
 * not rejected*: the worker did nothing wrong, and answering with an error
 * would make it retry a command whose caller has already given up.
 *
 * `accepted: false` tells the worker the result was too late to matter.
 */

export const dynamic = 'force-dynamic';

const body = z.object({
  commandId: z.string().min(1).max(64),
  ok: z.boolean(),
  /** Shape depends on the command kind; each provider validates its own. */
  data: z.unknown().optional(),
  error: z.string().max(8_000).optional(),
});

export const POST = defineHandler(
  { auth: 'none', csrf: false, rateLimit: false, body },
  async ({ req, body: input }) => {
    const worker = await authenticateWorker(req);
    await markWorkerSeen(worker);

    const accepted = complete(worker.id, {
      commandId: input.commandId,
      ok: input.ok,
      data: input.data,
      error: input.error,
    });

    return json({ accepted });
  },
);
