import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { teams } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';
import { formatPercent } from '@/lib/utils';

/**
 * The quota-alert threshold. Below 50% the alert is noise; above 100% it can
 * never fire, so the range is clamped in the schema rather than the UI alone.
 */

const body = z.object({
  threshold: z
    .number()
    .min(0.5, 'Alert at 50% of the allowance or later.')
    .max(1, 'The threshold cannot exceed 100% of the allowance.'),
});

export const PATCH = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: 'billing.usage_alert_update', resourceType: 'team' },
  },
  async ({ user, body: input, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'billing.manage');

    const threshold = Math.round(input.threshold * 100) / 100;

    await db
      .update(teams)
      .set({ usageAlertThreshold: threshold, updatedAt: new Date() })
      .where(eq(teams.id, team.id));

    setAudit({
      teamId: team.id,
      resourceId: team.id,
      summary: `Usage alert threshold set to ${formatPercent(threshold)}`,
      metadata: { previous: team.usageAlertThreshold, next: threshold },
    });

    return json({ ok: true, threshold });
  },
);
