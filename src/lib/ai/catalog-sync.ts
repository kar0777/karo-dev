import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { getProviderByKey } from '@/lib/ai';
import { quotedAPrice, reportedFields } from '@/lib/ai/catalog-merge';
import { findDescriptor } from '@/lib/ai/providers/descriptors';
import { AnthropicMessagesProvider } from '@/lib/ai/providers/anthropic-messages';
import { OpenAiCompatibleProvider } from '@/lib/ai/providers/openai-compatible';
import type { ProviderModelInfo } from '@/lib/ai/types';
import { db } from '@/lib/db';
import { modelPrices, models, providers } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * Refresh the model catalogue from every enabled upstream provider.
 *
 * Shared by two callers with slightly different expectations:
 *   · `POST /api/admin/models/sync` — an admin pressed the button and wants
 *     feedback about every enabled provider, configured or not;
 *   · the nightly maintenance tick (`/api/cron/tick`) — which passes
 *     `onlyConfigured` so providers with no credentials are skipped instead of
 *     accumulating a "no catalogue" sync error every night.
 *
 * Rules that make this safe to run at any time:
 *  · a model the key can no longer reach is **disabled**, never deleted —
 *    usage events and conversations still point at it;
 *  · a price change opens a new `model_prices` row instead of editing history;
 *  · a model carrying an `adminOverride` keeps the pinned fields, so a manual
 *    correction is not silently reverted by the next sync;
 *  · **a value the provider did not report never overwrites one Karo has.**
 *
 * That last rule is the important one. `GET /models` is an availability probe:
 * on every provider Karo ships it returns model ids and nothing else — no
 * prices, and usually no context window. The adapter reports those unknowns as
 * `0`. Treating `0` as a *new value* meant one sync closed every current price
 * row and wrote a replacement priced at zero, so the whole catalogue became
 * free. Prices come from the seed or from an admin, and a sync must leave them
 * alone unless the provider genuinely quoted one.
 */

export type SyncChange = {
  slug: string;
  displayName: string;
  kind: 'added' | 'updated' | 'repriced' | 'disabled' | 'reenabled';
  detail: string;
};

export type SyncError = { provider: string; message: string };

export type CatalogSyncResult = {
  syncedProviders: number;
  changes: SyncChange[];
  errors: SyncError[];
  syncedAt: Date;
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

/** A caller-supplied credential for a provider the platform itself has no key for. */
export type ByokCredential = { apiKey: string; baseUrl?: string };

/**
 * A throwaway adapter carrying the caller's own key. Discovery is a platform
 * operation, but on installs where the operator's only keys are their own BYOK
 * entries, the platform has nothing to discover with — and "Sync from
 * provider" pressed by the one person who holds the keys should work.
 */
function adapterWithCredentials(
  key: string,
  credential: ByokCredential,
): ReturnType<typeof getProviderByKey> | null {
  const descriptor = findDescriptor(key);
  if (!descriptor) return null;
  const options = { apiKey: credential.apiKey, baseUrl: credential.baseUrl };
  return descriptor.protocol === 'anthropic-messages'
    ? new AnthropicMessagesProvider(descriptor, options)
    : new OpenAiCompatibleProvider(descriptor, options);
}

export async function syncProviderCatalogs(
  options: {
    onlyConfigured?: boolean;
    /** Per-provider keys from the calling admin, used only where the platform has none. */
    byokCredentials?: Map<string, ByokCredential>;
  } = {},
): Promise<CatalogSyncResult> {
  const providerRows = await db.select().from(providers).where(eq(providers.isEnabled, true));
  const changes: SyncChange[] = [];
  const errors: SyncError[] = [];
  const now = new Date();

  for (const provider of providerRows) {
    const platformAdapter = getProviderByKey(provider.key);
    const byok = options.byokCredentials?.get(provider.key);
    const adapter =
      !platformAdapter.isConfigured() && byok
        ? (adapterWithCredentials(provider.key, byok) ?? platformAdapter)
        : platformAdapter;

    // The nightly tick only reaches for providers that hold credentials, so a
    // dormant descriptor (no key anywhere yet) stays quiet until an operator
    // opts in by pressing Sync in the admin.
    if (options.onlyConfigured && !adapter.isConfigured()) continue;

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
      // Written to the row as well as to the caller. /admin/models re-renders
      // this provider as stale on every visit — with no reason on the row it
      // would go on telling an operator to press Sync, which is the one thing
      // that cannot help here.
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

  return { syncedProviders: providerRows.length, changes, errors, syncedAt: now };
}
