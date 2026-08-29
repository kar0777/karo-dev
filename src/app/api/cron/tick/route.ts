import { authorizeCronOrAdmin } from '@/lib/api/cron-auth';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { syncProviderCatalogs } from '@/lib/ai/catalog-sync';
import { sweepAutoTopups } from '@/lib/billing/auto-topup';
import { applyDuePlanChanges } from '@/lib/billing/plan-changes';
import { sweepIdleSandboxes } from '@/lib/sandbox/service';
import { sweepStaleWorkerCommands } from '@/lib/sandbox/worker-bus';

/**
 * Run every periodic maintenance sweep in one call.
 *
 * The three sweeps already had their own endpoints, each with its own cron
 * line — so a scheduler needs a plan entry per endpoint. Free hosting tiers
 * typically cap how many cron entries a project may define (Vercel's Hobby
 * plan allows fewer than the three this platform needs), and the scheduler
 * path would simply not fit. One tick endpoint collapses the three entries
 * into one, without changing anything for the individual endpoints, which
 * keep working for a platform admin running a single sweep by hand.
 *
 * The sweeps run sequentially rather than concurrently on purpose: they all
 * touch the same database and the same billing tables, and a scheduler tick
 * has no latency budget worth parallelising against. Each one is isolated, so
 * a failure in, say, the sandbox sweep cannot stop the billing sweeps from
 * running — a maintenance tick must degrade, never abort.
 *
 * Two ways in, same as the individual endpoints:
 *
 *  · **A platform admin's session** — for running everything by hand.
 *  · **`Authorization: Bearer $CRON_SECRET`** — for the scheduler. When
 *    `CRON_SECRET` is unset the route is admin-session-only.
 *
 *     0 3 * * *  curl -fsS https://<host>/api/cron/tick \
 *                    -H "Authorization: Bearer $CRON_SECRET"
 *
 * The response is 200 while at least one sweep ran, and 500 only when every
 * sweep failed — that is the one outcome a scheduler should page somebody
 * for. Partial failures are reported in the body, and the tick as a whole
 * lands in the audit log through the `cron.tick` action.
 */
export const GET = defineHandler(
  {
    auth: 'optional',
    csrf: false, // re-applied to the session path inside authorizeCronOrAdmin
    rateLimit: 'api.default',
    audit: {
      action: AUDIT_ACTIONS.cronTick,
      resourceType: 'platform',
      severity: 'notice',
    },
  },
  async ({ req, setAudit }) => {
    const caller = await authorizeCronOrAdmin(req);

    const jobs: { name: string; ok: boolean; summary: string; error?: string }[] = [];
    const run = async (name: string, sweep: () => Promise<string>) => {
      try {
        jobs.push({ name, ok: true, summary: await sweep() });
      } catch (error) {
        jobs.push({
          name,
          ok: false,
          summary: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    await run('sandbox-sweep', async () => {
      const result = await sweepIdleSandboxes();
      return `${result.slept.length} slept, ${result.destroyed.length} destroyed`;
    });

    await run('billing-auto-topup', async () => {
      const result = await sweepAutoTopups();
      return `${result.charged.length} charged, ${result.failed.length} failed of ${result.considered}`;
    });

    await run('billing-apply-pending', async () => {
      const result = await applyDuePlanChanges();
      return `${result.applied.length} applied, ${result.dropped.length} dropped, ${result.failed.length} failed`;
    });

    // Model-catalogue discovery. A provider whose API key was added since the
    // last tick gets its models imported here without anyone pressing Sync —
    // unconfigured providers are skipped, not error-logged.
    await run('catalog-sync', async () => {
      const result = await syncProviderCatalogs({ onlyConfigured: true });
      return `${result.changes.length} changes, ${result.errors.length} errors across ${result.syncedProviders} providers`;
    });

    // Commands a worker claimed but never finished (the machine went to sleep
    // mid-exec, Wi-Fi dropped). Left alone they stay `claimed` forever.
    await run('worker-command-reaper', async () => {
      const result = await sweepStaleWorkerCommands();
      return `${result.reaped} reaped`;
    });

    const failedCount = jobs.filter((job) => !job.ok).length;

    setAudit({
      summary: `Maintenance tick (${caller}): ${jobs.map((job) => `${job.name} — ${job.summary}`).join('; ')}`,
      metadata: { caller, jobs },
    });

    return json(
      { ok: failedCount === 0, caller, jobs },
      failedCount === jobs.length ? { status: 500 } : undefined,
    );
  },
);

/** Vercel cron issues GET requests; the scheduler script POSTs. Both work. */
export const POST = GET;
