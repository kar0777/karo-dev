import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { modelPrices, models } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * Model edits.
 *
 * Prices are **never** mutated in place. A price change closes the current
 * `model_prices` row with `effectiveTo` and inserts a new one, so a usage event
 * recorded last week still resolves to the price that was actually charged.
 */

const priceSchema = z.object({
  inputMicroUsdPerMtok: z.number().int().min(0).max(1_000_000_000),
  outputMicroUsdPerMtok: z.number().int().min(0).max(1_000_000_000),
  cachedInputMicroUsdPerMtok: z.number().int().min(0).max(1_000_000_000),
  cacheWriteMicroUsdPerMtok: z.number().int().min(0).max(1_000_000_000),
});

const bodySchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  family: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  contextWindow: z.number().int().min(1_000).max(20_000_000).optional(),
  maxOutputTokens: z.number().int().min(64).max(1_000_000).optional(),
  supportsTools: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  supportsCaching: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  minPlanTier: z.enum(['payg', 'lite', 'pro', 'scale', 'ultra']).optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  /** Free-form pin against catalogue sync; `null` clears it. */
  adminOverride: z.record(z.string(), z.unknown()).nullable().optional(),
  prices: priceSchema.optional(),
});

function paramModelId(params: Record<string, string | string[] | undefined>): string {
  const value = params.modelId;
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new ValidationError('A model id is required.');
  return id;
}

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ params }) => {
    await requireApiPlatformAdmin();
    const modelId = paramModelId(params);

    const rows = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
    const model = rows[0];
    if (!model) throw new NotFoundError('That model does not exist.');

    const history = await db
      .select()
      .from(modelPrices)
      .where(eq(modelPrices.modelId, modelId))
      .orderBy(desc(modelPrices.effectiveFrom))
      .limit(50);

    return json({ model, history });
  },
);

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: {
      action: AUDIT_ACTIONS.adminModelUpdate,
      resourceType: 'model',
      severity: 'notice',
    },
  },
  async ({ body, params, user, setAudit }) => {
    await requireApiPlatformAdmin();
    const modelId = paramModelId(params);

    const rows = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
    const current = rows[0];
    if (!current) throw new NotFoundError('That model does not exist.');

    const { prices, ...fields } = body;

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, next] of Object.entries(fields)) {
      const previous = (current as Record<string, unknown>)[key];
      if (JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null)) {
        changed[key] = { from: previous ?? null, to: next ?? null };
      }
    }

    if (Object.keys(changed).length > 0) {
      await db
        .update(models)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(models.id, modelId));
    }

    // Exactly one model is the platform default; promoting one demotes the rest.
    if (fields.isDefault === true) {
      await db
        .update(models)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(models.isDefault, true), ne(models.id, modelId)));
    }

    let newPriceId: string | null = null;
    if (prices) {
      const currentPrice = (
        await db
          .select()
          .from(modelPrices)
          .where(and(eq(modelPrices.modelId, modelId), isNull(modelPrices.effectiveTo)))
          .orderBy(desc(modelPrices.effectiveFrom))
          .limit(1)
      )[0];

      const unchanged =
        currentPrice &&
        currentPrice.inputMicroUsdPerMtok === prices.inputMicroUsdPerMtok &&
        currentPrice.outputMicroUsdPerMtok === prices.outputMicroUsdPerMtok &&
        currentPrice.cachedInputMicroUsdPerMtok === prices.cachedInputMicroUsdPerMtok &&
        currentPrice.cacheWriteMicroUsdPerMtok === prices.cacheWriteMicroUsdPerMtok;

      if (!unchanged) {
        const now = new Date();
        if (currentPrice) {
          await db
            .update(modelPrices)
            .set({ effectiveTo: now })
            .where(eq(modelPrices.id, currentPrice.id));
        }
        newPriceId = newId(ID_PREFIX.modelPrice);
        await db.insert(modelPrices).values({
          id: newPriceId,
          modelId,
          ...prices,
          source: 'admin',
          effectiveFrom: now,
        });
        changed.prices = {
          from: currentPrice
            ? {
                input: currentPrice.inputMicroUsdPerMtok,
                output: currentPrice.outputMicroUsdPerMtok,
              }
            : null,
          to: { input: prices.inputMicroUsdPerMtok, output: prices.outputMicroUsdPerMtok },
        };
      }
    }

    if (Object.keys(changed).length === 0) {
      setAudit({ record: false });
      return json({ model: current, changed: {} });
    }

    setAudit({
      resourceId: modelId,
      summary: `Updated model "${current.displayName}": ${Object.keys(changed).join(', ')}`,
      metadata: { changed, actorId: user.id, newPriceId },
    });

    const [updated] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
    return json({ model: updated, changed, newPriceId });
  },
);
