import Link from 'next/link';

import { ArrowUpRight, ShieldAlert, TrendingDown } from 'lucide-react';

import { ChartFrame, GrowthChart, RunsChart } from '@/components/admin/charts';
import { QuickActions } from '@/components/admin/quick-actions';
import { PeriodPicker } from '@/components/admin/period-picker';
import {
  AdminPanel,
  MiniStat,
  Money,
  PlanBadge,
  SignedMoney,
} from '@/components/admin/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { formatCompactNumber, formatDate, formatHours, formatPercent } from '@/lib/utils';

import { deltaPercent, STRIPE_PERCENT_BPS } from './_data/finance';
import { loadOverview } from './_data/overview';
import { resolvePeriod } from './_data/period';
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
export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const period = resolvePeriod(params.days);
  const data = await loadOverview(period);

  const marginDelta = deltaPercent(
    data.margin.grossMarginMicroUsd,
    data.previousMargin.grossMarginMicroUsd,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Platform overview"
        description={`Revenue, cost and growth for the last ${period.days} days. Money is recognised revenue — subscriptions prorated over the window plus metered charges — not cash collected.`}
        actions={<PeriodPicker value={period.days} />}
      />

      <QuickActions />

      {data.openIncidents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3">
          <ShieldAlert className="size-4 shrink-0 text-danger" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[13px] text-danger-soft-fg">
            {data.openIncidents.length} open{' '}
            {data.openIncidents.length === 1 ? 'incident' : 'incidents'} —{' '}
            {data.openIncidents[0]?.title}
          </p>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/admin/incidents">Open incidents</Link>
          </Button>
        </div>
      ) : null}

      <StatGrid columns={4}>
        <Stat
          label="MRR"
          value={<Money microUsd={data.mrrMicroUsd} />}
          tone="primary"
          caption={`${data.activeSubscriptions} active · ${data.trialingSubscriptions} trialing`}
        />
        <Stat
          label="Recognised revenue"
          value={<Money microUsd={data.margin.revenueMicroUsd} />}
          caption={`Subscription ${formatPercent(
            data.margin.revenueMicroUsd > 0
              ? data.subscriptionRevenueMicroUsd / data.margin.revenueMicroUsd
              : 0,
          )} · metered ${formatPercent(
            data.margin.revenueMicroUsd > 0
              ? data.meteredRevenueMicroUsd / data.margin.revenueMicroUsd
              : 0,
          )}`}
        />
        <Stat
          label="Gross margin"
          value={<Money microUsd={data.margin.grossMarginMicroUsd} />}
          delta={marginDelta}
          deltaLabel={marginDelta === undefined ? 'no prior period' : undefined}
          tone={data.margin.grossMarginMicroUsd >= 0 ? 'primary' : 'default'}
          caption={
            data.margin.marginFraction === null
              ? 'No revenue in this window'
              : `${formatPercent(data.margin.marginFraction, 1)} of revenue`
          }
        />
        <Stat
          label="Upstream + fees"
          value={<Money microUsd={data.margin.costMicroUsd} />}
          tone="ember"
          caption={`Models, compute and estimated ${STRIPE_PERCENT_BPS / 100}% card fees`}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartFrame
          title="Signups and active teams"
          description="A team counts as active on a day it produced at least one metered event."
          height={260}
        >
          <GrowthChart data={data.trend} />
        </ChartFrame>

        <AdminPanel
          title="Cost breakdown"
          description="What the platform spent to serve this window."
          bodyClassName="grid grid-cols-2 gap-4 p-4"
        >
          <MiniStat
            label="Model upstream"
            value={<Money microUsd={data.modelUpstreamMicroUsd} />}
            hint={`${formatCompactNumber(data.weightedTokens)} weighted tokens`}
            tone="ember"
          />
          <MiniStat
            label="Compute upstream"
            value={<Money microUsd={data.computeUpstreamMicroUsd} />}
            hint={formatHours(data.computeHours)}
            tone="ember"
          />
          <MiniStat
            label="Estimated card fees"
            value={<Money microUsd={data.stripeFeesMicroUsd} />}
            hint={`${data.cashChargeCount} charges`}
          />
          <MiniStat
            label="Cash collected"
            value={<Money microUsd={data.cashCollectedMicroUsd} />}
            hint="Top-ups and paid invoices"
          />
          <MiniStat
            label="Token revenue"
            value={<Money microUsd={data.modelChargedMicroUsd} />}
            hint="Overage and pay-as-you-go"
          />
          <MiniStat
            label="Compute revenue"
            value={<Money microUsd={data.computeChargedMicroUsd} />}
            hint="Overage and pay-as-you-go"
          />
          <MiniStat
            label="Provider failures"
            value={formatPercent(data.providerFailureRate, 2)}
            hint={`${data.providerFailures} of ${formatCompactNumber(data.providerCalls)} calls`}
            tone={data.providerFailureRate > 0.02 ? 'danger' : 'default'}
          />
          <MiniStat
            label="New users"
            value={formatCompactNumber(data.newUsers)}
            hint={`${formatCompactNumber(data.totalUsers)} total · ${formatCompactNumber(data.totalTeams)} teams`}
          />
        </AdminPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ChartFrame
          title="Agent runs per day"
          description="Every run started on the platform, whatever its outcome."
          height={220}
        >
          <RunsChart data={data.trend} />
        </ChartFrame>

        <AdminPanel
          title="Subscriptions by plan"
          description="Where the recurring revenue actually comes from."
        >
          {data.planBreakdown.length === 0 ? (
            <EmptyState
              size="sm"
              title="No active subscriptions"
              description="Once a team subscribes, its plan and monthly revenue appear here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Subscriptions</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.planBreakdown.map((plan) => (
                  <TableRow key={plan.planId}>
                    <TableCell>
                      <PlanBadge tier={plan.tier} name={plan.planName} />
                    </TableCell>
                    <TableCell className="karo-numeric text-right">
                      {plan.subscriptions}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money microUsd={plan.mrrMicroUsd} />
                    </TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      {formatPercent(
                        data.mrrMicroUsd > 0 ? plan.mrrMicroUsd / data.mrrMicroUsd : 0,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </AdminPanel>
      </div>

      <AdminPanel
        title={
          <span className="flex items-center gap-2">
            <TrendingDown className="size-4 text-danger" aria-hidden="true" />
            Loss-making teams
          </span>
        }
        description="Teams whose upstream cost over this window exceeds everything Karo earned from them — prorated subscription revenue plus metered charges. Sorted by deficit."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/admin/costs?days=${period.days}`}>
              Unit economics
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        }
      >
        {data.lossMaking.length === 0 ? (
          <EmptyState
            size="sm"
            title="Every team is profitable in this window"
            description="No team consumed more upstream capacity than it paid for. Widen the period if you are looking for a specific incident."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Upstream</TableHead>
                <TableHead className="text-right">Deficit</TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  Weighted tokens
                </TableHead>
                <TableHead className="hidden text-right md:table-cell">Compute</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lossMaking.map((team) => (
                <TableRow key={team.teamId}>
                  <TableCell className="max-w-[16rem]">
                    <span className="block truncate font-medium text-fg">{team.teamName}</span>
                    <span className="block truncate text-[11px] text-subtle">
                      {team.teamSlug}
                    </span>
                  </TableCell>
                  <TableCell>
                    <PlanBadge tier={team.planTier} name={team.planName} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={team.revenueMicroUsd} />
                    <span className="block text-[11px] text-subtle">
                      sub {<Money microUsd={team.subscriptionRevenueMicroUsd} />}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={team.upstreamMicroUsd} />
                    <span className="block text-[11px] text-subtle">
                      model {<Money microUsd={team.modelUpstreamMicroUsd} />}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <SignedMoney microUsd={-team.deficitMicroUsd} />
                  </TableCell>
                  <TableCell className="karo-numeric hidden text-right text-muted md:table-cell">
                    {formatCompactNumber(team.weightedTokens)}
                  </TableCell>
                  <TableCell className="karo-numeric hidden text-right text-muted md:table-cell">
                    {formatHours(team.computeHours)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminPanel>

      <AdminPanel
        title="Open incidents"
        description="Anything not yet resolved, newest first."
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/admin/incidents">Manage</Link>
          </Button>
        }
      >
        {data.openIncidents.length === 0 ? (
          <EmptyState
            size="sm"
            title="No open incidents"
            description="Nothing is currently degraded. New incidents appear here the moment they are filed."
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.openIncidents.map((incident) => (
              <li key={incident.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <Badge
                  variant={
                    incident.severity === 'sev1'
                      ? 'danger'
                      : incident.severity === 'sev2'
                        ? 'warning'
                        : 'neutral'
                  }
                  size="sm"
                >
                  {incident.severity.toUpperCase()}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                  {incident.title}
                </span>
                <Badge variant="outline" size="sm">
                  {incident.component}
                </Badge>
                <span className="text-[11px] text-subtle">
                  {formatDate(incident.detectedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>

      <p className="text-[11px] leading-relaxed text-subtle">
        Margin is estimated. Card fees are modelled at {STRIPE_PERCENT_BPS / 100}% + $0.30 per
        settled charge rather than imported from Stripe, and subscription revenue is spread
        evenly across the billing month. Upstream model and compute costs are the real metered
        figures.
      </p>
    </div>
  );
}
