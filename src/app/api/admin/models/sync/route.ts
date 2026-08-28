import { and, eq, isNull } from 'drizzle-orm';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { getProviderByKey } from '@/lib/ai';
import { quotedAPrice, reportedFields } from '@/lib/ai/catalog-merge';
import type { ProviderModelInfo } from '@/lib/ai/types';
import { db } from '@/lib/db';
import { modelPrices, models, providers } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * Refresh the catalogue from the upstream provider.
 *
 * Rules that make this safe to run at any time:
 *  · a model the key can no longer reach is **disabled**, never deleted —
 *    usage events and conversations still point at it;
 *  · a price change opens a new `model_prices` row instead of editing history;
 *  · a model carrying an `adminOverride` keeps the pinned fields, so a manual
 *    correction is not silently reverted by the next sync;
 *  · **a value the provider did not report never overwrites one Karo has.**
 *
 * That last rule is the important one, and it used to be missing.
 * `GET /models` is an availability probe: on every provider Karo ships it
 * returns model ids and nothing else — no prices, and usually no context window.
 * The adapter reports those unknowns as `0`. Treating `0` as a *new value* meant
 * one click of "Sync from provider" closed every current price row and wrote a
 * replacement priced at zero, so the whole catalogue became free, quota
 * accounting fell back to estimated multipliers, and the price history was
 * polluted with rows that never reflected a real tariff. Prices come from the
 * seed or from an admin, and a sync must leave them alone unless the provider
 * genuinely quoted one.
 */

export type SyncChange = {
  slug: string;
  displayName: string;
  kind: 'added' | 'updated' | 'repriced' | 'disabled' | 'reenabled';
  detail: string;
};

function overrideOf(model: { adminOverride: Record<string, unknown> | null }) {
  return model.adminOverride ?? {};
}

function applyOverride<T extends Record<string, unknown>>(
  values: T,
  override: Record<string, unknown>,
): T {
  return { ...values, ...override } as T;
}

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

    const providerRows = await db.select().from(providers).where(eq(providers.isEnabled, true));
    const changes: SyncChange[] = [];
    const errors: Array<{ provider: string; message: string }> = [];
    const now = new Date();

    for (const provider of providerRows) {
      const adapter = getProviderByKey(provider.key);

      let catalogue: ProviderModelInfo[] | null = null;
      try {
        catalogue = await adapter.listModels();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ provider: provider.key, message });
        await db
          .update(providers)
          .set({ lastSyncError: message, healthStatus: 'error', updatedAt: now })
          .where(eq(providers.id, provider.id));
        continue;
      }

      if (!catalogue) {
        const message =
          'This provider returned no model catalogue. Check that its API key is configured and that the catalogue endpoint is reachable.';
        errors.push({ provider: provider.key, message });
        // Written to the row as well as to the response. The response is read
        // once, but /admin/models re-renders this provider as stale on every
        // visit — with no reason on the row it would go on telling an operator
        // to press Sync, which is the one thing that cannot help here.
        await db
          .update(providers)
          .set({ lastSyncError: message, healthStatus: 'disconnected', updatedAt: now })
          .where(eq(providers.id, provider.id));
        continue;
      }

      const existing = await db.select().from(models).where(eq(models.providerId, provider.id));
      const bySlug = new Map(existing.map((model) => [model.slug, model]));
      const seen = new Set<string>();

      for (const info of catalogue) {
        seen.add(info.slug);
        const current = bySlug.get(info.slug);

        const incoming = reportedFields(info);
        const priced = quotedAPrice(info);

        if (!current) {
          const modelId = newId(ID_PREFIX.model);
          await db.insert(models).values({
            id: modelId,
            providerId: provider.id,
            slug: info.slug,
            ...incoming,
            // A model discovered with no price would otherwise be free to use.
            // It arrives disabled so an admin sets a tariff before anyone can
            // spend against it; the change entry below says so.
            isEnabled: priced,
          });
          await db.insert(modelPrices).values({
            id: newId(ID_PREFIX.modelPrice),
            modelId,
            inputMicroUsdPerMtok: info.inputMicroUsdPerMtok,
            outputMicroUsdPerMtok: info.outputMicroUsdPerMtok,
            cachedInputMicroUsdPerMtok: info.cachedInputMicroUsdPerMtok,
            cacheWriteMicroUsdPerMtok: info.cacheWriteMicroUsdPerMtok,
            source: priced ? 'catalog' : 'catalog-unpriced',
            effectiveFrom: now,
          });
          changes.push({
            slug: info.slug,
            displayName: info.displayName,
            kind: 'added',
            detail: priced
              ? `New model from ${provider.name}.`
              : `New model from ${provider.name}, added disabled: it publishes no price. Set one in Admin → Models, then enable it.`,
          });
          continue;
        }

        const merged = applyOverride(incoming, overrideOf(current));
        const fieldsChanged = Object.entries(merged).filter(
          ([key, value]) => (current as Record<string, unknown>)[key] !== value,
        );

        const updates: Record<string, unknown> = Object.fromEntries(fieldsChanged);
        if (!current.isEnabled) {
          updates.isEnabled = true;
          changes.push({
            slug: info.slug,
            displayName: info.displayName,
            kind: 'reenabled',
            detail: 'The provider key can reach this model again.',
          });
        }

        if (Object.keys(updates).length > 0) {
          await db
            .update(models)
            .set({ ...updates, updatedAt: now })
            .where(eq(models.id, current.id));
          if (fieldsChanged.length > 0) {
            changes.push({
              slug: info.slug,
              displayName: info.displayName,
              kind: 'updated',
              detail: `Changed: ${fieldsChanged.map(([key]) => key).join(', ')}.`,
            });
          }
        }

        const currentPrice = (
          await db
            .select()
            .from(modelPrices)
            .where(and(eq(modelPrices.modelId, current.id), isNull(modelPrices.effectiveTo)))
            .limit(1)
        )[0];

        // Only a provider that actually quoted a tariff can move a price. A
        // silent catalogue must never zero out a working price sheet.
        const priceMoved =
          priced &&
          (!currentPrice ||
            currentPrice.inputMicroUsdPerMtok !== info.inputMicroUsdPerMtok ||
            currentPrice.outputMicroUsdPerMtok !== info.outputMicroUsdPerMtok ||
            currentPrice.cachedInputMicroUsdPerMtok !== info.cachedInputMicroUsdPerMtok ||
            currentPrice.cacheWriteMicroUsdPerMtok !== info.cacheWriteMicroUsdPerMtok);

        // An admin who pinned prices keeps them; the catalogue does not win.
        const pricePinned = 'prices' in overrideOf(current);

        if (priceMoved && !pricePinned) {
          if (currentPrice) {
            await db
              .update(modelPrices)
              .set({ effectiveTo: now })
              .where(eq(modelPrices.id, currentPrice.id));
          }
          await db.insert(modelPrices).values({
            id: newId(ID_PREFIX.modelPrice),
            modelId: current.id,
            inputMicroUsdPerMtok: info.inputMicroUsdPerMtok,
            outputMicroUsdPerMtok: info.outputMicroUsdPerMtok,
            cachedInputMicroUsdPerMtok: info.cachedInputMicroUsdPerMtok,
            cacheWriteMicroUsdPerMtok: info.cacheWriteMicroUsdPerMtok,
            source: 'catalog',
            effectiveFrom: now,
          });
          changes.push({
            slug: info.slug,
            displayName: info.displayName,
            kind: 'repriced',
            detail: currentPrice
              ? `Input ${currentPrice.inputMicroUsdPerMtok} → ${info.inputMicroUsdPerMtok}, output ${currentPrice.outputMicroUsdPerMtok} → ${info.outputMicroUsdPerMtok} micro-USD / Mtok.`
              : 'First price recorded.',
          });
        }
      }

      for (const model of existing) {
        if (seen.has(model.slug) || !model.isEnabled) continue;
        await db
          .update(models)
          .set({ isEnabled: false, updatedAt: now })
          .where(eq(models.id, model.id));
        changes.push({
          slug: model.slug,
          displayName: model.displayName,
          kind: 'disabled',
          detail: 'The provider key can no longer reach this model. History is kept.',
        });
      }

      await db
        .update(providers)
        .set({
          lastSyncedAt: now,
          lastSyncError: null,
          healthStatus: 'connected',
          updatedAt: now,
        })
        .where(eq(providers.id, provider.id));
    }

    setAudit({
      resourceId: 'catalog',
      summary: `Catalogue sync: ${changes.length} change${changes.length === 1 ? '' : 's'} across ${providerRows.length} provider${providerRows.length === 1 ? '' : 's'}`,
      metadata: { changes: changes.slice(0, 50), errors },
      severity: errors.length > 0 ? 'warning' : 'notice',
    });

    return json({
      ok: errors.length === 0,
      syncedProviders: providerRows.length,
      changes,
      errors,
      syncedAt: now.toISOString(),
    });
  },
);
