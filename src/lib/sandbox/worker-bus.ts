import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { byosCommands, byosWorkers } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';

const log = createLogger('sandbox:worker-bus');

/**
 * Karo Worker Protocol v1 — the transport for "Bring Your Own Server".
 *
 * ## Why long-poll and not WebSocket
 *
 * The whole point of BYOS is that the user's machine — a VPS, a NAS, a desktop
 * behind CGNAT — never needs an inbound port, a public IP, or an SSH password
 * typed into a browser. So the connection is **outbound only**, and it is plain
 * HTTPS so it survives corporate proxies that break WebSocket upgrades:
 *
 *   1. Operator runs the install command with a **one-time installation token**.
 *   2. Worker `POST /api/worker/register` → exchanges it for a long-lived worker
 *      token (the install token is burned immediately) and reports capabilities.
 *   3. Worker long-polls `GET /api/worker/poll` (25s hold) for queued commands.
 *   4. Worker executes locally in rootless Docker and `POST /api/worker/result`.
 *   5. Worker `POST /api/worker/heartbeat` every 20s.
 *   6. Either side can revoke; token rotation is a single call.
 *
 * At no point does Karo hold credentials for the user's machine, and at no
 * point does the browser see anything but a status badge.
 *
 * ## Why the queue is the database and not process memory
 *
 * This used to be an in-memory map, and the comment here said "single-node by
 * design". That assumption is false on the hosting this platform actually ships
 * on: on serverless, the instance that dispatches a `create` command is almost
 * never the instance holding the worker's parked long-poll, so the command sat
 * in the wrong process's memory until its timeout, and `workerIsConnected` —
 * also per-process — reported every worker offline in any fresh instance. The
 * queue therefore lives in `byos_commands`: dispatch inserts a row, the
 * long-poll claims rows with `FOR UPDATE SKIP LOCKED` (any instance can serve
 * any worker, two workers of the same team can never steal each other's
 * command), and `result` completes the row that `dispatch` is polling.
 *
 * Liveness is likewise read from `byos_workers.last_heartbeat_at` rather than
 * from process-local bookkeeping.
 *
 * The one thing that stays in-process is the **terminal event** stream
 * (`emitEvent`/`subscribe`): keystroke latency cannot afford a database round
 * trip, and a terminal session's open/input/output all tend to land on the
 * instance serving the WebSocket-ish stream anyway. On serverless a terminal is
 * therefore best-effort; command execution — the path that creates sandboxes
 * and runs builds — is fully durable.
 */

export type WorkerCommand =
  | {
      id: string;
      kind: 'exec';
      sandboxExternalId: string;
      command: string;
      shell: string;
      cwd: string;
      env: Record<string, string>;
      timeoutSeconds: number;
    }
  | {
      id: string;
      kind: 'create';
      sandboxExternalId: string;
      image: string;
      cpuCores: number;
      memoryMb: number;
      diskGb: number;
      maxProcesses: number;
      networkPolicy: string;
      env: Record<string, string>;
    }
  | {
      id: string;
      kind: 'start' | 'stop' | 'destroy' | 'status' | 'metrics';
      sandboxExternalId: string;
    }
  | {
      id: string;
      kind: 'write_files';
      sandboxExternalId: string;
      files: Array<{ path: string; contentBase64: string; mode?: number }>;
    }
  | { id: string; kind: 'read_file'; sandboxExternalId: string; path: string }
  | { id: string; kind: 'list_files'; sandboxExternalId: string; path: string }
  | { id: string; kind: 'delete_file'; sandboxExternalId: string; path: string }
  | {
      id: string;
      kind: 'terminal_open';
      sandboxExternalId: string;
      sessionId: string;
      shell: string;
      cols: number;
      rows: number;
    }
  | { id: string; kind: 'terminal_input'; sessionId: string; data: string }
  | { id: string; kind: 'terminal_resize'; sessionId: string; cols: number; rows: number }
  | { id: string; kind: 'terminal_close'; sessionId: string };

/**
 * `Omit` collapses a discriminated union into a single object type, which
 * destroys the `kind` narrowing. Distributing over the union preserves it.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A command as callers supply it — `id` is assigned by the bus. */
export type WorkerCommandInput = DistributiveOmit<WorkerCommand, 'id'> & { id?: string };

export type WorkerResult = {
  commandId: string;
  ok: boolean;
  /** Shape depends on the command kind; validated by the caller. */
  data?: unknown;
  error?: string;
};

/** Output pushed by the worker outside the request/response cycle. */
export type WorkerEvent =
  | { type: 'terminal_output'; sessionId: string; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'terminal_exit'; sessionId: string; exitCode: number }
  | { type: 'sandbox_status'; sandboxExternalId: string; status: string };

export const WORKER_POLL_HOLD_MS = 25_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 180_000;
/** How often `dispatch` checks for its result and the long-poll re-claims. */
const QUEUE_CHECK_INTERVAL_MS = 1_000;

/**
 * Queues a command for a worker and waits for its result.
 *
 * The insert is the whole hand-off: whichever instance ends up serving the
 * worker's next long-poll claims the row from the database. This function then
 * polls the same row until the worker's result lands, so it does not matter
 * which process runs which half.
 */
export async function dispatch(
  workerId: string,
  command: WorkerCommandInput,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<WorkerResult> {
  const id = command.id ?? newId(ID_PREFIX.task);
  const full = { ...command, id } as WorkerCommand;
  const deadline = Date.now() + timeoutMs;

  await db.insert(byosCommands).values({
    id,
    workerId,
    kind: full.kind,
    payload: full as unknown as Record<string, unknown>,
    timeoutAt: new Date(deadline),
  });

  while (Date.now() < deadline) {
    await sleep(Math.min(QUEUE_CHECK_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));

    const rows = await db
      .select({ status: byosCommands.status, result: byosCommands.result, error: byosCommands.error })
      .from(byosCommands)
      .where(eq(byosCommands.id, id))
      .limit(1);
    const row = rows[0];

    if (!row) break; // Revoked and cascaded away — the caller cannot wait out.

    if (row.status === 'completed' || row.status === 'failed') {
      const result = (row.result ?? {}) as Partial<WorkerResult>;
      return {
        commandId: id,
        ok: row.status === 'completed',
        data: result.data,
        error: result.error ?? (row.status === 'failed' ? row.error ?? 'Command failed.' : undefined),
      };
    }
  }

  // Give up and stop the row from being claimed by a worker that arrives late.
  await db
    .update(byosCommands)
    .set({ status: 'expired', error: 'The caller stopped waiting.', completedAt: new Date() })
    .where(and(eq(byosCommands.id, id), inArray(byosCommands.status, ['queued', 'claimed'])));

  throw new Error(
    'Your server did not respond in time. Check that the karo-worker service is running and can reach the internet.',
  );
}

/** Fire-and-forget — used for terminal keystrokes, where a result is pointless. */
export function dispatchNoWait(workerId: string, command: WorkerCommandInput): void {
  const id = command.id ?? newId(ID_PREFIX.task);
  const full = { ...command, id } as WorkerCommand;
  void db
    .insert(byosCommands)
    .values({
      id,
      workerId,
      kind: full.kind,
      payload: full as unknown as Record<string, unknown>,
      timeoutAt: new Date(Date.now() + 60_000),
    })
    .catch((error: unknown) => {
      log.warn('Could not queue a worker command', { workerId, kind: full.kind, error: String(error) });
    });
}

/**
 * The long-poll. Claims queued commands from the database; parks for up to
 * `WORKER_POLL_HOLD_MS` when there is nothing to claim, checking every second
 * so a command queued by a *different* instance is picked up within that
 * interval rather than at the end of the hold.
 */
export async function poll(workerId: string, signal?: AbortSignal): Promise<WorkerCommand[]> {
  const deadline = Date.now() + WORKER_POLL_HOLD_MS;

  for (;;) {
    // postgres.js (drizzle's driver here) resolves `execute` to the row array
    // itself; other drivers wrap it in `{ rows }`. Normalise both.
    const raw = (await db.execute(sql`
      UPDATE byos_commands
      SET status = 'claimed', claimed_at = now()
      WHERE id IN (
        SELECT id FROM byos_commands
        WHERE worker_id = ${workerId}
          AND status = 'queued'
          AND timeout_at > now()
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING payload
    `)) as unknown as Array<{ payload: unknown }> | { rows?: Array<{ payload: unknown }> };

    const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);
    const commands = rows
      .map((row) => row.payload as WorkerCommand)
      .filter((command) => typeof command?.kind === 'string');
    if (commands.length) return commands;

    if (signal?.aborted || Date.now() >= deadline) return [];
    await sleep(QUEUE_CHECK_INTERVAL_MS);
  }
}

/** Marks a claimed command finished; `dispatch`'s poll picks it up within 1s. */
export async function complete(workerId: string, result: WorkerResult): Promise<boolean> {
  const updated = await db
    .update(byosCommands)
    .set({
      status: result.ok ? 'completed' : 'failed',
      result: { ok: result.ok, data: result.data, error: result.error },
      error: result.error ?? null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(byosCommands.id, result.commandId),
        eq(byosCommands.workerId, workerId),
        inArray(byosCommands.status, ['queued', 'claimed']),
      ),
    )
    .returning({ id: byosCommands.id });

  if (!updated.length) {
    // Late result after a timeout — safe to drop, but worth knowing about.
    log.debug('Received a result for an unknown command', { commandId: result.commandId });
  }
  return updated.length > 0;
}

/* ------------------------------------------------------------------ *
 *  Terminal events — in-process, best-effort (see the module comment)
 * ------------------------------------------------------------------ */

type WorkerState = {
  events: Map<string, Array<(event: WorkerEvent) => void>>;
};

const workers = new Map<string, WorkerState>();

function state(workerId: string): WorkerState {
  let entry = workers.get(workerId);
  if (!entry) {
    entry = { events: new Map() };
    workers.set(workerId, entry);
  }
  return entry;
}

export function emitEvent(workerId: string, event: WorkerEvent): void {
  const key = 'sessionId' in event ? event.sessionId : event.sandboxExternalId;
  for (const listener of state(workerId).events.get(key) ?? []) {
    try {
      listener(event);
    } catch (error) {
      log.warn('Worker event listener threw', { error: String(error) });
    }
  }
}

export function subscribe(
  workerId: string,
  key: string,
  listener: (event: WorkerEvent) => void,
): () => void {
  const entry = state(workerId);
  const listeners = entry.events.get(key) ?? [];
  listeners.push(listener);
  entry.events.set(key, listeners);

  return () => {
    const current = entry.events.get(key) ?? [];
    const next = current.filter((l) => l !== listener);
    if (next.length) entry.events.set(key, next);
    else entry.events.delete(key);
  };
}

/* ------------------------------------------------------------------ *
 *  Liveness — read from the heartbeat the database already records
 * ------------------------------------------------------------------ */

/**
 * True when the worker's last authenticated call (poll or heartbeat, both of
 * which stamp `last_heartbeat_at`) is recent. Reading the database instead of
 * process memory is what makes this meaningful on serverless, where the
 * instance asking is usually not the instance the worker talked to last.
 */
export async function isWorkerOnline(workerId: string, maxAgeMs = 60_000): Promise<boolean> {
  const rows = await db
    .select({ lastHeartbeatAt: byosWorkers.lastHeartbeatAt })
    .from(byosWorkers)
    .where(eq(byosWorkers.id, workerId))
    .limit(1);

  const last = rows[0]?.lastHeartbeatAt;
  return Boolean(last && Date.now() - last.getTime() < maxAgeMs);
}

export async function workerStats(workerId: string) {
  const [worker] = await db
    .select({ lastHeartbeatAt: byosWorkers.lastHeartbeatAt })
    .from(byosWorkers)
    .where(eq(byosWorkers.id, workerId))
    .limit(1);

  const queued = await db
    .select({ status: byosCommands.status, count: sql<number>`count(*)::int` })
    .from(byosCommands)
    .where(and(eq(byosCommands.workerId, workerId), inArray(byosCommands.status, ['queued', 'claimed'])))
    .groupBy(byosCommands.status);

  const sum = queued.reduce((total, row) => total + Number(row.count), 0);
  const last = worker?.lastHeartbeatAt ?? null;

  return {
    connected: Boolean(last && Date.now() - last.getTime() < 60_000),
    queued: queued.find((row) => row.status === 'queued')?.count ?? 0,
    pending: queued.find((row) => row.status === 'claimed')?.count ?? 0,
    lastSeenAt: last,
    inFlight: sum,
  };
}

/** Fails every outstanding command — used when a worker is revoked. */
export async function drainWorker(workerId: string, reason: string): Promise<void> {
  await db
    .update(byosCommands)
    .set({ status: 'failed', error: reason, completedAt: new Date() })
    .where(and(eq(byosCommands.workerId, workerId), inArray(byosCommands.status, ['queued', 'claimed'])));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
