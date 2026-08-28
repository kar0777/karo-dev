import { authorizeCronOrAdmin } from '@/lib/api/cron-auth';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { sweepAutoTopups } from '@/lib/billing/auto-topup';

/**
 * Refill the balance of every team that asked for automatic top-up.
 *
 * Metering triggers a top-up the moment a charge lands, which covers the team
 * that is actively working. This sweep covers the opposite case, and it is the
 * one that matters: a team whose balance ran out has *stopped* running agents,
 * so nothing meters and nothing would ever refill them. Without a scheduler
 * calling this, auto top-up only helps the people who did not need it.
 *
 * Two ways in, because the two callers are different:
 *
 *  · **A platform admin's session** — running the sweep by hand.
 *  · **`Authorization: Bearer $CRON_SECRET`** — for the scheduler. The header is
 *    compared in constant time, and when `CRON_SECRET` is unset this route is
 *    admin-session-only.
 *
 *     *\/10 * * * *  curl -fsS -X POST https://<host>/api/cron/billing/auto-topup \
 *                       -H "Authorization: Bearer $CRON_SECRET"
 */
export const POST = defineHandler(
  {
    auth: 'optional',
    csrf: false, // re-applied to the session path inside authorizeCronOrAdmin
    rateLimit: 'api.default',
    audit: {
      action: AUDIT_ACTIONS.billingTopup,
      resourceType: 'team',
      severity: 'notice',
    },
  },
  async ({ req, setAudit }) => {
    await authorizeCronOrAdmin(req);

    const result = await sweepAutoTopups();

    setAudit({
      summary: `Auto top-up sweep: ${result.charged.length} charged, ${result.failed.length} failed of ${result.considered}`,
      metadata: { charged: result.charged, failed: result.failed },
    });

    return json({
      considered: result.considered,
      charged: result.charged,
      failed: result.failed,
      chargedCount: result.charged.length,
      failedCount: result.failed.length,
    });
  },
);
