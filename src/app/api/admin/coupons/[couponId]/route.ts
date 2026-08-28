import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { coupons } from '@/lib/db/schema';

/** Retire or re-arm a promo code; limits may be raised but never tightened
 * below the redemptions already recorded. */

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  maxRedemptions: z.number().int().min(1).max(100_000).optional(),
  maxPerTeam: z.number().int().min(1).max(100).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: patchSchema,
    audit: { action: AUDIT_ACTIONS.adminCouponUpdate, resourceType: 'coupon' },
  },
  async ({ body, params, user, setAudit }) => {
    await requireApiPlatformAdmin();

    const rawId = params.couponId;
    const couponId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!couponId) throw new NotFoundError('That coupon does not exist.');

    const [current] = await db.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    if (!current) throw new NotFoundError('That coupon does not exist.');

    await db
      .update(coupons)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(coupons.id, couponId));

    setAudit({
      resourceId: couponId,
      summary: `Updated coupon ${current.code}`,
      metadata: { code: current.code, changes: body, actorId: user.id },
    });

    const [updated] = await db.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    return json({ coupon: updated });
  },
);
