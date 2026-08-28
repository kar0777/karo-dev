import { routeParam } from '@/app/api/_shared/route-helpers';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { billedComputeHours, usableMemoryMb } from '@/lib/pricing/compute';
import { refreshMetrics } from '@/lib/sandbox/service';

/**
 * `GET /api/sandboxes/[sandboxId]/metrics` — live telemetry for the right rail.
 *
 * Polled, not streamed. A metrics socket per open workspace tab would cost more
 * than the numbers are worth, and the panel refreshes on a few-second cadence
 * anyway. Each call also writes the values back onto the row, so pages that
 * render a sandbox card get recent numbers without talking to the provider.
 *
 * A stopped sandbox is not an error — it returns `live: false` with the last
 * known values, which is what lets the UI show a dimmed card instead of a
 * failure state.
 */

export const dynamic = 'force-dynamic';

export const GET = defineHandler({ auth: 'required' }, async ({ params }) => {
  const sandboxId = routeParam(params, 'sandboxId');
  const access = await requireSandboxAccess(sandboxId, 'sandbox.read');
  const row = access.sandbox;

  const live = await refreshMetrics(row.id);

  const metrics = live ?? {
    cpuPercent: row.status === 'running' ? row.cpuPercent : 0,
    memoryUsedMb: row.status === 'running' ? row.memoryUsedMb : 0,
    memoryLimitMb: row.memoryMb,
    diskUsedMb: row.diskUsedMb,
    diskLimitMb: row.diskGb * 1024,
    processCount: row.status === 'running' ? row.processCount : 0,
    uptimeSeconds:
      row.startedAt && row.status === 'running'
        ? Math.max(0, Math.round((Date.now() - row.startedAt.getTime()) / 1000))
        : 0,
  };

  return json({
    sandboxId: row.id,
    status: row.status,
    live: live !== null,
    metrics: {
      ...metrics,
      memoryLimitMb: metrics.memoryLimitMb || row.memoryMb,
      diskLimitMb: metrics.diskLimitMb || row.diskGb * 1024,
    },
    shape: {
      cpuCores: row.cpuCores,
      memoryMb: row.memoryMb,
      /** RAM left for the user's processes after the base image overhead. */
      usableMemoryMb: usableMemoryMb(row.memoryMb),
      diskGb: row.diskGb,
      computeMultiplier: row.computeMultiplier,
    },
    billing: {
      totalActiveSeconds: row.totalActiveSeconds,
      billedComputeHours: billedComputeHours(row.totalActiveSeconds, row.computeMultiplier),
    },
    message:
      row.status === 'sleeping'
        ? 'Sandbox is asleep — it will wake on your next command (~4s).'
        : row.status === 'stopped'
          ? 'Sandbox is stopped. Start it to run commands again.'
          : row.status === 'failed'
            ? (row.statusMessage ?? 'The sandbox failed to start. Try restarting it.')
            : null,
  });
});
