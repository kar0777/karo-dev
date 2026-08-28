import { asc, sql } from 'drizzle-orm';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { getProviderByKey } from '@/lib/ai';
import { db } from '@/lib/db';
import { models, providers } from '@/lib/db/schema';

/**
 * Upstream providers.
 *
 * The API key itself is never part of any response — only whether one is
 * configured and which environment variable it came from.
 */

export const GET = defineHandler({ auth: 'required', rateLimit: 'api.default' }, async () => {
  await requireApiPlatformAdmin();

  const rows = await db
    .select({
      provider: providers,
      modelCount: sql<string>`(select count(*) from ${models} where ${models.providerId} = ${providers.id})`,
    })
    .from(providers)
    .orderBy(asc(providers.name));

  return json({
    providers: rows.map(({ provider, modelCount }) => ({
      ...provider,
      modelCount: Number(modelCount) || 0,
      credentialConfigured: getProviderByKey(provider.key).isConfigured(),
    })),
  });
});
