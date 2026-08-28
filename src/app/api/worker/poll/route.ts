import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_POLL_INTERVAL_MS,
  authenticateWorker,
  markWorkerSeen,
} from '@/app/api/worker/_auth';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { WORKER_POLL_HOLD_MS, poll } from '@/lib/sandbox/worker-bus';

/**
 * `GET /api/worker/poll` — the long-poll. Step 3 of the Karo Worker Protocol v1.
 *
 * Long-polling rather than WebSockets is the whole reason BYOS works behind
 * CGNAT and corporate proxies: the connection is outbound, plain HTTPS, and
 * needs no upgrade handshake that a middlebox can break.
 *
 * The hold is capped below 30 seconds. Load balancers, reverse proxies and
 * platform gateways routinely cut idle responses at 30s or 60s, and a
 * connection killed mid-hold looks to the worker like an error rather than an
 * empty batch. The bus parks for 25s; a belt-and-braces abort at 29s guarantees
 * the ceiling even if that constant is ever raised.
 *
 * Aborting is safe with respect to queued work: the bus only resolves an empty
 * batch when the queue was empty at park time, and a command that arrives
 * during the hold wakes the poll immediately instead.
 */

export const dynamic = 'force-dynamic';

const MAX_HOLD_MS = 29_000;

export const GET = defineHandler(
  { auth: 'none', csrf: false, rateLimit: false },
  async ({ req }) => {
    const worker = await authenticateWorker(req);
    await markWorkerSeen(worker);

    const controller = new AbortController();
    const onClientAbort = () => controller.abort();
    req.signal.addEventListener('abort', onClientAbort, { once: true });

    const timer = setTimeout(
      () => controller.abort(),
      Math.min(MAX_HOLD_MS, WORKER_POLL_HOLD_MS + 2_000),
    );

    try {
      const commands = await poll(worker.id, controller.signal);
      return json({
        commands,
        pollIntervalMs: WORKER_POLL_INTERVAL_MS,
        heartbeatIntervalMs: WORKER_HEARTBEAT_INTERVAL_MS,
        serverTime: new Date().toISOString(),
      });
    } finally {
      clearTimeout(timer);
      req.signal.removeEventListener('abort', onClientAbort);
    }
  },
);
