export const dynamic = 'force-dynamic';

import { Activity, Coins, Cpu, Gauge, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Meter } from '@/components/ui/meter';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import { RecentRequestsTable } from '@/components/usage/recent-requests-table';
import { UsageAlertsCard } from '@/components/usage/usage-alerts-card';
import { UsageCharts, type QuotaPoint } from '@/components/usage/usage-charts';
import { UsageControls } from '@/components/usage/usage-controls';
import { WeightedTokenExplainer } from '@/components/usage/weighted-token-explainer';
import { parseRangeKey, rangeDescription, rangeStart } from '@/components/usage/period';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { projects as projectsTable } from '@/lib/db/schema';
import { can } from '@/lib/rbac/permissions';
import {
  RECENT_REQUESTS_PAGE_SIZE,
  buildWorkedExample,
  listRecentRequests,
  loadDailySeries,
  loadModelWeightBreakdown,
  loadRunCostSummary,
  loadUsageTotals,
  resolveModelNames,
  resolveProjectNames,
  usageByModelForProject,
  type DailySeriesPoint,
  type UsageScope,
} from '@/lib/usage/analytics';
import {
  getUsageByModel,
  getUsageByProject,
  loadBillingContext,
  projectPeriodTotal,
} from '@/lib/usage/metering';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { formatCompactNumber, formatMicroUsd, formatNumber } from '@/lib/utils';

/**
 * Usage analytics.
 *
 * Everything is queried here and handed down as plain props — the charts are
 * the only client boundary, and they receive numbers rather than a fetcher.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Burn-down of the included allowance across the *billing period*, regardless
 * of the range the user is looking at — a seven-day window cannot answer
 * "will my allowance last the month".
 */
function buildQuotaSeries(
  series: readonly DailySeriesPoint[],
  included: number,
  periodStart: Date,
  periodEnd: Date,
): QuotaPoint[] {
  if (included <= 0) return [];

  const totalMs = periodEnd.getTime() - periodStart.getTime();
  let consumed = 0;

  return series.map((point) => {
    consumed += point.weightedTokens;
    const dayEnd = new Date(`${point.date}T23:59:59Z`).getTime();
    const elapsed = Math.min(Math.max(dayEnd - periodStart.getTime(), 0), totalMs);
    const fraction = totalMs > 0 ? elapsed / totalMs : 0;
    return {
      date: point.date,
      remaining: Math.max(0, included - consumed),
      ideal: Math.round(included * (1 - fraction)),
    };
  });
}

export default async function UsagePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  if (!can(role, 'usage.read')) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <PageHeader
          title="Usage"
          description="Token, compute and cost analytics for your team."
        />
        <ErrorState
          code="forbidden"
          title="You cannot view usage for this team"
          description="Your role does not include usage analytics. Ask a team owner or admin to change your role."
        />
      </div>
    );
  }

  const context = await loadBillingContext(team.id);

  const range = parseRangeKey(params.range);
  const since = rangeStart(range, context.periodStart);
  const requestedProjectId = firstParam(params.projectId) ?? null;
  const page = Math.max(1, Number.parseInt(firstParam(params.page) ?? '1', 10) || 1);

  const teamProjects = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(and(eq(projectsTable.teamId, team.id), isNull(projectsTable.archivedAt)))
    .orderBy(asc(projectsTable.name));

  // A stale `?projectId=` from a deleted project must not silently filter
  // everything to zero — fall back to "all projects".
  const projectId = teamProjects.some((project) => project.id === requestedProjectId)
    ? requestedProjectId
    : null;

  const scope: UsageScope = { teamId: team.id, since, projectId };

  type ModelAggregate = {
    modelSlug: string;
    weightedTokens: number;
    chargedMicroUsd: number;
    requests: number;
  };
  type ProjectAggregate = {
    projectId: string | null;
    weightedTokens: number;
    chargedMicroUsd: number;
    requests: number;
  };

  const modelAggregatePromise: Promise<ModelAggregate[]> = projectId
    ? usageByModelForProject(scope)
    : getUsageByModel(team.id, since);
  const projectAggregatePromise: Promise<ProjectAggregate[]> = projectId
    ? Promise.resolve([])
    : getUsageByProject(team.id, since);
  const periodSeriesPromise: Promise<DailySeriesPoint[]> =
    context.plan.includedWeightedTokens > 0 && context.hasActiveSubscription
      ? loadDailySeries({ teamId: team.id, since: context.periodStart, projectId: null })
      : Promise.resolve([]);

  const [
    daily,
    totals,
    modelAggregate,
    projectAggregate,
    modelBreakdown,
    runCosts,
    recent,
    periodSeries,
  ] = await Promise.all([
    loadDailySeries(scope),
    loadUsageTotals(scope),
    modelAggregatePromise,
    projectAggregatePromise,
    loadModelWeightBreakdown(scope),
    loadRunCostSummary(scope),
    listRecentRequests(scope, {
      limit: RECENT_REQUESTS_PAGE_SIZE,
      offset: (page - 1) * RECENT_REQUESTS_PAGE_SIZE,
    }),
    periodSeriesPromise,
  ]);

  const [modelNames, projectNames] = await Promise.all([
    resolveModelNames(modelAggregate.map((row) => row.modelSlug)),
    resolveProjectNames(projectAggregate.map((row) => row.projectId)),
  ]);

  const byModel = modelAggregate.map((row) => ({
    modelSlug: row.modelSlug || 'unknown',
    displayName: modelNames.get(row.modelSlug) ?? row.modelSlug ?? 'Unknown model',
    weightedTokens: Number(row.weightedTokens),
    chargedMicroUsd: Number(row.chargedMicroUsd),
    requests: Number(row.requests),
  }));

  const byProject = projectId
    ? null
    : projectAggregate.map((row) => ({
        projectId: row.projectId,
        name: row.projectId
          ? (projectNames.get(row.projectId) ?? 'Deleted project')
          : 'No project',
        weightedTokens: Number(row.weightedTokens),
        chargedMicroUsd: Number(row.chargedMicroUsd),
        requests: Number(row.requests),
      }));

  const included = context.plan.includedWeightedTokens;
  const includedCompute = context.plan.includedComputeHours;
  const quota = buildQuotaSeries(
    periodSeries,
    context.hasActiveSubscription ? included : 0,
    context.periodStart,
    context.periodEnd,
  );

  const quotaUnavailableReason = context.hasActiveSubscription
    ? included > 0
      ? null
      : 'Your plan does not bundle weighted tokens — every request is billed from your balance instead.'
    : 'Pay-as-you-go has no monthly allowance to burn down. Every request is charged to your balance at cost plus margin.';

  const projected = projectPeriodTotal(
    context.periodSpendMicroUsd,
    context.periodStart,
    context.periodEnd,
  );

  const rangeLabel = rangeDescription(range, context.periodEnd.toISOString());
  const workedExample = buildWorkedExample(modelBreakdown);

  const baseParams = new URLSearchParams();
  if (range !== '30') baseParams.set('range', range);
  if (projectId) baseParams.set('projectId', projectId);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title="Usage"
        description="Weighted tokens, compute hours and cost — metered per request, updated within seconds of a run."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/app/billing">
              <Wallet aria-hidden="true" />
              Billing
            </Link>
          </Button>
        }
      >
        <UsageControls range={range} projectId={projectId} projects={teamProjects} />
      </PageHeader>

      <StatGrid columns={3}>
        <div className="flex flex-col justify-between gap-3 bg-surface p-4">
          <span className="text-[11px] font-medium tracking-wide text-subtle uppercase">
            Weighted tokens
          </span>
          <Meter
            value={context.weightedTokensUsed}
            max={included > 0 ? included : Math.max(context.weightedTokensUsed, 1)}
            tone={included > 0 ? undefined : 'ember'}
            label={
              included > 0
                ? `${formatCompactNumber(context.weightedTokensUsed)} used`
                : `${formatCompactNumber(context.weightedTokensUsed)} this period`
            }
            caption={
              included > 0 ? `of ${formatCompactNumber(included)}` : 'no included allowance'
            }
            showPercent={included > 0}
          />
        </div>

        <div className="flex flex-col justify-between gap-3 bg-surface p-4">
          <span className="text-[11px] font-medium tracking-wide text-subtle uppercase">
            Compute hours
          </span>
          <Meter
            value={context.computeHoursUsed}
            max={includedCompute > 0 ? includedCompute : Math.max(context.computeHoursUsed, 1)}
            tone={includedCompute > 0 ? undefined : 'ember'}
            label={`${context.computeHoursUsed.toFixed(2)} used`}
            caption={
              includedCompute > 0 ? `of ${includedCompute.toFixed(0)} h` : 'billed per second'
            }
            showPercent={includedCompute > 0}
          />
        </div>

        <Stat
          label="Spend this period"
          value={formatMicroUsd(context.periodSpendMicroUsd)}
          tone="ember"
          icon={Coins}
          caption={`Since ${context.periodStart.toISOString().slice(0, 10)}`}
        />

        <Stat
          label="Projected month-end"
          value={formatMicroUsd(projected)}
          icon={TrendingUp}
          caption={
            context.spendCapMicroUsd > 0
              ? `Cap ${formatMicroUsd(context.spendCapMicroUsd)}`
              : 'Straight-line from spend so far'
          }
        />

        <Stat
          label="Average cost per run"
          value={
            runCosts.averageMicroUsd === null
              ? '—'
              : formatMicroUsd(runCosts.averageMicroUsd, { precise: true })
          }
          icon={Gauge}
          caption={
            runCosts.runs === 0
              ? 'No agent runs in this period'
              : `${formatNumber(runCosts.runs)} ${runCosts.runs === 1 ? 'run' : 'runs'} · ${rangeLabel.toLowerCase()}`
          }
        />

        <Stat
          label="Requests"
          value={formatNumber(totals.requests)}
          icon={totals.errorRequests > 0 ? Activity : Cpu}
          caption={
            totals.requests === 0
              ? 'Nothing metered yet'
              : `${formatNumber(totals.errorRequests)} failed · ${formatNumber(totals.avgLatencyMs)} ms average`
          }
        />
      </StatGrid>

      <UsageCharts
        daily={daily}
        quota={quota.length > 0 ? quota : null}
        byModel={byModel}
        byProject={byProject}
        includedWeightedTokens={context.hasActiveSubscription ? included : 0}
        rangeLabel={rangeLabel}
        quotaUnavailableReason={quotaUnavailableReason}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WeightedTokenExplainer
          models={modelBreakdown.map((row) => ({
            modelSlug: row.modelSlug,
            displayName: row.displayName,
            providerKey: row.providerKey,
            multipliers: row.multipliers,
            estimated: row.estimated,
            weightedTokens: row.weightedTokens,
          }))}
          example={workedExample}
          rangeLabel={rangeLabel}
        />
        <UsageAlertsCard
          threshold={team.usageAlertThreshold}
          includedWeightedTokens={included}
          canManage={can(role, 'billing.manage')}
        />
      </div>

      <RecentRequestsTable
        rows={recent.rows}
        total={recent.total}
        page={page}
        pageSize={RECENT_REQUESTS_PAGE_SIZE}
        baseQuery={baseParams.toString()}
      />
    </div>
  );
}
