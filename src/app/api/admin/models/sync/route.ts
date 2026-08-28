import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { syncProviderCatalogs } from '@/lib/ai/catalog-sync';

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
  async ({ setAudit }) => {
    await requireApiPlatformAdmin();

    const { syncedProviders, changes, errors, syncedAt } = await syncProviderCatalogs();

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
