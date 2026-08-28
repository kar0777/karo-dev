import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { mergePreferences, readPreferences } from '@/lib/account/preferences';
import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

/**
 * Notification preferences. `securityAlerts` is accepted for symmetry but
 * always stored as `true` — an account takeover has to be able to reach you.
 */

const bodySchema = z
  .object({
    usageAlerts: z.boolean().optional(),
    runCompletion: z.boolean().optional(),
    billingEvents: z.boolean().optional(),
    weeklyDigest: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: { action: 'user.notifications_update', resourceType: 'user' },
  },
  async ({ user, body, setAudit }) => {
    const onboardingState = mergePreferences(user.onboardingState, { notifications: body });

    const updated = await db
      .update(users)
      .set({ onboardingState, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();

    const row = updated[0];
    if (!row) throw new NotFoundError('Account not found.');

    setAudit({
      resourceId: user.id,
      summary: 'Notification preferences updated',
      metadata: { fields: Object.keys(body) },
    });

    return json({ notifications: readPreferences(row.onboardingState).notifications });
  },
);
