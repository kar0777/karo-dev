import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import { models, modelPrices, providers, userApiKeys } from '@/lib/db/schema';
import { decryptSecret } from '@/lib/crypto/secrets';
import { env } from '@/lib/env';
import type { TokenPrices } from '@/lib/pricing/weighted-tokens';
import {
  AUTO_PROVIDER_ORDER,
  findDescriptor,
  MOCK_PROVIDER_KEY,
  PROVIDER_DESCRIPTORS,
} from './providers/descriptors';
import { MockProvider } from './providers/mock';
import { AnthropicMessagesProvider } from './providers/anthropic-messages';
import { OpenAiCompatibleProvider } from './providers/openai-compatible';
import { ProviderError, type ModelProvider } from './types';

const mockProvider = new MockProvider();

/** Adapters are stateless but hold a memoised descriptor; one each is enough. */
const adapters = new Map<string, ModelProvider>();

/**
 * Resolves a provider adapter by its stable key.
 *
 * An unknown key is not an error: it is the BYOK case, where a user has pointed
 * Karo at an OpenAI-compatible endpoint the catalogue has never seen. Those
 * requests carry their own `apiKey`/`baseUrl`, so the generic adapter serves
 * them with the descriptor acting only as a label.
 */
export function getProviderByKey(key: string): ModelProvider {
  if (key === MOCK_PROVIDER_KEY) return mockProvider;

  const existing = adapters.get(key);
  if (existing) return existing;

  const descriptor = findDescriptor(key) ?? {
    key,
    displayName: key,
    apiKeyEnv: null,
    baseUrlEnv: `${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_BASE_URL`,
    defaultBaseUrl: 'https://api.openai.com/v1',
    autoPriority: 999,
    signupUrl: null,
    docsUrl: '',
    catalogUrl: null,
    summary: 'Custom OpenAI-compatible endpoint supplied with a user key.',
  };

  const adapter =
    descriptor.protocol === 'anthropic-messages'
      ? new AnthropicMessagesProvider(descriptor)
      : new OpenAiCompatibleProvider(descriptor);
  adapters.set(key, adapter);
  return adapter;
}

/** True when this provider has usable platform credentials right now. */
export function providerIsConfigured(key: string): boolean {
  if (key === MOCK_PROVIDER_KEY) return true;
  return getProviderByKey(key).isConfigured();
}

/**
 * Platform-credentialed providers, best value first.
 *
 * Used by `AI_PROVIDER=auto`, by the default-model resolver below, and by
 * Admin → Providers to explain what is actually reachable.
 */
export function configuredProviderKeys(): string[] {
  return AUTO_PROVIDER_ORDER.filter((key) => providerIsConfigured(key));
}

export type ResolvedModel = {
  modelId: string;
  modelSlug: string;
  displayName: string;
  providerKey: string;
  provider: ModelProvider;
  prices: TokenPrices;
  priceId: string | null;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  /** Set when the request runs on the user's own key. */
  byok: { apiKey: string; baseUrl?: string; keyId: string } | null;
  /**
   * True when the simulator answered instead of a provider. Such a run carries a
   * zeroed price sheet so it cannot charge the team for output no provider
   * produced; callers can also use it to label the reply in the UI.
   */
  simulated?: boolean;
};

/**
 * The price sheet applied whenever the simulator answers. Zero across the board:
 * a scripted reply costs Karo nothing upstream, so it must cost the customer
 * nothing either.
 */
const FREE_PRICES: TokenPrices = {
  inputMicroUsdPerMtok: 0,
  outputMicroUsdPerMtok: 0,
  cachedInputMicroUsdPerMtok: 0,
  cacheWriteMicroUsdPerMtok: 0,
};

/**
 * Picks the concrete model + credentials for a run.
 *
 * Precedence:
 *   1. Demo mode (or a model on the `mock` provider) → the simulator.
 *   2. An active BYOK key belonging to the user for this model's provider.
 *   3. Karo's own platform credentials for that provider.
 *   4. Nothing configured → the simulator, with the demo badge shown.
 */
export async function resolveModel(options: {
  modelId?: string | null;
  userId: string;
  preferByok?: boolean;
}): Promise<ResolvedModel> {
  const record = options.modelId ? await loadModel(options.modelId) : await loadDefaultModel();

  if (!record) throw new Error('No models are configured. Run `npm run db:seed`.');

  const prices: TokenPrices = {
    inputMicroUsdPerMtok: record.price?.inputMicroUsdPerMtok ?? 0,
    outputMicroUsdPerMtok: record.price?.outputMicroUsdPerMtok ?? 0,
    cachedInputMicroUsdPerMtok: record.price?.cachedInputMicroUsdPerMtok ?? 0,
    cacheWriteMicroUsdPerMtok: record.price?.cacheWriteMicroUsdPerMtok ?? 0,
  };

  const base = {
    modelId: record.model.id,
    modelSlug: record.model.slug,
    displayName: record.model.displayName,
    prices,
    priceId: record.price?.id ?? null,
    contextWindow: record.model.contextWindow,
    maxOutputTokens: record.model.maxOutputTokens,
    supportsTools: record.model.supportsTools,
    supportsVision: record.model.supportsVision,
  };

  // Demo mode: everything runs on the simulator, whatever model was picked. The
  // price sheet is zeroed for the same reason as the degrade path below — a
  // scripted reply must not debit a real balance.
  if (env.DEMO_MODE || record.provider.key === MOCK_PROVIDER_KEY) {
    return {
      ...base,
      providerKey: MOCK_PROVIDER_KEY,
      provider: mockProvider,
      prices: FREE_PRICES,
      priceId: null,
      byok: null,
      simulated: true,
    };
  }

  if (options.preferByok !== false) {
    const byok = await loadByokKey(options.userId, record.provider.key);
    if (byok) {
      return {
        ...base,
        providerKey: record.provider.key,
        provider: getProviderByKey(record.provider.key),
        byok,
      };
    }
  }

  const provider = getProviderByKey(record.provider.key);
  if (!provider.isConfigured()) {
    // This model's provider has no credentials. What to do next depends on
    // whether *anything* is configured, and the difference matters for money.
    //
    // Nothing configured at all → the whole install is running on the simulator,
    // so simulate, but with a **zeroed price sheet**. Keeping the real model's
    // prices here charged the team real money — and debited its balance — for
    // scripted output that never reached a provider.
    if (env.AI_PROVIDER === MOCK_PROVIDER_KEY) {
      return {
        ...base,
        providerKey: MOCK_PROVIDER_KEY,
        provider: mockProvider,
        prices: FREE_PRICES,
        priceId: null,
        byok: null,
        simulated: true,
      };
    }

    // Some other provider *is* configured, so this is a specific model that
    // cannot answer — typically a conversation pinned to a model whose provider
    // key was later removed. Fail loudly. Simulating here would attribute
    // fabricated output to a named model the user deliberately chose, which is
    // worse than an error they can act on, and the model picker no longer offers
    // unreachable models in the first place.
    throw new ProviderError(
      'bad_request',
      `${record.provider.name} is not configured, so ${record.model.displayName} cannot answer. Pick another model for this conversation.`,
      { status: 409 },
    );
  }

  return { ...base, providerKey: record.provider.key, provider, byok: null };
}

async function loadModel(modelId: string) {
  const rows = await db
    .select({ model: models, provider: providers })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(eq(models.id, modelId), eq(models.isEnabled, true)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, price: await loadCurrentPrice(row.model.id) };
}

/**
 * The default model when a conversation names none.
 *
 * Catalogue order (`isDefault`, then `sortOrder`) decides *preference*, but a
 * model whose provider has no credentials cannot actually answer — it silently
 * degrades the run to the simulator. So a configured provider wins over an
 * unconfigured one, and catalogue order only breaks ties within that.
 *
 * Without this, seeding a catalogue whose default sits on provider A while the
 * operator has credentials for provider B means every run is simulated with no
 * explanation beyond a demo badge — the exact failure this ordering prevents.
 */
async function loadDefaultModel() {
  const rows = await db
    .select({ model: models, provider: providers })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(and(eq(models.isEnabled, true), eq(providers.isEnabled, true)))
    .orderBy(desc(models.isDefault), models.sortOrder);

  // Tens of rows at most, so filtering here beats encoding the credential state
  // into SQL — the credential lives in the environment, not the database.
  const preferred = rows.find((row) => providerIsConfigured(row.provider.key)) ?? rows.at(0);
  if (!preferred) return null;

  return { ...preferred, price: await loadCurrentPrice(preferred.model.id) };
}

/** The open-ended price row is the current one; historic rows keep audits valid. */
export async function loadCurrentPrice(modelId: string) {
  const rows = await db
    .select()
    .from(modelPrices)
    .where(and(eq(modelPrices.modelId, modelId), isNull(modelPrices.effectiveTo)))
    .orderBy(desc(modelPrices.effectiveFrom))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadPricesFor(modelId: string): Promise<TokenPrices> {
  const price = await loadCurrentPrice(modelId);
  return {
    inputMicroUsdPerMtok: price?.inputMicroUsdPerMtok ?? 0,
    outputMicroUsdPerMtok: price?.outputMicroUsdPerMtok ?? 0,
    cachedInputMicroUsdPerMtok: price?.cachedInputMicroUsdPerMtok ?? 0,
    cacheWriteMicroUsdPerMtok: price?.cacheWriteMicroUsdPerMtok ?? 0,
  };
}

async function loadByokKey(
  userId: string,
  providerKey: string,
): Promise<{ apiKey: string; baseUrl?: string; keyId: string } | null> {
  const rows = await db
    .select()
    .from(userApiKeys)
    .where(
      and(
        eq(userApiKeys.userId, userId),
        eq(userApiKeys.providerKey, providerKey),
        eq(userApiKeys.isActive, true),
      ),
    )
    .orderBy(desc(userApiKeys.lastUsedAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  try {
    return {
      apiKey: decryptSecret(row.keyCiphertext),
      baseUrl: row.baseUrl ?? undefined,
      keyId: row.id,
    };
  } catch {
    // A key encrypted under a rotated ENCRYPTION_KEY is unusable; fall back to
    // platform credentials rather than failing the run.
    return null;
  }
}

export {
  MockProvider,
  AnthropicMessagesProvider,
  OpenAiCompatibleProvider,
  PROVIDER_DESCRIPTORS,
};
export * from './types';
