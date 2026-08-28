import { asc, sql } from 'drizzle-orm';

import { ProvidersPanel, type AdminProviderRow } from '@/components/admin/providers-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getProviderByKey, PROVIDER_DESCRIPTORS } from '@/lib/ai';
import { db } from '@/lib/db';
import { models, providers } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { requirePlatformAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/**
 * Which environment variable supplies each provider's credential.
 *
 * Derived from the descriptor registry rather than restated, so adding a
 * provider cannot leave this page naming a variable that nothing reads.
 */
const CREDENTIAL_SOURCE: Record<string, string> = {
  mock: 'none required',
  ...Object.fromEntries(
    PROVIDER_DESCRIPTORS.map((d) => [
      d.key,
      d.apiKeyEnv ?? `${d.baseUrlEnv} (local server, no key)`,
    ]),
  ),
};

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
export default async function AdminProvidersPage() {
  await requirePlatformAdmin();

  const rows = await db
    .select({
      provider: providers,
      modelCount: sql<string>`(select count(*) from ${models} where ${models.providerId} = ${providers.id})`,
    })
    .from(providers)
    .orderBy(asc(providers.name));

  const list: AdminProviderRow[] = rows.map(({ provider, modelCount }) => ({
    id: provider.id,
    key: provider.key,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    catalogUrl: provider.catalogUrl,
    isEnabled: provider.isEnabled,
    isDefault: provider.isDefault,
    computeMultiplier: provider.computeMultiplier,
    healthStatus: provider.healthStatus,
    lastSyncedAt: provider.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: provider.lastSyncError,
    modelCount: Number(modelCount) || 0,
    credentialConfigured: getProviderByKey(provider.key).isConfigured(),
    credentialSource:
      CREDENTIAL_SOURCE[provider.key] ?? `${provider.key.toUpperCase()}_API_KEY`,
    summary: PROVIDER_DESCRIPTORS.find((d) => d.key === provider.key)?.summary,
    signupUrl: PROVIDER_DESCRIPTORS.find((d) => d.key === provider.key)?.signupUrl ?? null,
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Providers"
        description="Upstream model connections. Credentials live in the environment and are never stored in the database or shown here — only whether one is configured."
      />

      {env.DEMO_MODE ? (
        <Alert variant="info">
          <AlertTitle>Demo mode is on</AlertTitle>
          <AlertDescription>
            Model traffic is served by the simulator regardless of what is configured below. Set
            a provider credential — <code className="font-mono text-[11px]">WANDB_API_KEY</code>{' '}
            is the cheapest to start with — and restart the server to talk to a real provider.
          </AlertDescription>
        </Alert>
      ) : null}

      {list.length === 0 ? (
        <EmptyState
          title="No providers configured"
          description="Karo needs at least one provider row to resolve models. Run `npm run db:seed` to create the default wandb, omniakey and mock providers."
        />
      ) : (
        <ProvidersPanel providers={list} />
      )}
    </div>
  );
}
