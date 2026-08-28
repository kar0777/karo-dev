import { asc, eq } from 'drizzle-orm';

import { planFormSchema } from '@/components/admin/plan-schema';
import { ConflictError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { plans } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';

/** The plan catalogue. Every quota in the product is a column on these rows. */

/**
 * Margin, auto-sleep and auto-destroy are the three plan columns that also have
 * a platform-wide default on the settings page, so a create request may leave
 * them out and inherit the current default instead of restating a number the
 * operator has already chosen once. Everything else stays required: a plan whose
 * quota was guessed would quietly sell the wrong thing.
 */
const PLATFORM_DEFAULTED_COLUMNS = [
  'marginBps',
  'autoSleepMinutes',
  'autoDestroyHours',
] as const;

const planCreateSchema = planFormSchema.extend({
  marginBps: planFormSchema.shape.marginBps.optional(),
  autoSleepMinutes: planFormSchema.shape.autoSleepMinutes.optional(),
  autoDestroyHours: planFormSchema.shape.autoDestroyHours.optional(),
});

export const GET = defineHandler({ auth: 'required', rateLimit: 'api.default' }, async () => {
  await requireApiPlatformAdmin();
  const rows = await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.name));
  return json({ plans: rows });
});

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: planCreateSchema,
    audit: { action: AUDIT_ACTIONS.adminPlanUpdate, resourceType: 'plan', severity: 'notice' },
  },
  async ({ body, setAudit }) => {
    await requireApiPlatformAdmin();

    const existing = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.key, body.key));
    if (existing.length > 0) {
      throw new ConflictError(`A plan with the key "${body.key}" already exists.`, {
        title: 'Plan key taken',
        description: 'Plan keys are permanent identifiers. Pick another key for the new plan.',
      });
    }

    const [defaultMarginBps, defaultAutoSleepMinutes, defaultAutoDestroyHours] =
      await Promise.all([
        getSetting<number>(
          SETTING_KEYS.platformMarginBps,
          settingDefault(SETTING_KEYS.platformMarginBps),
        ),
        getSetting<number>(
          SETTING_KEYS.sandboxDefaultAutoSleepMinutes,
          settingDefault(SETTING_KEYS.sandboxDefaultAutoSleepMinutes),
        ),
        getSetting<number>(
          SETTING_KEYS.sandboxDefaultAutoDestroyHours,
          settingDefault(SETTING_KEYS.sandboxDefaultAutoDestroyHours),
        ),
      ]);

    // The defaults seed the columns; from here on the plan row owns them, which
    // is what keeps settlement and sandbox creation reading one number each.
    const inherited = PLATFORM_DEFAULTED_COLUMNS.filter((column) => body[column] === undefined);

    const id = newId(ID_PREFIX.plan);
    const [row] = await db
      .insert(plans)
      .values({
        id,
        ...body,
        marginBps: body.marginBps ?? defaultMarginBps,
        autoSleepMinutes: body.autoSleepMinutes ?? defaultAutoSleepMinutes,
        autoDestroyHours: body.autoDestroyHours ?? defaultAutoDestroyHours,
      })
      .returning();

    setAudit({
      resourceId: id,
      summary: `Created plan "${body.name}" (${body.key})`,
      metadata: {
        key: body.key,
        tier: body.tier,
        priceMicroUsdMonthly: body.priceMicroUsdMonthly,
        inheritedFromPlatformDefaults: inherited,
      },
    });

    return created({ plan: row });
  },
);
