import { z } from 'zod';

import { absoluteUrl, billingIdempotencyKey, toBillingApiError } from '../_shared';

import { ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { getBillingProvider } from '@/lib/billing';
import { assertCan } from '@/lib/rbac/permissions';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';
import { formatMicroUsd } from '@/lib/utils';

/** Adds pay-as-you-go credit. Amounts are integer micro-USD, like every price. */

/** $50,000 — a ceiling that stops a fat-fingered zero, not a business rule. */
const MAX_TOPUP_MICRO_USD = 50_000_000_000;

const body = z.object({
  amountMicroUsd: z
    .number()
    .int('Enter a whole amount.')
    .positive('Enter an amount greater than zero.')
    .max(MAX_TOPUP_MICRO_USD, 'That is larger than the maximum single top-up.'),
});

export const POST = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: AUDIT_ACTIONS.billingTopup, resourceType: 'topup' },
  },
  async ({ user, body: input, req, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'billing.manage');

    const minimum = await getSetting(
      SETTING_KEYS.billingMinTopupMicroUsd,
      settingDefault(SETTING_KEYS.billingMinTopupMicroUsd),
    );

    if (input.amountMicroUsd < minimum) {
      throw new ValidationError(
        `The minimum top-up is ${formatMicroUsd(minimum)}.`,
        [
          {
            path: 'amountMicroUsd',
            message: `Enter ${formatMicroUsd(minimum)} or more.`,
            code: 'too_small',
          },
        ],
        {
          title: 'Amount is below the minimum',
          description: `Karo accepts top-ups from ${formatMicroUsd(minimum)}. Pick a preset or raise the custom amount.`,
        },
      );
    }

    const provider = getBillingProvider();
    const idempotencyKey = billingIdempotencyKey('topup', [team.id, input.amountMicroUsd]);

    let session;
    try {
      session = await provider.createCheckoutSession({
        teamId: team.id,
        userId: user.id,
        customerEmail: user.email,
        mode: 'payment',
        amountMicroUsd: input.amountMicroUsd,
        successUrl: absoluteUrl(req, '/app/billing'),
        cancelUrl: absoluteUrl(req, '/app/billing?checkout=cancelled'),
        idempotencyKey,
      });
    } catch (error) {
      throw toBillingApiError(error);
    }

    setAudit({
      teamId: team.id,
      resourceId: session.id,
      summary: `Top-up of ${formatMicroUsd(input.amountMicroUsd)} started`,
      metadata: {
        amountMicroUsd: input.amountMicroUsd,
        provider: provider.key,
        completedImmediately: session.completedImmediately,
      },
    });

    return json({
      url: session.url,
      simulated: session.completedImmediately,
    });
  },
);
