import { and, asc, eq, isNull } from 'drizzle-orm';

import { ModelsTable, type AdminModelRow } from '@/components/admin/models-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import { db } from '@/lib/db';
import { modelPrices, models, providers } from '@/lib/db/schema';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';
import { formatCompactNumber, formatRelativeTime } from '@/lib/utils';
import { requirePlatformAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

type ProviderSync = {
  key: string;
  name: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  isEnabled: boolean;
};

type SyncRow = {
  providerKey: string;
  providerName: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  isEnabled: boolean;
};

/**
 * Collapses the joined rows to one entry per provider and decides which of them
 * are stale. `lastSyncedAt` hangs off the provider, so every model row of a
 * provider repeats the same timestamp and the first one seen is the whole story.
 *
 * Nothing in Karo runs a sync on a timer, so the configured interval cannot mean
 * "every N minutes": it is the age past which a catalogue stops being
 * trustworthy and an operator has to press Sync. The clock is read here rather
 * than in the component body, which has to stay pure for the React Compiler, and
 * one reading serves every provider so they are all judged against the same
 * instant.
 *
 * Only enabled providers can be stale. `POST /api/admin/models/sync` filters to
 * `providers.is_enabled`, so a disabled provider whose models are still listed
 * below could never be refreshed however often Sync was pressed — calling it
 * stale would be a warning with no action behind it.
 */
function readSyncState(
  rows: readonly SyncRow[],
  freshForMinutes: number,
): {
  lastSync: Date | null;
  stale: ProviderSync[];
  syncableCount: number;
  disabledCount: number;
} {
  const byKey = new Map<string, ProviderSync>();
  for (const row of rows) {
    if (!byKey.has(row.providerKey)) {
      byKey.set(row.providerKey, {
        key: row.providerKey,
        name: row.providerName,
        lastSyncedAt: row.lastSyncedAt,
        lastSyncError: row.lastSyncError,
        isEnabled: row.isEnabled,
      });
    }
  }

  const providers = [...byKey.values()];
  const syncable = providers.filter((provider) => provider.isEnabled);
  const staleBefore = Date.now() - freshForMinutes * 60_000;
  const newestFirst = providers
    .map((provider) => provider.lastSyncedAt)
    .filter((value): value is Date => value !== null)
    .sort((a, b) => b.getTime() - a.getTime());

  return {
    lastSync: newestFirst[0] ?? null,
    stale: syncable.filter(
      (provider) =>
        provider.lastSyncedAt === null || provider.lastSyncedAt.getTime() < staleBefore,
    ),
    syncableCount: syncable.length,
    disabledCount: providers.length - syncable.length,
  };
}

/*
 * Authorisation lives here, not only in `app/admin/layout.tsx`.
 *
 * A layout is not a security boundary in the App Router. `notFound()` thrown
 * from the layout renders the 404 shell, but the page segment beside it has
 * already been invoked and its RSC flight payload is still streamed into the
 * response — so an anonymous `curl` of this route returned 200 with the real
 * data in the body while a browser politely painted "not found". Verified
 * against the production build: /admin/costs handed out platform revenue and
 * margins, /admin/usage every team by id and name, /admin/sandboxes the fleet.
 * Each page therefore proves the caller itself.
 */
export default async function AdminModelsPage() {
  await requirePlatformAdmin();

  const [rows, syncIntervalMinutes] = await Promise.all([
    db
      .select({
        model: models,
        providerKey: providers.key,
        providerName: providers.name,
        lastSyncedAt: providers.lastSyncedAt,
        lastSyncError: providers.lastSyncError,
        isEnabled: providers.isEnabled,
        price: modelPrices,
      })
      .from(models)
      .innerJoin(providers, eq(providers.id, models.providerId))
      .leftJoin(
        modelPrices,
        and(eq(modelPrices.modelId, models.id), isNull(modelPrices.effectiveTo)),
      )
      .orderBy(asc(models.sortOrder), asc(models.displayName)),
    getSetting<number>(
      SETTING_KEYS.catalogSyncIntervalMinutes,
      settingDefault(SETTING_KEYS.catalogSyncIntervalMinutes),
    ),
  ]);

  const catalogue: AdminModelRow[] = rows.map((row) => ({
    id: row.model.id,
    slug: row.model.slug,
    displayName: row.model.displayName,
    family: row.model.family,
    description: row.model.description,
    contextWindow: row.model.contextWindow,
    maxOutputTokens: row.model.maxOutputTokens,
    supportsTools: row.model.supportsTools,
    supportsVision: row.model.supportsVision,
    supportsCaching: row.model.supportsCaching,
    supportsStreaming: row.model.supportsStreaming,
    minPlanTier: row.model.minPlanTier,
    isEnabled: row.model.isEnabled,
    isDefault: row.model.isDefault,
    sortOrder: row.model.sortOrder,
    adminOverride: row.model.adminOverride ?? null,
    providerKey: row.providerKey,
    providerName: row.providerName,
    price: row.price
      ? {
          inputMicroUsdPerMtok: row.price.inputMicroUsdPerMtok,
          outputMicroUsdPerMtok: row.price.outputMicroUsdPerMtok,
          cachedInputMicroUsdPerMtok: row.price.cachedInputMicroUsdPerMtok,
          cacheWriteMicroUsdPerMtok: row.price.cacheWriteMicroUsdPerMtok,
          effectiveFrom: row.price.effectiveFrom.toISOString(),
        }
      : null,
  }));

  const enabled = catalogue.filter((model) => model.isEnabled);

  // A hand-edited zero or negative window would brand every provider stale for
  // ever, which reads as a broken page rather than as a setting.
  const freshForMinutes = Math.max(1, Math.round(syncIntervalMinutes));
  const { lastSync, stale, syncableCount, disabledCount } = readSyncState(
    rows,
    freshForMinutes,
  );
  const blocked = stale.filter((provider) => provider.lastSyncError !== null);

  const families = new Set(catalogue.map((model) => model.family));
  const unpriced = catalogue.filter((model) => model.price === null).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Models"
        description="The catalogue every conversation picks from. Prices are append-only — editing one closes the current price row and opens a new one, so historic usage stays auditable."
      />

      <StatGrid columns={4}>
        <Stat
          label="Enabled models"
          value={formatCompactNumber(enabled.length)}
          tone="primary"
          caption={`${catalogue.length} in the catalogue`}
        />
        <Stat label="Families" value={formatCompactNumber(families.size)} />
        <Stat
          label="Without a price"
          value={formatCompactNumber(unpriced)}
          tone={unpriced > 0 ? 'ember' : 'default'}
          caption={unpriced > 0 ? 'These bill at zero upstream cost' : 'Every model is priced'}
        />
        <Stat
          label="Last catalogue sync"
          value={lastSync ? formatRelativeTime(lastSync) : 'Never'}
          tone={stale.length > 0 ? 'ember' : 'default'}
          caption={
            stale.length > 0
              ? `${stale.length} of ${syncableCount} enabled provider${syncableCount === 1 ? '' : 's'} past the ${freshForMinutes}-minute freshness window`
              : lastSync
                ? lastSync.toISOString().slice(0, 10)
                : 'Run a sync to populate prices'
          }
        />
      </StatGrid>

      {stale.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>
            {stale.length === 1
              ? 'One provider catalogue is stale'
              : `${stale.length} provider catalogues are stale`}
          </AlertTitle>
          <AlertDescription>
            <p>
              A catalogue is only refreshed when someone runs a sync, so the prices and
              capabilities below are whatever the last one wrote. Anything older than{' '}
              <code className="font-mono text-[11px]">catalog.sync_interval_minutes</code> —
              currently {freshForMinutes} minutes — is counted stale.{' '}
              {blocked.length === 0
                ? 'Press “Sync from provider” to bring them up to date.'
                : blocked.length === stale.length
                  ? 'Every one of them failed its last attempt for the reason shown. “Sync from provider” retries them, but the timestamp only moves once that cause is addressed.'
                  : 'Press “Sync from provider” to bring them up to date. The ones carrying a reason below failed their last attempt, and a retry only helps once that cause is addressed.'}
            </p>
            <ul className="mt-1 list-disc pl-4">
              {stale.map((provider) => (
                <li key={provider.key}>
                  <span className="font-medium">{provider.name}</span>:{' '}
                  {provider.lastSyncedAt
                    ? `last synced ${formatRelativeTime(provider.lastSyncedAt)}`
                    : 'never synced'}
                  {provider.lastSyncError === null ? null : ` — ${provider.lastSyncError}`}
                </li>
              ))}
            </ul>
            {disabledCount > 0 ? (
              <p className="mt-1">
                {disabledCount} disabled provider{disabledCount === 1 ? '' : 's'} not counted
                here: a sync only visits enabled ones, so their models stay in the catalogue
                below at whatever the last sync left.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <ModelsTable models={catalogue} />
    </div>
  );
}
