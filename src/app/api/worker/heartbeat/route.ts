import { z } from 'zod';

import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_POLL_INTERVAL_MS,
  authenticateWorker,
  markWorkerSeen,
} from '@/app/api/worker/_auth';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { workerStats } from '@/lib/sandbox/worker-bus';

/**
 * `POST /api/worker/heartbeat` — "still here". Step 5 of the Karo Worker
 * Protocol v1.
 *
 * Sent every ~20 seconds so the dashboard can show a server as offline within
 * a minute of it going away, rather than only discovering it when a command
 * times out.
 *
 * It also **re-reports the machine**. Registration burns its one-time install
 * token, so it can never run a second time — which used to mean the hardware
 * and capabilities captured during enrolment were frozen for the life of the
 * worker. A machine that enrolled before Docker was installed went on claiming
 * it had no container runtime forever, and the only way to correct the record
 * was to revoke the server and enrol it again. Accepting the same facts here
 * makes the panel describe the machine as it is now.
 *
 * Reported host metrics are folded into the `capabilities` JSON under
 * `lastMetrics`. They are diagnostic, not billing input — compute on a user's
 * own hardware is metered from the sandbox session windows Karo controls, never
 * from numbers the remote machine self-reports. The same caution applies to the
 * host facts: they are descriptive, and nothing about scheduling or price is
 * decided from them.
 */

export const dynamic = 'force-dynamic';

const metrics = z.object({
  cpuPercent: z.number().min(0).max(100).optional(),
  memoryUsedMb: z.number().int().min(0).optional(),
  memoryTotalMb: z.number().int().min(0).optional(),
  diskUsedGb: z.number().min(0).optional(),
  diskTotalGb: z.number().min(0).optional(),
  runningSandboxes: z.number().int().min(0).optional(),
  loadAverage: z.array(z.number()).max(3).optional(),
  uptimeSeconds: z.number().int().min(0).optional(),
});

/** The same shape `POST /api/worker/register` accepts, minus the token. */
const host = z.object({
  hostname: z.string().trim().max(255).optional(),
  platform: z.string().trim().max(64).optional(),
  arch: z.string().trim().max(32).optional(),
  agentVersion: z.string().trim().max(32).optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  cpuCores: z.number().min(0).max(1_024).optional(),
  memoryMb: z.number().int().min(0).max(16_777_216).optional(),
  diskGb: z.number().int().min(0).max(1_048_576).optional(),
});

const body = z
  .object({
    metrics: metrics.optional(),
    host: host.optional(),
    /** Pre-1.1 agents sent this at the top level. */
    agentVersion: z.string().trim().max(32).optional(),
  })
  .default({});

export const POST = defineHandler(
  { auth: 'none', csrf: false, rateLimit: false, body },
  async ({ req, body: input }) => {
    const worker = await authenticateWorker(req);

    const reported = input.host ?? {};
    const agentVersion = reported.agentVersion ?? input.agentVersion;

    // `lastMetrics` is preserved across a capabilities refresh: the worker
    // reports the two separately, and dropping one because the other arrived
    // would make the panel flicker between them.
    const previous = (worker.capabilities as Record<string, unknown> | null) ?? {};
    const merged: Record<string, unknown> = {
      ...previous,
      ...(reported.capabilities ?? {}),
      ...(input.metrics
        ? { lastMetrics: { ...input.metrics, at: new Date().toISOString() } }
        : {}),
    };

    await markWorkerSeen(worker, {
      ...(agentVersion ? { agentVersion } : {}),
      ...(reported.hostname === undefined ? {} : { hostname: reported.hostname }),
      ...(reported.platform === undefined ? {} : { platform: reported.platform }),
      ...(reported.arch === undefined ? {} : { arch: reported.arch }),
      ...(reported.cpuCores === undefined ? {} : { cpuCores: reported.cpuCores }),
      ...(reported.memoryMb === undefined ? {} : { memoryMb: reported.memoryMb }),
      ...(reported.diskGb === undefined ? {} : { diskGb: reported.diskGb }),
      ...(reported.capabilities || input.metrics ? { capabilities: merged } : {}),
    });

    const stats = await workerStats(worker.id);

    return json({
      ok: true,
      workerId: worker.id,
      pollIntervalMs: WORKER_POLL_INTERVAL_MS,
      heartbeatIntervalMs: WORKER_HEARTBEAT_INTERVAL_MS,
      /** Work waiting for this worker, so it can poll again immediately. */
      queued: stats.queued,
      pending: stats.pending,
      serverTime: new Date().toISOString(),
    });
  },
);
