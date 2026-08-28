import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { generateCouponCode } from '@/lib/billing/coupons';
import { db } from '@/lib/db';
import { couponRedemptions, coupons } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * Admin → Coupons. Codes are stored uppercase and redeemed
 * case-insensitively; an empty code on create generates one.
 */

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]*$/, 'Letters, digits and dashes only.')
      .max(60)
      .optional(),
    kind: z.enum(['credit', 'plan_discount']),
    /** Credit kind, in whole dollars for admin convenience. */
    amountUsd: z.number().min(0).max(100_000).optional(),
    creditFor: z.enum(['tokens', 'compute', 'any']).default('any'),
    percentOff: z.number().int().min(1).max(100).optional(),
    planTier: z.enum(['payg', 'lite', 'pro', 'scale', 'ultra']).optional(),
    maxRedemptions: z.number().int().min(1).max(100_000).default(1),
    maxPerTeam: z.number().int().min(1).max(100).default(1),
    expiresAt: z.coerce.date().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((body) => body.kind !== 'credit' || (body.amountUsd ?? 0) > 0, {
    message: 'A credit coupon needs an amount in dollars.',
    path: ['amountUsd'],
  })
  .refine((body) => body.kind !== 'plan_discount' || Boolean(body.percentOff && body.planTier), {
    message: 'A discount coupon needs a percentage and a plan.',
    path: ['percentOff'],
  });

export const GET = defineHandler({ auth: 'required', rateLimit: 'api.default' }, async () => {
  await requireApiPlatformAdmin();

  const rows = await db
    .select({
      coupon: coupons,
      redemptionCount: sql<number>`(select count(*) from ${couponRedemptions} where ${couponRedemptions.couponId} = ${coupons.id})::int`,
    })
    .from(coupons)
    .orderBy(desc(coupons.createdAt));

  return json({ coupons: rows });
});

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: createSchema,
    audit: { action: AUDIT_ACTIONS.adminCouponCreate, resourceType: 'coupon' },
  },
  async ({ body, user, setAudit }) => {
    await requireApiPlatformAdmin();

    const code = (body.code?.trim() || generateCouponCode()).toUpperCase();
    const clash = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, code)).limit(1);
    if (clash.length > 0) {
      throw new ValidationError(`Code "${code}" already exists.`, undefined, {
        title: 'Code taken',
        description: 'Pick another code or leave the field empty to generate one.',
      });
    }

    const couponId = newId(ID_PREFIX.coupon);
    await db.insert(coupons).values({
      id: couponId,
      code,
      name: body.name,
      kind: body.kind,
      amountMicroUsd:
        body.kind === 'credit' ? Math.round((body.amountUsd ?? 0) * 1_000_000) : 0,
      creditFor: body.kind === 'credit' ? body.creditFor : 'any',
      percentOff: body.kind === 'plan_discount' ? (body.percentOff ?? null) : null,
      planTier: body.kind === 'plan_discount' ? (body.planTier ?? null) : null,
      maxRedemptions: body.maxRedemptions,
      maxPerTeam: body.maxPerTeam,
      expiresAt: body.expiresAt ?? null,
      isActive: body.isActive,
      createdById: user.id,
    });

    setAudit({
      resourceId: couponId,
      summary: `Created coupon ${code} (${body.kind})`,
      metadata: { code, kind: body.kind, actorId: user.id },
    });

    const [created] = await db.select().from(coupons).where(eq(coupons.id, couponId)).limit(1);
    return json({ coupon: created }, { status: 201 });
  },
);
