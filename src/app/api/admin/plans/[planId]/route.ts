import { and, eq, inArray, ne } from 'drizzle-orm';

import { planPatchSchema } from '@/components/admin/plan-schema';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { plans, subscriptions } from '@/lib/db/schema';

/**
 * Editing a plan changes what *new* subscriptions get. Existing subscriptions
 * carry a `quotaSnapshot` taken at purchase time, so nobody's limits move under
 * them mid-cycle — the UI says this before saving and the audit metadata
 * records exactly which columns moved.
 */

function paramPlanId(params: Record<string, string | string[] | undefined>): string {
  const value = params.planId;
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new ValidationError('A plan id is required.');
  return id;
}

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: planPatchSchema,
    audit: { action: AUDIT_ACTIONS.adminPlanUpdate, resourceType: 'plan', severity: 'notice' },
  },
  async ({ body, params, setAudit }) => {
    await requireApiPlatformAdmin();
    const planId = paramPlanId(params);

    const rows = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    const current = rows[0];
    if (!current) throw new NotFoundError('That plan does not exist.');

    if (body.key && body.key !== current.key) {
      const clash = await db
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.key, body.key), ne(plans.id, planId)));
      if (clash.length > 0) {
        throw new ConflictError(`A plan with the key "${body.key}" already exists.`);
      }
    }

    // Only report columns that actually moved — a diff of everything is noise.
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, next] of Object.entries(body)) {
      const previous = (current as Record<string, unknown>)[key];
      if (JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null)) {
        changed[key] = { from: previous ?? null, to: next ?? null };
      }
    }

    if (Object.keys(changed).length === 0) {
      setAudit({ record: false });
      return json({ plan: current, changed: {} });
    }

    const [updated] = await db
      .update(plans)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(plans.id, planId))
      .returning();

    const affected = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.planId, planId),
          inArray(subscriptions.status, ['active', 'trialing']),
        ),
      );

    setAudit({
      resourceId: planId,
      summary: `Updated plan "${current.name}": ${Object.keys(changed).join(', ')}`,
      metadata: { changed, activeSubscriptions: affected.length },
    });

    return json({ plan: updated, changed, activeSubscriptions: affected.length });
  },
);

export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.adminPlanUpdate, resourceType: 'plan', severity: 'warning' },
  },
  async ({ params, setAudit }) => {
    await requireApiPlatformAdmin();
    const planId = paramPlanId(params);

    const rows = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    const current = rows[0];
    if (!current) throw new NotFoundError('That plan does not exist.');

    const subscribed = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.planId, planId))
      .limit(1);

    if (subscribed.length > 0) {
      throw new ConflictError('This plan still has subscriptions attached to it.', {
        title: 'Plan is in use',
        description:
          'Deleting it would orphan billing history. Deactivate the plan instead — it stays valid for existing subscribers and disappears from the pricing page.',
      });
    }

    await db.delete(plans).where(eq(plans.id, planId));

    setAudit({
      resourceId: planId,
      summary: `Deleted plan "${current.name}" (${current.key})`,
      metadata: { key: current.key, tier: current.tier },
    });

    return json({ ok: true });
  },
);
