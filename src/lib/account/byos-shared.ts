/**
 * Bring-Your-Own-Server — the isomorphic half.
 *
 * Deliberately **not** marked `server-only`. The servers section in Settings is
 * a Client Component and needs the status vocabulary and its copy; the API
 * routes and the Settings page need the same vocabulary on the server. Keeping
 * both halves in one module made `servers-section.tsx` pull `server-only` into
 * the browser bundle and broke the build.
 *
 * The rule for this file: no `env`, no crypto, no database client, no Node
 * built-ins. Only the type of a row (erased at compile time), pure functions
 * and copy. Anything that touches a secret belongs in `./byos`.
 *
 * @see ./byos for token minting and the install command.
 */

import type { ByosWorker } from '@/lib/db/schema';

/** A worker heartbeats every 20s; three missed beats is offline, not a blip. */
export const HEARTBEAT_STALE_MS = 90 * 1000;

export type WorkerLiveStatus = 'pending' | 'online' | 'offline' | 'revoked' | 'expired';

/**
 * The stored column records intent; this records reality. A worker whose last
 * heartbeat is two minutes old is offline no matter what the row says.
 */
export function deriveWorkerStatus(worker: ByosWorker, now = Date.now()): WorkerLiveStatus {
  if (worker.status === 'revoked' || worker.revokedAt) return 'revoked';
  if (!worker.registeredAt) {
    return worker.installTokenExpiresAt.getTime() < now ? 'expired' : 'pending';
  }
  const beat = worker.lastHeartbeatAt?.getTime() ?? 0;
  return now - beat < HEARTBEAT_STALE_MS ? 'online' : 'offline';
}

/** Copy the UI shows under each server. Says what happened *and* what to do. */
export const WORKER_STATUS_COPY: Record<
  WorkerLiveStatus,
  {
    label: string;
    hint: string;
    dot: 'live' | 'idle' | 'sleeping' | 'error' | 'pending' | 'off';
  }
> = {
  pending: {
    label: 'Waiting for first connection',
    hint: 'Run the install command on the machine. It appears here within a few seconds of the agent starting.',
    dot: 'pending',
  },
  online: {
    label: 'Online',
    hint: 'Heartbeating normally. Projects targeting this server will run here.',
    dot: 'live',
  },
  offline: {
    label: 'Offline',
    hint: 'No heartbeat for over 90 seconds. Check that karo-worker is running and can reach the internet.',
    dot: 'off',
  },
  revoked: {
    label: 'Revoked',
    hint: 'Its token no longer works. Rotate the token to bring this machine back, or remove the entry.',
    dot: 'error',
  },
  expired: {
    label: 'Install token expired',
    hint: 'The one-time token was never used and has expired. Rotate it to generate a fresh install command.',
    dot: 'idle',
  },
};

/**
 * What the machine can actually run sandboxes with.
 *
 * `'none'` is the one that matters: a server in that state heartbeats happily
 * and shows as Online, but every sandbox scheduled onto it will fail, because
 * there is no container runtime to isolate it. The panel used not to show this
 * at all, so "Online" was the whole story a user got.
 */
export type WorkerRuntime = 'docker' | 'podman' | 'dry-run' | 'none' | 'unknown';

function readRuntime(capabilities: unknown): WorkerRuntime {
  if (!capabilities || typeof capabilities !== 'object') return 'unknown';
  const bag = capabilities as Record<string, unknown>;
  if (bag.dryRun === true) return 'dry-run';
  if (bag.docker === true) return 'docker';
  if (bag.podman === true) return 'podman';
  if (bag.docker === false || bag.podman === false) return 'none';
  return 'unknown';
}

/** Serialisable shape handed to Client Components. */
export type WorkerView = {
  id: string;
  name: string;
  status: WorkerLiveStatus;
  hostname: string | null;
  platform: string | null;
  arch: string | null;
  agentVersion: string | null;
  cpuCores: number | null;
  memoryMb: number | null;
  diskGb: number | null;
  runtime: WorkerRuntime;
  lastHeartbeatAt: string | null;
  registeredAt: string | null;
  installTokenExpiresAt: string;
  tokenRotatedAt: string | null;
  createdAt: string;
};

export function toWorkerView(worker: ByosWorker, now = Date.now()): WorkerView {
  return {
    id: worker.id,
    name: worker.name,
    status: deriveWorkerStatus(worker, now),
    hostname: worker.hostname,
    platform: worker.platform,
    arch: worker.arch,
    agentVersion: worker.agentVersion,
    cpuCores: worker.cpuCores,
    memoryMb: worker.memoryMb,
    diskGb: worker.diskGb,
    runtime: readRuntime(worker.capabilities),
    lastHeartbeatAt: worker.lastHeartbeatAt?.toISOString() ?? null,
    registeredAt: worker.registeredAt?.toISOString() ?? null,
    installTokenExpiresAt: worker.installTokenExpiresAt.toISOString(),
    tokenRotatedAt: worker.tokenRotatedAt?.toISOString() ?? null,
    createdAt: worker.createdAt.toISOString(),
  };
}
