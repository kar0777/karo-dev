import { and, eq } from 'drizzle-orm';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { syncProviderCatalogs, type ByokCredential } from '@/lib/ai/catalog-sync';
import { decryptSecret } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { userApiKeys } from '@/lib/db/schema';

/**
 * Refresh the catalogue from every enabled provider, on demand.
 *
 * The sync rules themselves (disable-don't-delete, append-only prices,
 * adminOverride pins, never overwrite a held value with an unreported one)
 * live in `src/lib/ai/catalog-sync.ts`, which the nightly maintenance tick
 * shares. This route is the operator's lever: it runs every enabled provider —
 * including ones with no credentials yet, so the response explains what is
 * missing rather than silently skipping it.
 */
export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: {
      action: AUDIT_ACTIONS.adminCatalogSync,
      resourceType: 'provider',
      severity: 'notice',
    },
  },
  async ({ user, setAudit }) => {
    await requireApiPlatformAdmin();

    // Discovery runs on the platform's keys where they exist, and on the
    // calling admin's own active keys for the rest — on an install whose only
    // credentials are the operator's BYOK entries, those ARE the platform.
    const byokRows = await db
      .select({
        providerKey: userApiKeys.providerKey,
        keyCiphertext: userApiKeys.keyCiphertext,
        baseUrl: userApiKeys.baseUrl,
      })
      .from(userApiKeys)
      .where(and(eq(userApiKeys.userId, user.id), eq(userApiKeys.isActive, true)));

    const byokCredentials = new Map<string, ByokCredential>();
    for (const row of byokRows) {
      if (byokCredentials.has(row.providerKey)) continue;
      try {
        byokCredentials.set(row.providerKey, {
          apiKey: decryptSecret(row.keyCiphertext),
          baseUrl: row.baseUrl ?? undefined,
        });
      } catch {
        // A key encrypted under a rotated ENCRYPTION_KEY is unusable; skip it.
      }
    }

    const { syncedProviders, changes, errors, syncedAt } = await syncProviderCatalogs({
      byokCredentials,
    });

    setAudit({
      resourceId: 'catalog',
      summary: `Catalogue sync: ${changes.length} change${changes.length === 1 ? '' : 's'} across ${syncedProviders} provider${syncedProviders === 1 ? '' : 's'}`,
      metadata: { changes: changes.slice(0, 50), errors },
      severity: errors.length > 0 ? 'warning' : 'notice',
    });

    return json({
      ok: errors.length === 0,
      syncedProviders,
      changes,
      errors,
      syncedAt: syncedAt.toISOString(),
    });
  },
);
