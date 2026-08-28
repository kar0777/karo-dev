import { authorizeCronOrAdmin } from '@/lib/api/cron-auth';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { sweepIdleSandboxes } from '@/lib/sandbox/service';

/**
 * Run the idle-sandbox sweep: put idle machines to sleep and destroy ones past
 * their retention window.
 *
 * `sweepIdleSandboxes` already implemented both behaviours, and both are sold as
 * per-plan entitlements and shown in the pricing table — but nothing ever called
 * it. Every sandbox therefore stayed awake until someone stopped it by hand, and
 * customers were billed for the whole idle window. This is the missing trigger.
 *
 * It is a route rather than an in-process timer so that it behaves the same in
 * one container and behind a load balancer: a serverless deployment cannot hold a
 * `setInterval`, and with several instances a timer would run the sweep N times
 * concurrently.
 *
 * Two ways in, because the two callers are different:
 *
 *  · **A platform admin's session** — the "Run sweep now" path from `/admin`.
 *  · **`Authorization: Bearer $CRON_SECRET`** — for the scheduler. Cron cannot
 *    hold a browser session, so requiring one would have made this endpoint
 *    unusable for the job it exists to do.
 *
 *     *\/5 * * * *  curl -fsS -X POST https://<host>/api/admin/sandboxes/sweep \
 *                      -H "Authorization: Bearer $CRON_SECRET"
 *
 * That line used to return 403: the blanket CSRF check ran first and a scheduler
 * satisfies none of its proofs. `authorizeCronOrAdmin` is where both callers are
 * now handled — see it for why the check cannot simply be switched off either.
 */
export const POST = defineHandler(
  {
    auth: 'optional',
    csrf: false, // re-applied to the session path inside authorizeCronOrAdmin
    rateLimit: 'api.default',
    audit: {
      action: AUDIT_ACTIONS.sandboxStop,
      resourceType: 'sandbox',
      severity: 'notice',
    },
  },
  async ({ req, setAudit }) => {
    await authorizeCronOrAdmin(req);

    const result = await sweepIdleSandboxes();

    setAudit({
      summary: `Idle sweep: ${result.slept.length} slept, ${result.destroyed.length} destroyed`,
      metadata: { slept: result.slept, destroyed: result.destroyed },
    });

    return json({
      slept: result.slept,
      destroyed: result.destroyed,
      sleptCount: result.slept.length,
      destroyedCount: result.destroyed.length,
    });
  },
);
