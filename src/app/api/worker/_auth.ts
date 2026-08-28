import 'server-only';

import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { UnauthorizedError } from '@/lib/api/errors';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { byosWorkers, type ByosWorker } from '@/lib/db/schema';

/**
 * Karo Worker Protocol v1 — authentication.
 *
 * Workers are *machines*, not people: there is no session cookie, no browser
 * and no CSRF surface. They present the long-lived token they were issued at
 * registration in an `Authorization: Bearer` header, and it is compared against
 * the SHA-256 stored on the `byos_workers` row — Karo never holds the token
 * itself, so a database leak cannot be replayed against a user's server.
 *
 * Routes using this must set `auth: 'none'` and `csrf: false` on their handler
 * config and call `authenticateWorker` themselves. Leaving `auth: 'required'`
 * on would demand a session the worker cannot have.
 */

/** How often a worker should poll after a poll returns empty. */
export const WORKER_POLL_INTERVAL_MS = 1_000;
/** Heartbeat cadence the worker is told to use; matches the protocol doc. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 20_000;

export async function authenticateWorker(request: NextRequest): Promise<ByosWorker> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];

  if (!token) throw unauthorized('No worker token was presented.');

  const rows = await db
    .select()
    .from(byosWorkers)
    .where(eq(byosWorkers.workerTokenHash, sha256(token)))
    .limit(1);

  const worker = rows[0];
  if (!worker) throw unauthorized('This worker token is not recognised.');
  if (worker.revokedAt || worker.status === 'revoked') {
    throw unauthorized('This server was revoked from the Karo dashboard.');
  }

  return worker;
}

/**
 * Every authenticated worker call is itself a sign of life, so heartbeat state
 * is refreshed here rather than only on `/heartbeat`. A worker that is polling
 * happily but whose heartbeat request was dropped should not show as offline.
 */
export async function markWorkerSeen(
  worker: ByosWorker,
  patch: Partial<typeof byosWorkers.$inferInsert> = {},
): Promise<void> {
  const now = new Date();

  await db
    .update(byosWorkers)
    .set({
      lastHeartbeatAt: now,
      status: 'online',
      updatedAt: now,
      ...patch,
    })
    .where(eq(byosWorkers.id, worker.id));
}

function unauthorized(message: string): UnauthorizedError {
  return new UnauthorizedError(message);
}
