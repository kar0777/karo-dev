import type { UserApiKey } from '@/lib/db/schema';

/**
 * BYOK presentation.
 *
 * The one rule this file exists to enforce: **`keyCiphertext` never leaves the
 * server**. Everything the browser is allowed to know about a key goes through
 * `toApiKeyView`, so there is a single place to audit.
 */

/** Provider key used for "any OpenAI-compatible endpoint", which needs a base URL. */
export const CUSTOM_PROVIDER_KEY = 'openai-compatible';

export type ApiKeyVerification = 'unverified' | 'verified' | 'failed';

export type ApiKeyView = {
  id: string;
  label: string;
  providerKey: string;
  providerName: string;
  baseUrl: string | null;
  /** Display only — `••••1234`. */
  maskedKey: string;
  keyLast4: string;
  isActive: boolean;
  verification: ApiKeyVerification;
  lastVerifiedAt: string | null;
  lastVerifyError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export function verificationOf(row: UserApiKey): ApiKeyVerification {
  if (row.lastVerifyError) return 'failed';
  return row.lastVerifiedAt ? 'verified' : 'unverified';
}

export function toApiKeyView(row: UserApiKey, providerName?: string): ApiKeyView {
  return {
    id: row.id,
    label: row.label,
    providerKey: row.providerKey,
    providerName: providerName ?? defaultProviderName(row.providerKey),
    baseUrl: row.baseUrl,
    maskedKey: `••••${row.keyLast4}`,
    keyLast4: row.keyLast4,
    isActive: row.isActive,
    verification: verificationOf(row),
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    lastVerifyError: row.lastVerifyError,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Fallback label when the provider row was removed from the catalogue. */
export function defaultProviderName(providerKey: string): string {
  if (providerKey === CUSTOM_PROVIDER_KEY) return 'OpenAI-compatible endpoint';
  return providerKey.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type ByokProviderOption = {
  key: string;
  name: string;
  /** Pre-filled into the base URL field; blank when the provider has no default. */
  defaultBaseUrl: string | null;
  requiresBaseUrl: boolean;
  hint: string;
};
