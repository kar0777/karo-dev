import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { WORKER_HEARTBEAT_INTERVAL_MS, WORKER_POLL_INTERVAL_MS } from '@/app/api/worker/_auth';
import { UnauthorizedError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { byosWorkers } from '@/lib/db/schema';
import { newToken } from '@/lib/ids';
import { markSeen } from '@/lib/sandbox/worker-bus';
import { WORKER_POLL_HOLD_MS } from '@/lib/sandbox/worker-bus';

/**
 * `POST /api/worker/register` — exchange a one-time install token for a
 * long-lived worker token. Step 2 of the Karo Worker Protocol v1.
 *
 * The install token is **burned atomically**. Consumption is expressed as a
 * single conditional UPDATE — match the token hash, and only where no worker
 * token has been issued yet and the token has not expired — so two workers
 * racing the same install command cannot both come away registered. A
 * `RETURNING` row means this caller won; no row means the token was already
 * spent, expired or fabricated, and all three answer with the same 401.
 *
 * Neither token is ever stored: only their SHA-256 digests are, so a dump of
 * `byos_workers` cannot be replayed against anybody's server.
 */

export const dynamic = 'force-dynamic';

const body = z.object({
  installToken: z.string().min(16).max(512),
  hostname: z.string().trim().max(255).optional(),
  platform: z.string().trim().max(64).optional(),
  arch: z.string().trim().max(32).optional(),
  agentVersion: z.string().trim().max(32).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  cpuCores: z.number().min(0).max(1_024).optional(),
  memoryMb: z.number().int().min(0).max(16_777_216).optional(),
  diskGb: z.number().int().min(0).max(1_048_576).optional(),
});

export const POST = defineHandler(
  { auth: 'none', csrf: false, rateLimit: 'api.default', body },
  async ({ body: input, req, ip }) => {
    const workerToken = newToken(32);
    const now = new Date();

    const claimed = await db
      .update(byosWorkers)
      .set({
        workerTokenHash: sha256(workerToken),
        tokenRotatedAt: now,
        status: 'online',
        registeredAt: now,
        lastHeartbeatAt: now,
        hostname: input.hostname ?? null,
        platform: input.platform ?? null,
        arch: input.arch ?? null,
        agentVersion: input.agentVersion ?? null,
        capabilities: input.capabilities ?? null,
        cpuCores: input.cpuCores ?? null,
        memoryMb: input.memoryMb ?? null,
        diskGb: input.diskGb ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(byosWorkers.installTokenHash, sha256(input.installToken)),
          // The one-time guarantee: a row that already has a worker token has
          // already been claimed, and no second registration may take it.
          isNull(byosWorkers.workerTokenHash),
          isNull(byosWorkers.revokedAt),
          gt(byosWorkers.installTokenExpiresAt, sql`now()`),
        ),
      )
      .returning();

    const worker = claimed[0];
    if (!worker) {
      // One message for expired, spent and invalid alike — distinguishing them
      // would tell an attacker which guesses were close.
      throw new UnauthorizedError(
        'This installation token is invalid, expired, or has already been used. Generate a new one from Settings → Servers.',
      );
    }

    markSeen(worker.id);

    await recordAudit({
      action: AUDIT_ACTIONS.workerRegister,
      teamId: worker.teamId,
      userId: worker.createdById,
      actorType: 'worker',
      resourceType: 'worker',
      resourceId: worker.id,
      severity: 'notice',
      summary: `Server ${input.hostname ?? worker.name} registered`,
      metadata: {
        hostname: input.hostname,
        platform: input.platform,
        arch: input.arch,
        agentVersion: input.agentVersion,
        cpuCores: input.cpuCores,
        memoryMb: input.memoryMb,
      },
      request: req,
      ipAddress: ip,
    });

    return json({
      workerToken,
      workerId: worker.id,
      name: worker.name,
      pollIntervalMs: WORKER_POLL_INTERVAL_MS,
      heartbeatIntervalMs: WORKER_HEARTBEAT_INTERVAL_MS,
      /** How long `/poll` parks before returning an empty batch. */
      pollHoldMs: WORKER_POLL_HOLD_MS,
      protocolVersion: 1,
    });
  },
);
