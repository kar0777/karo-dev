import { SandboxesTable } from '@/components/admin/sandboxes-table';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import { formatBytes, formatHours, formatMicroUsd, formatNumber } from '@/lib/utils';

import { loadSandboxFleet, loadSandboxStats, sandboxProviderKeys } from '../_data/sandboxes';
import { requirePlatformAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
export default async function AdminSandboxesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const status = firstParam(params.status) ?? 'live';
  const provider = firstParam(params.provider) ?? 'all';

  const [fleet, stats, providers] = await Promise.all([
    loadSandboxFleet({ status, provider }),
    loadSandboxStats(),
    sandboxProviderKeys(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sandboxes"
        description="Every machine on the platform. Force-stop and force-destroy always bring the row to a terminal state, even when the provider does not answer, so nobody keeps being billed for a machine Karo cannot reach."
      />

      <StatGrid columns={4}>
        <Stat
          label="Running now"
          value={formatNumber(stats.running)}
          tone="primary"
          caption={`${stats.sleeping} asleep · ${stats.failed} failed`}
        />
        <Stat
          label="RAM committed"
          value={formatBytes(stats.totalMemoryMb * 1024 * 1024, 1)}
          tone="ember"
          caption={`${stats.totalCpuCores.toFixed(2)} vCPU across running machines`}
        />
        <Stat
          label="Compute today"
          value={formatHours(stats.computeHoursToday)}
          caption="Billed compute hours since midnight UTC"
        />
        <Stat
          label="Charged today"
          value={formatMicroUsd(stats.chargedTodayMicroUsd)}
          tone="ember"
          caption="Compute charges settled today"
        />
      </StatGrid>

      <SandboxesTable sandboxes={fleet} providers={providers} filters={{ status, provider }} />
    </div>
  );
}
