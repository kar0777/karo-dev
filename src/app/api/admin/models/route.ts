import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { modelPrices, models, providers } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * The model catalogue with each model's currently effective price.
 *
 * `POST` is the manual complement to catalogue sync: discovery imports what a
 * provider's `/models` endpoint reports, but a model can be reachable while
 * absent from that list (or listed under an id the operator wants served under
 * a different name), so an admin can add one by hand. Uniqueness of
 * (provider, slug) — the same natural key sync merges on — is enforced here,
 * so a later sync updates the manual entry instead of duplicating it.
 */

const priceSchema = z.object({
  inputMicroUsdPerMtok: z.number().int().min(0).max(1_000_000_000),
  outputMicroUsdPerMtok: z.number().int().min(0).max(1_000_000_000),
  cachedInputMicroUsdPerMtok: z.number().int().min(0).max(1_000_000_000),
  cacheWriteMicroUsdPerMtok: z.number().int().min(0).max(1_000_000_000),
});

const createSchema = z.object({
  providerKey: z.string().trim().min(1).max(60),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^\S+$/, 'The model id must not contain whitespace.'),
  displayName: z.string().trim().min(1).max(120),
  family: z.string().trim().min(1).max(60).default('other'),
  description: z.string().trim().max(1000).optional(),
  contextWindow: z.number().int().min(1_000).max(20_000_000).default(128_000),
  maxOutputTokens: z.number().int().min(64).max(1_000_000).default(8_192),
  supportsTools: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  supportsCaching: z.boolean().default(false),
  supportsStreaming: z.boolean().default(true),
  minPlanTier: z.enum(['payg', 'lite', 'pro', 'scale', 'ultra']).default('payg'),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(500),
  prices: priceSchema.optional(),
});

export const GET = defineHandler({ auth: 'required', rateLimit: 'api.default' }, async () => {
  await requireApiPlatformAdmin();

  const rows = await db
    .select({
      model: models,
      providerKey: providers.key,
      providerName: providers.name,
      price: modelPrices,
    })
    .from(models)
    .innerJoin(providers, eq(providers.id, models.providerId))
    .leftJoin(
      modelPrices,
      and(eq(modelPrices.modelId, models.id), isNull(modelPrices.effectiveTo)),
    )
    .orderBy(asc(models.sortOrder), asc(models.displayName));

  return json({ models: rows });
});

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: createSchema,
    audit: {
      action: AUDIT_ACTIONS.adminModelUpdate,
      resourceType: 'model',
      severity: 'notice',
    },
  },
  async ({ body, user, setAudit }) => {
    await requireApiPlatformAdmin();

    const providerRows = await db
      .select()
      .from(providers)
      .where(eq(providers.key, body.providerKey))
      .limit(1);
    const provider = providerRows[0];
    if (!provider) {
      throw new ValidationError(
        `No provider with key "${body.providerKey}" exists. Sync or seed providers first.`,
      );
    }

    const clash = await db
      .select({ id: models.id })
      .from(models)
      .where(and(eq(models.providerId, provider.id), eq(models.slug, body.slug)))
      .limit(1);
    if (clash.length > 0) {
      throw new ValidationError(
        `${provider.name} already has a model with id "${body.slug}". Edit it instead.`,
      );
    }

    const { prices, ...fields } = body;
    // The same guardrail catalogue sync applies: a model without a tariff
    // cannot be enabled, or it would be free to spend against.
    const enabled = body.isEnabled ?? Boolean(prices);

    const modelId = newId(ID_PREFIX.model);
    await db.insert(models).values({
      id: modelId,
      providerId: provider.id,
      ...fields,
      isEnabled: enabled,
    });
    await db.insert(modelPrices).values({
      id: newId(ID_PREFIX.modelPrice),
      modelId,
      inputMicroUsdPerMtok: prices?.inputMicroUsdPerMtok ?? 0,
      outputMicroUsdPerMtok: prices?.outputMicroUsdPerMtok ?? 0,
      cachedInputMicroUsdPerMtok: prices?.cachedInputMicroUsdPerMtok ?? 0,
      cacheWriteMicroUsdPerMtok: prices?.cacheWriteMicroUsdPerMtok ?? 0,
      source: prices ? 'admin' : 'admin-unpriced',
      effectiveFrom: new Date(),
    });

    setAudit({
      resourceId: modelId,
      summary: `Added model "${body.displayName}" (${body.slug}) to ${provider.name}${enabled ? '' : ', disabled until priced'}`,
      metadata: {
        providerKey: provider.key,
        slug: body.slug,
        priced: Boolean(prices),
        actorId: user.id,
      },
    });

    const [created] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
    return json({ model: created }, { status: 201 });
  },
);
