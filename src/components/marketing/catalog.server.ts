import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { db, modelPrices, models, plans } from '@/lib/db';
import { DEFAULT_MODEL_SLUG, MODEL_PRICE_SEEDS, MODEL_SEEDS } from '@/lib/db/seed-data/models';
import { PLAN_SEEDS, type PlanSeed } from '@/lib/db/seed-data/plans';

import type { CatalogSource, ModelPriceView, PlanTier, PlanView } from './plan-view';

/**
 * Catalogue reads for the public marketing pages.
 *
 * The landing page and the pricing page are the two surfaces a stranger sees
 * first, so neither is allowed to 500 because Postgres is unreachable. Both
 * loaders catch, fall back to the same seed data the database is populated
 * from, and report which source was used so the page can say so honestly
 * instead of silently showing stale numbers.
 */

export type PlanCatalog = {
  plans: PlanView[];
  source: CatalogSource;
};

export type ModelCatalog = {
  models: ModelPriceView[];
  source: CatalogSource;
};

/** A `plans` row already has every column; only the shape needs narrowing. */
function rowToPlanView(row: typeof plans.$inferSelect): PlanView {
  return {
    key: row.key,
    tier: row.tier,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    priceMicroUsdMonthly: row.priceMicroUsdMonthly,
    priceMicroUsdYearly: row.priceMicroUsdYearly,
    includedWeightedTokens: row.includedWeightedTokens,
    includedComputeHours: row.includedComputeHours,
    maxActiveSandboxes: row.maxActiveSandboxes,
    maxSandboxMemoryMb: row.maxSandboxMemoryMb,
    maxSandboxCpuCores: row.maxSandboxCpuCores,
    storageGb: row.storageGb,
    maxTeamMembers: row.maxTeamMembers,
    maxProjects: row.maxProjects,
    maxSkills: row.maxSkills,
    maxPlugins: row.maxPlugins,
    maxMcpServers: row.maxMcpServers,
    maxConcurrentRuns: row.maxConcurrentRuns,
    queuePriority: row.queuePriority,
    auditRetentionDays: row.auditRetentionDays,
    autoSleepMinutes: row.autoSleepMinutes,
    autoDestroyHours: row.autoDestroyHours,
    allowByok: row.allowByok,
    allowDocker: row.allowDocker,
    allowOwnServer: row.allowOwnServer,
    allowExternalSandbox: row.allowExternalSandbox,
    allowCustomSandboxSize: row.allowCustomSandboxSize,
    allowPreviewDeployments: row.allowPreviewDeployments,
    allowPrivateSkills: row.allowPrivateSkills,
    allowApiAccess: row.allowApiAccess,
    allowSso: row.allowSso,
    allowDedicatedWorker: row.allowDedicatedWorker,
    allowCustomModelRouting: row.allowCustomModelRouting,
    allowedShells: [...row.allowedShells],
    supportLevel: row.supportLevel,
    marginBps: row.marginBps,
    overageMicroUsdPerMWeighted: row.overageMicroUsdPerMWeighted,
    overageMicroUsdPerComputeHour: row.overageMicroUsdPerComputeHour,
    trialDays: row.trialDays,
    highlight: row.highlight,
    features: [...row.features],
    sortOrder: row.sortOrder,
  };
}

/**
 * Seeds are typed as *inserts*, so every column with a schema default is
 * optional on the type even though the literals fill them all in. The defaults
 * below mirror `plans` in `@/lib/db/schema` exactly.
 */
function seedToPlanView(seed: PlanSeed): PlanView {
  return {
    key: seed.key,
    tier: seed.tier,
    name: seed.name,
    tagline: seed.tagline ?? '',
    description: seed.description ?? '',
    priceMicroUsdMonthly: seed.priceMicroUsdMonthly ?? 0,
    priceMicroUsdYearly: seed.priceMicroUsdYearly ?? 0,
    includedWeightedTokens: seed.includedWeightedTokens ?? 0,
    includedComputeHours: seed.includedComputeHours ?? 0,
    maxActiveSandboxes: seed.maxActiveSandboxes ?? 1,
    maxSandboxMemoryMb: seed.maxSandboxMemoryMb ?? 512,
    maxSandboxCpuCores: seed.maxSandboxCpuCores ?? 0.25,
    storageGb: seed.storageGb ?? 5,
    maxTeamMembers: seed.maxTeamMembers ?? 1,
    maxProjects: seed.maxProjects ?? 10,
    maxSkills: seed.maxSkills ?? 5,
    maxPlugins: seed.maxPlugins ?? 5,
    maxMcpServers: seed.maxMcpServers ?? 3,
    maxConcurrentRuns: seed.maxConcurrentRuns ?? 1,
    queuePriority: seed.queuePriority ?? 0,
    auditRetentionDays: seed.auditRetentionDays ?? 7,
    autoSleepMinutes: seed.autoSleepMinutes ?? 15,
    autoDestroyHours: seed.autoDestroyHours ?? 72,
    allowByok: seed.allowByok ?? false,
    allowDocker: seed.allowDocker ?? false,
    allowOwnServer: seed.allowOwnServer ?? true,
    allowExternalSandbox: seed.allowExternalSandbox ?? false,
    allowCustomSandboxSize: seed.allowCustomSandboxSize ?? false,
    allowPreviewDeployments: seed.allowPreviewDeployments ?? false,
    allowPrivateSkills: seed.allowPrivateSkills ?? false,
    allowApiAccess: seed.allowApiAccess ?? false,
    allowSso: seed.allowSso ?? false,
    allowDedicatedWorker: seed.allowDedicatedWorker ?? false,
    allowCustomModelRouting: seed.allowCustomModelRouting ?? false,
    allowedShells: [...(seed.allowedShells ?? ['bash'])],
    supportLevel: seed.supportLevel ?? 'community',
    marginBps: seed.marginBps ?? 2000,
    overageMicroUsdPerMWeighted: seed.overageMicroUsdPerMWeighted ?? 0,
    overageMicroUsdPerComputeHour: seed.overageMicroUsdPerComputeHour ?? 0,
    trialDays: seed.trialDays ?? 0,
    highlight: seed.highlight ?? false,
    features: [...(seed.features ?? [])],
    sortOrder: seed.sortOrder ?? 100,
  };
}

function fallbackPlans(): PlanView[] {
  return PLAN_SEEDS.filter((seed) => (seed.isPublic ?? true) && (seed.isActive ?? true))
    .map(seedToPlanView)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Public, active plans in display order. Pages calling this must be
 * `force-dynamic` — the catalogue is admin-editable at runtime.
 */
export async function loadPublicPlans(): Promise<PlanCatalog> {
  try {
    const rows = await db
      .select()
      .from(plans)
      .where(and(eq(plans.isPublic, true), eq(plans.isActive, true)))
      .orderBy(asc(plans.sortOrder));

    if (rows.length === 0) return { plans: fallbackPlans(), source: 'fallback' };
    return { plans: rows.map(rowToPlanView), source: 'database' };
  } catch {
    // A marketing page must render for a stranger even with the DB down.
    return { plans: fallbackPlans(), source: 'fallback' };
  }
}

function fallbackModels(): ModelPriceView[] {
  return MODEL_SEEDS.filter((seed) => seed.isEnabled ?? true)
    .map((seed) => {
      const price = MODEL_PRICE_SEEDS[seed.slug];
      return {
        slug: seed.slug,
        displayName: seed.displayName,
        family: seed.family ?? 'other',
        description: seed.description ?? '',
        contextWindow: seed.contextWindow ?? 128_000,
        maxOutputTokens: seed.maxOutputTokens ?? 8_192,
        minPlanTier: (seed.minPlanTier ?? 'payg') as PlanTier,
        inputMicroUsdPerMtok: price?.inputMicroUsdPerMtok ?? 0,
        outputMicroUsdPerMtok: price?.outputMicroUsdPerMtok ?? 0,
        cachedInputMicroUsdPerMtok: price?.cachedInputMicroUsdPerMtok ?? 0,
        cacheWriteMicroUsdPerMtok: price?.cacheWriteMicroUsdPerMtok ?? 0,
      };
    })
    .sort((a, b) => b.inputMicroUsdPerMtok - a.inputMicroUsdPerMtok);
}

/**
 * Enabled models joined to their **currently effective** price row
 * (`effective_to IS NULL`). Prices drive the weighted-token multipliers, so the
 * pricing page must never invent them.
 */
export async function loadPublicModels(): Promise<ModelCatalog> {
  try {
    const rows = await db
      .select({
        slug: models.slug,
        displayName: models.displayName,
        family: models.family,
        description: models.description,
        contextWindow: models.contextWindow,
        maxOutputTokens: models.maxOutputTokens,
        minPlanTier: models.minPlanTier,
        inputMicroUsdPerMtok: modelPrices.inputMicroUsdPerMtok,
        outputMicroUsdPerMtok: modelPrices.outputMicroUsdPerMtok,
        cachedInputMicroUsdPerMtok: modelPrices.cachedInputMicroUsdPerMtok,
        cacheWriteMicroUsdPerMtok: modelPrices.cacheWriteMicroUsdPerMtok,
        sortOrder: models.sortOrder,
      })
      .from(models)
      .innerJoin(modelPrices, eq(modelPrices.modelId, models.id))
      .where(and(eq(models.isEnabled, true), isNull(modelPrices.effectiveTo)))
      .orderBy(asc(models.sortOrder));

    if (rows.length === 0) return { models: fallbackModels(), source: 'fallback' };

    return {
      models: rows.map(({ sortOrder: _sortOrder, ...row }) => row),
      source: 'database',
    };
  } catch {
    return { models: fallbackModels(), source: 'fallback' };
  }
}

/**
 * The model the cost estimator prices against.
 *
 * It must be the model a new user would actually get, or the landing page quotes
 * a price the product never charges. So this follows `DEFAULT_MODEL_SLUG` rather
 * than naming a model inline — the previous hard-coded slug silently became a
 * different model than the product's default when the catalogue changed.
 *
 * A zero-priced row (the demo model, or a free-tier model) would make every
 * estimate read `$0.00`, so those are skipped in favour of the first row with a
 * real input price.
 */
export function defaultPricingModel(
  catalog: readonly ModelPriceView[],
): ModelPriceView | undefined {
  return (
    catalog.find(
      (model) => model.slug === DEFAULT_MODEL_SLUG && model.inputMicroUsdPerMtok > 0,
    ) ?? catalog.find((model) => model.inputMicroUsdPerMtok > 0)
  );
}
