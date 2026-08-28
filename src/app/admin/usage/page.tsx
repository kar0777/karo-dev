import { Activity, Siren } from 'lucide-react';

import { ChartFrame, ComputeChart, TokensChart } from '@/components/admin/charts';
import { PeriodPicker } from '@/components/admin/period-picker';
import { AdminPanel, Money } from '@/components/admin/primitives';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCompactNumber, formatHours, formatNumber } from '@/lib/utils';

import { resolvePeriod } from '../_data/period';
import { loadUsage, type UsageBreakdownRow } from '../_data/usage';
import { requirePlatformAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

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
export default async function AdminUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const period = resolvePeriod(params.days);
  const data = await loadUsage(period);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Usage"
        description={`Platform-wide consumption over the last ${period.days} days, broken down by model, provider and plan tier.`}
        actions={<PeriodPicker value={period.days} />}
      />

      <StatGrid columns={4}>
        <Stat
          label="Weighted tokens"
          value={formatCompactNumber(data.totals.weightedTokens)}
          tone="primary"
          caption={`${formatNumber(data.totals.calls)} model calls`}
        />
        <Stat
          label="Compute hours"
          value={formatHours(data.totals.computeHours)}
          tone="ember"
        />
        <Stat label="Charged" value={<Money microUsd={data.totals.chargedMicroUsd} />} />
        <Stat
          label="Upstream cost"
          value={<Money microUsd={data.totals.upstreamMicroUsd} />}
          tone="ember"
          caption="What the platform paid to serve it"
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Weighted tokens per day"
          description="The unit every plan quota is denominated in."
        >
          <TokensChart data={data.daily} />
        </ChartFrame>
        <ChartFrame
          title="Compute hours per day"
          description="One base hour = 0.25 vCPU + 512 MB RAM, times the size and provider multipliers."
        >
          <ComputeChart data={data.daily} />
        </ChartFrame>
      </div>

      <AdminPanel
        title={
          <span className="flex items-center gap-2">
            <Siren className="size-4 text-warning" aria-hidden="true" />
            Unusual usage
          </span>
        }
        description="Each team is compared against its own trailing median over this window, never against other teams — a heavy user is not an anomaly, a sudden change in a user is. A flag needs both a 3× jump and a meaningful absolute value."
      >
        {data.flags.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Activity}
            title="Nothing looks unusual"
            description="No team's most recent day is far outside its own baseline for runs, compute or spend."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead className="text-right">Latest</TableHead>
                <TableHead className="text-right">Median</TableHead>
                <TableHead className="text-right">Ratio</TableHead>
                <TableHead className="hidden md:table-cell">Why it was flagged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.flags.map((flag) => (
                <TableRow key={`${flag.teamId}-${flag.metric}`}>
                  <TableCell className="max-w-[12rem] truncate font-medium text-fg">
                    {flag.teamName}
                  </TableCell>
                  <TableCell>
                    <Badge variant="warning" size="sm">
                      {flag.metricLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="karo-numeric text-right">
                    {formatNumber(flag.latest, 2)}
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    {formatNumber(flag.median, 2)}
                  </TableCell>
                  <TableCell className="karo-numeric text-right font-medium text-warning">
                    {flag.ratio > 0 ? `${flag.ratio.toFixed(1)}×` : 'new'}
                  </TableCell>
                  <TableCell className="hidden max-w-[24rem] text-[12px] text-muted md:table-cell">
                    {flag.reason}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminPanel>

      <div className="grid gap-4 xl:grid-cols-2">
        <BreakdownTable
          title="By model"
          description="Weighted tokens and margin per model over the window."
          rows={data.byModel}
        />
        <BreakdownTable
          title="By provider"
          description="Which upstream actually served the traffic."
          rows={data.byProvider}
        />
      </div>

      <BreakdownTable
        title="By plan tier"
        description="Consumption rolled up by the plan each team is on. The count column is teams, not calls."
        rows={data.byPlanTier}
        countLabel="Teams"
      />

      <AdminPanel
        title="Top teams by consumption"
        description="Sorted by weighted tokens. Charged is what the team paid; upstream is what it cost Karo."
      >
        {data.topTeams.length === 0 ? (
          <EmptyState
            size="sm"
            title="No usage in this window"
            description="Nothing was metered in the selected period. Widen the window or check that runs are completing."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="hidden sm:table-cell">Plan</TableHead>
                <TableHead className="text-right">Weighted tokens</TableHead>
                <TableHead className="text-right">Compute</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead className="text-right">Upstream</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.topTeams.map((team) => (
                <TableRow key={team.teamId}>
                  <TableCell className="max-w-[16rem]">
                    <span className="block truncate font-medium text-fg">{team.teamName}</span>
                    <span className="block truncate text-[11px] text-subtle">
                      {team.teamSlug}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted sm:table-cell">
                    {team.planName}
                  </TableCell>
                  <TableCell className="karo-numeric text-right">
                    {formatCompactNumber(team.weightedTokens)}
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    {formatHours(team.computeHours)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={team.chargedMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right text-muted">
                    <Money microUsd={team.upstreamMicroUsd} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminPanel>
    </div>
  );
}

function BreakdownTable({
  title,
  description,
  rows,
  countLabel = 'Calls',
}: {
  title: string;
  description: string;
  rows: UsageBreakdownRow[];
  countLabel?: string;
}) {
  return (
    <AdminPanel title={title} description={description}>
      {rows.length === 0 ? (
        <EmptyState
          size="sm"
          title="Nothing recorded"
          description="No usage matched this dimension in the selected window."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Weighted tokens</TableHead>
              <TableHead className="text-right">{countLabel}</TableHead>
              <TableHead className="text-right">Charged</TableHead>
              <TableHead className="text-right">Upstream</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-[14rem]">
                  <span className="block truncate text-fg">{row.label}</span>
                  {row.sublabel ? (
                    <span className="block truncate font-mono text-[11px] text-subtle">
                      {row.sublabel}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="karo-numeric text-right">
                  {formatCompactNumber(row.weightedTokens)}
                </TableCell>
                <TableCell className="karo-numeric text-right text-muted">
                  {formatNumber(row.calls)}
                </TableCell>
                <TableCell className="text-right">
                  <Money microUsd={row.chargedMicroUsd} />
                </TableCell>
                <TableCell className="text-right text-muted">
                  <Money microUsd={row.upstreamMicroUsd} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AdminPanel>
  );
}
