import { absoluteUrl, toBillingApiError } from '../_shared';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getActiveTeam } from '@/lib/auth/guards';
import { getBillingProvider } from '@/lib/billing';
import { assertCan } from '@/lib/rbac/permissions';

/**
 * Opens the provider's own billing portal (payment methods, receipts, tax ids).
 * With simulated billing this returns to `/app/billing` with a marker so the
 * page can explain that there is no external portal to open.
 */
export const POST = defineHandler({ auth: 'required' }, async ({ user, req }) => {
  const { team, role } = await getActiveTeam(user.id);
  assertCan(role, 'billing.manage');

  const provider = getBillingProvider();

  try {
    const session = await provider.createPortalSession({
      teamId: team.id,
      customerId: team.stripeCustomerId,
      returnUrl: absoluteUrl(req, '/app/billing'),
    });
    return json({ url: session.url, simulated: provider.key === 'mock' });
  } catch (error) {
    throw toBillingApiError(error);
  }
});
