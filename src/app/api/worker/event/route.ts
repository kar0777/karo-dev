import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { authenticateWorker, markWorkerSeen } from '@/app/api/worker/_auth';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { sandboxes } from '@/lib/db/schema';
import { emitEvent } from '@/lib/sandbox/worker-bus';

/**
 * `POST /api/worker/event` — output that arrives outside the request/response
 * cycle: terminal bytes, a shell exiting, a container changing state.
 *
 * These cannot be command *results* because nothing asked for them — a pty
 * produces output whenever the process feels like it. The bus fans them out to
 * whichever terminal stream is subscribed to that session id.
 *
 * `sandbox_status` events are additionally reconciled onto the row, so a
 * container that died on the user's own hardware stops showing as running in
 * the dashboard without anyone having to poll for it.
 */

export const dynamic = 'force-dynamic';

const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('terminal_output'),
    sessionId: z.string().min(1).max(64),
    stream: z.enum(['stdout', 'stderr']),
    data: z.string().max(256_000),
  }),
  z.object({
    type: z.literal('terminal_exit'),
    sessionId: z.string().min(1).max(64),
    exitCode: z.number().int().min(-256).max(256),
  }),
  z.object({
    type: z.literal('sandbox_status'),
    sandboxExternalId: z.string().min(1).max(128),
    status: z.enum([
      'creating',
      'starting',
      'running',
      'sleeping',
      'stopping',
      'stopped',
      'failed',
      'destroyed',
    ]),
  }),
]);

const body = z.object({ event: eventSchema });

export const POST = defineHandler(
  { auth: 'none', csrf: false, rateLimit: false, body },
  async ({ req, body: input }) => {
    const worker = await authenticateWorker(req);
    await markWorkerSeen(worker);

    emitEvent(worker.id, input.event);

    if (input.event.type === 'sandbox_status') {
      // Matched on the worker *and* the external id: a worker may only speak
      // for the specific machine it is running, never for the whole team's.
      await db
        .update(sandboxes)
        .set({ status: input.event.status, updatedAt: new Date() })
        .where(
          and(
            eq(sandboxes.workerId, worker.id),
            eq(sandboxes.externalId, input.event.sandboxExternalId),
          ),
        );
    }

    return json({ received: true });
  },
);
