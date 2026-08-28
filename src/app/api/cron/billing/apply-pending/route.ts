import { authorizeCronOrAdmin } from '@/lib/api/cron-auth';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { applyDuePlanChanges } from '@/lib/billing/plan-changes';

/**
 * Apply the plan changes that were parked until the end of a billing period.
 *
 * A downgrade is deliberately not sent to the provider when the team asks for
 * it — the pricing page and the Terms promise the allowance stays until the
 * period they paid for is over. That promise is only kept if something carries
 * the change out afterwards; this is that something.
 *
 * It is a route rather than an in-process timer for the same reason the sandbox
 * sweep is: a serverless deployment cannot hold a `setInterval`, and several
 * instances would each run their own copy.
 *
 * Two ways in, because the two callers are different:
 *
 *  · **A platform admin's session** — for running the sweep by hand.
 *  · **`Authorization: Bearer $CRON_SECRET`** — for the scheduler, which cannot
 *    hold a browser session. The header is compared in constant time, and when
 *    `CRON_SECRET` is unset this route is admin-session-only.
 *
 *     17 * * * *  curl -fsS -X POST https://<host>/api/cron/billing/apply-pending \
 *                     -H "Authorization: Bearer $CRON_SECRET"
 *
 * The blanket CSRF check is off because a scheduler satisfies none of its proofs,
 * but it is re-applied to the browser path inside `authorizeCronOrAdmin` — the
 * double-submit layer exists for exactly what `SameSite=Lax` does not cover, so
 * an admin-only state-changing route must not quietly opt out of it.
 */
export const POST = defineHandler(
  {
    auth: 'optional',
    csrf: false,
    rateLimit: 'api.default',
    audit: {
      action: AUDIT_ACTIONS.billingPlanChange,
      resourceType: 'subscription',
      severity: 'notice',
    },
  },
  async ({ req, setAudit }) => {
    await authorizeCronOrAdmin(req);

    const result = await applyDuePlanChanges();

    setAudit({
      summary: `Scheduled plan changes: ${result.applied.length} applied, ${result.dropped.length} dropped, ${result.failed.length} failed`,
      metadata: {
        applied: result.applied,
        dropped: result.dropped,
        failed: result.failed,
      },
    });

    return json({
      applied: result.applied,
      dropped: result.dropped,
      failed: result.failed,
      appliedCount: result.applied.length,
      droppedCount: result.dropped.length,
      failedCount: result.failed.length,
    });
  },
);
