import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { teams } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';
import { formatMicroUsd } from '@/lib/utils';

/**
 * Spending controls: the monthly cap and auto-top-up.
 *
 * These are the two settings that decide whether a runaway agent costs money,
 * so they live behind `billing.manage` and every change is audited with the
 * previous value — "who raised the cap" is the first question after a surprise
 * invoice.
 */

/** $1,000,000 — high enough for any real team, low enough to catch a typo. */
const MAX_MONEY_MICRO_USD = 1_000_000_000_000;

const money = z.number().int().min(0).max(MAX_MONEY_MICRO_USD);

const body = z
  .object({
    spendCapMicroUsd: money.optional(),
    autoTopupEnabled: z.boolean().optional(),
    autoTopupThresholdMicroUsd: money.optional(),
    autoTopupAmountMicroUsd: money.optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    'Send at least one setting to change.',
  );

export const PATCH = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: AUDIT_ACTIONS.billingSpendCapUpdate, resourceType: 'team' },
  },
  async ({ user, body: input, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'billing.manage');

    const next = {
      spendCapMicroUsd: input.spendCapMicroUsd ?? team.spendCapMicroUsd,
      autoTopupEnabled: input.autoTopupEnabled ?? team.autoTopupEnabled,
      autoTopupThresholdMicroUsd:
        input.autoTopupThresholdMicroUsd ?? team.autoTopupThresholdMicroUsd,
      autoTopupAmountMicroUsd: input.autoTopupAmountMicroUsd ?? team.autoTopupAmountMicroUsd,
    };

    if (next.autoTopupEnabled && next.autoTopupAmountMicroUsd <= 0) {
      throw new ValidationError(
        'Auto top-up needs an amount to charge.',
        [
          {
            path: 'autoTopupAmountMicroUsd',
            message: 'Set how much to add each time.',
            code: 'required',
          },
        ],
        {
          title: 'Auto top-up is incomplete',
          description:
            'Choose the amount Karo should add when the balance falls below the threshold, then save again.',
        },
      );
    }

    if (
      next.autoTopupEnabled &&
      next.autoTopupAmountMicroUsd <= next.autoTopupThresholdMicroUsd
    ) {
      throw new ValidationError(
        'The top-up amount must exceed the trigger threshold.',
        [
          {
            path: 'autoTopupAmountMicroUsd',
            message: `Enter more than ${formatMicroUsd(next.autoTopupThresholdMicroUsd)}.`,
            code: 'too_small',
          },
        ],
        {
          title: 'Auto top-up would loop',
          description:
            'If the amount added is not larger than the threshold, the balance would immediately fall below it again and charge repeatedly.',
        },
      );
    }

    await db
      .update(teams)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(teams.id, team.id));

    setAudit({
      teamId: team.id,
      resourceId: team.id,
      severity: 'notice',
      summary:
        input.spendCapMicroUsd !== undefined
          ? `Monthly spend cap set to ${next.spendCapMicroUsd === 0 ? 'no cap' : formatMicroUsd(next.spendCapMicroUsd)}`
          : 'Auto top-up settings updated',
      metadata: {
        previous: {
          spendCapMicroUsd: team.spendCapMicroUsd,
          autoTopupEnabled: team.autoTopupEnabled,
          autoTopupThresholdMicroUsd: team.autoTopupThresholdMicroUsd,
          autoTopupAmountMicroUsd: team.autoTopupAmountMicroUsd,
        },
        next,
      },
    });

    return json({ ok: true, ...next });
  },
);
