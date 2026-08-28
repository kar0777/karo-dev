import 'server-only';

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
 * This bus is the server-side half: it parks pending commands, hands them to a
 * polling worker, and resolves the promise the sandbox provider is awaiting.
 *
 * Single-node by design. A multi-node control plane routes a worker's poll to
 * the node holding its pending work via a sticky hash on `workerId`; that
 * routing lives in the ingress layer, not here.
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

type PendingCommand = {
  command: WorkerCommand;
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  queuedAt: number;
};

type WorkerState = {
  queue: WorkerCommand[];
  pending: Map<string, PendingCommand>;
  /** Resolves the current long-poll as soon as work arrives. */
  poller: ((commands: WorkerCommand[]) => void) | null;
  events: Map<string, Array<(event: WorkerEvent) => void>>;
  lastSeenAt: number;
};

const workers = new Map<string, WorkerState>();

function state(workerId: string): WorkerState {
  let entry = workers.get(workerId);
  if (!entry) {
    entry = { queue: [], pending: new Map(), poller: null, events: new Map(), lastSeenAt: 0 };
    workers.set(workerId, entry);
  }
  return entry;
}

export const WORKER_POLL_HOLD_MS = 25_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 180_000;

/**
 * Queues a command for a worker and waits for its result.
 * Rejects with a clear message when the worker never picks it up.
 */
export function dispatch(
  workerId: string,
  command: WorkerCommandInput,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<WorkerResult> {
  const entry = state(workerId);
  const full = { ...command, id: command.id ?? newId(ID_PREFIX.task) } as WorkerCommand;

  return new Promise<WorkerResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(full.id);
      entry.queue = entry.queue.filter((c) => c.id !== full.id);
      reject(
        new Error(
          'Your server did not respond in time. Check that the karo-worker service is running and can reach the internet.',
        ),
      );
    }, timeoutMs);

    entry.pending.set(full.id, { command: full, resolve, reject, timer, queuedAt: Date.now() });
    entry.queue.push(full);

    // Wake a parked long-poll immediately.
    if (entry.poller) {
      const poller = entry.poller;
      entry.poller = null;
      const batch = entry.queue.splice(0, entry.queue.length);
      poller(batch);
    }
  });
}

/** Fire-and-forget — used for terminal keystrokes, where a result is pointless. */
export function dispatchNoWait(workerId: string, command: WorkerCommandInput): void {
  const entry = state(workerId);
  const full = { ...command, id: command.id ?? newId(ID_PREFIX.task) } as WorkerCommand;
  entry.queue.push(full);
  if (entry.poller) {
    const poller = entry.poller;
    entry.poller = null;
    poller(entry.queue.splice(0, entry.queue.length));
  }
}

/**
 * The long-poll. Returns immediately when work is queued, otherwise parks for
 * up to `WORKER_POLL_HOLD_MS` and returns an empty batch so the worker can
 * re-poll with a fresh token check.
 */
export function poll(workerId: string, signal?: AbortSignal): Promise<WorkerCommand[]> {
  const entry = state(workerId);
  entry.lastSeenAt = Date.now();

  if (entry.queue.length) {
    return Promise.resolve(entry.queue.splice(0, entry.queue.length));
  }

  return new Promise<WorkerCommand[]>((resolve) => {
    const finish = (commands: WorkerCommand[]) => {
      clearTimeout(timer);
      if (entry.poller === resolveRef) entry.poller = null;
      resolve(commands);
    };
    const resolveRef = finish;
    entry.poller = resolveRef;

    const timer = setTimeout(() => finish([]), WORKER_POLL_HOLD_MS);
    signal?.addEventListener('abort', () => finish([]), { once: true });
  });
}

export function complete(workerId: string, result: WorkerResult): boolean {
  const entry = state(workerId);
  entry.lastSeenAt = Date.now();

  const pending = entry.pending.get(result.commandId);
  if (!pending) {
    // Late result after a timeout — safe to drop, but worth knowing about.
    log.debug('Received a result for an unknown command', { commandId: result.commandId });
    return false;
  }
  clearTimeout(pending.timer);
  entry.pending.delete(result.commandId);
  pending.resolve(result);
  return true;
}

export function emitEvent(workerId: string, event: WorkerEvent): void {
  const entry = state(workerId);
  entry.lastSeenAt = Date.now();

  const key = 'sessionId' in event ? event.sessionId : event.sandboxExternalId;
  for (const listener of entry.events.get(key) ?? []) {
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

export function workerIsConnected(workerId: string, maxAgeMs = 60_000): boolean {
  const entry = workers.get(workerId);
  return Boolean(entry && Date.now() - entry.lastSeenAt < maxAgeMs);
}

export function markSeen(workerId: string): void {
  state(workerId).lastSeenAt = Date.now();
}

/** Fails every outstanding command — used when a worker is revoked. */
export function drainWorker(workerId: string, reason: string): void {
  const entry = workers.get(workerId);
  if (!entry) return;
  for (const pending of entry.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }
  entry.pending.clear();
  entry.queue = [];
  entry.poller?.([]);
  entry.poller = null;
  workers.delete(workerId);
}

export function workerStats(workerId: string) {
  const entry = workers.get(workerId);
  return {
    connected: workerIsConnected(workerId),
    queued: entry?.queue.length ?? 0,
    pending: entry?.pending.size ?? 0,
    lastSeenAt: entry?.lastSeenAt ? new Date(entry.lastSeenAt) : null,
  };
}
