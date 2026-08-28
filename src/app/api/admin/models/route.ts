import { and, asc, eq, isNull } from 'drizzle-orm';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { modelPrices, models, providers } from '@/lib/db/schema';

/** The model catalogue with each model's currently effective price. */

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
