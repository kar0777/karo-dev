export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { desc, eq } from 'drizzle-orm';

import {
  CUSTOM_PROVIDER_KEY,
  toApiKeyView,
  type ByokProviderOption,
} from '@/lib/account/api-keys';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { providers, userApiKeys } from '@/lib/db/schema';
import { can } from '@/lib/rbac/permissions';
import { loadBillingContext } from '@/lib/usage/metering';
import { ApiKeysView } from '@/components/settings/api-keys-view';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = {
  title: 'API keys',
  description: 'Run the agent on your own provider credentials.',
};

/** Providers a BYOK key can be attached to: the catalogue, minus the simulator. */
function toOptions(
  rows: Array<{ key: string; name: string; baseUrl: string | null }>,
): ByokProviderOption[] {
  const catalogue = rows
    .filter((row) => row.key !== 'mock')
    .map((row) => ({
      key: row.key,
      name: row.name,
      defaultBaseUrl: row.baseUrl,
      requiresBaseUrl: false,
      hint: `Used for every model Karo routes through ${row.name}.`,
    }));

  return [
    ...catalogue,
    {
      key: CUSTOM_PROVIDER_KEY,
      name: 'OpenAI-compatible endpoint',
      defaultBaseUrl: null,
      requiresBaseUrl: true,
      hint: 'Any server that speaks the OpenAI Chat Completions API — vLLM, Ollama behind a proxy, a private gateway.',
    },
  ];
}

export default async function ApiKeysPage() {
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);
  const billing = await loadBillingContext(team.id);

  const [keyRows, providerRows] = await Promise.all([
    db
      .select()
      .from(userApiKeys)
      .where(eq(userApiKeys.userId, user.id))
      .orderBy(desc(userApiKeys.createdAt)),
    db.select().from(providers).where(eq(providers.isEnabled, true)),
  ]);

  const names = new Map(providerRows.map((row) => [row.key, row.name]));

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="API keys"
        description="Bring your own provider key. Karo encrypts it at rest, uses it server-side only, and stops charging your included model credits for requests that run on it."
        breadcrumbs={[{ label: 'Karo', href: '/app' }, { label: 'API keys' }]}
      />

      <ApiKeysView
        keys={keyRows.map((row) => toApiKeyView(row, names.get(row.providerKey)))}
        providers={toOptions(providerRows)}
        allowByok={billing.plan.allowByok}
        canManage={can(role, 'apikey.manage')}
        planName={billing.plan.name}
      />
    </div>
  );
}
