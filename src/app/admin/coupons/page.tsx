import { desc, eq, sql } from 'drizzle-orm';

import { CouponsManager, type AdminCoupon } from '@/components/admin/coupons-manager';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { couponRedemptions, coupons, users } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

/**
 * Authorisation lives here, not only in `app/admin/layout.tsx` — a layout is
 * not a security boundary in the App Router (see admin/plans/page.tsx).
 */
export default async function AdminCouponsPage() {
  await requirePlatformAdmin();

  const rows = await db
    .select({
      coupon: coupons,
      createdBy: users.email,
      redemptionCount: sql<number>`(select count(*) from ${couponRedemptions} where ${couponRedemptions.couponId} = ${coupons.id})::int`,
    })
    .from(coupons)
    .leftJoin(users, eq(users.id, coupons.createdById))
    .orderBy(desc(coupons.createdAt));

  const list: AdminCoupon[] = rows.map(({ coupon, createdBy, redemptionCount }) => ({
    id: coupon.id,
    code: coupon.code,
    name: coupon.name,
    kind: coupon.kind,
    amountMicroUsd: coupon.amountMicroUsd,
    creditFor: coupon.creditFor,
    percentOff: coupon.percentOff,
    planTier: coupon.planTier,
    maxRedemptions: coupon.maxRedemptions,
    maxPerTeam: coupon.maxPerTeam,
    expiresAt: coupon.expiresAt?.toISOString() ?? null,
    isActive: coupon.isActive,
    redemptionCount: Number(redemptionCount) || 0,
    createdBy: createdBy ?? '—',
    createdAt: coupon.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Coupons"
        description="Promo codes redeemed in Billing: bonus balance for AI tokens or compute hours, or a personal percentage off one plan. Codes never appear at the Stripe checkout."
      />
      {list.length === 0 ? (
        <EmptyState
          title="No promo codes yet"
          description="Create one to hand out bonus credit or a plan discount. Redemption counts and limits are enforced at the moment a code is applied."
        />
      ) : null}
      <CouponsManager coupons={list} />
    </div>
  );
}
