import { z } from 'zod';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getActiveTeam } from '@/lib/auth/guards';
import { assertCan } from '@/lib/rbac/permissions';
import {
  loadDailySeries,
  loadRunCostSummary,
  loadUsageTotals,
  resolveModelNames,
  resolveProjectNames,
  usageByModelForProject,
  type UsageScope,
} from '@/lib/usage/analytics';
import {
  getUsageByModel,
  getUsageByProject,
  loadBillingContext,
  projectPeriodTotal,
} from '@/lib/usage/metering';

/**
 * Usage summary for client-side polling — the same numbers the page renders on
 * the server, so a dashboard widget and the analytics page can never disagree.
 */

const query = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30).optional(),
  /** `period` overrides `days` and uses the current billing period instead. */
  range: z.enum(['7', '30', '90', 'period']).optional(),
  projectId: z.string().min(1).optional(),
});

export const GET = defineHandler(
  { auth: 'required', query },
  async ({ user, query: input }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'usage.read');

    const context = await loadBillingContext(team.id);

    const days =
      input?.range && input.range !== 'period' ? Number(input.range) : (input?.days ?? 30);
    const since =
      input?.range === 'period'
        ? context.periodStart
        : (() => {
            const start = new Date();
            start.setUTCHours(0, 0, 0, 0);
            start.setUTCDate(start.getUTCDate() - (days - 1));
            return start;
          })();

    const projectId = input?.projectId ?? null;
    const scope: UsageScope = { teamId: team.id, since, projectId };

    const [daily, totals, runCosts, modelAggregate, projectAggregate] = await Promise.all([
      loadDailySeries(scope),
      loadUsageTotals(scope),
      loadRunCostSummary(scope),
      projectId ? usageByModelForProject(scope) : getUsageByModel(team.id, since),
      projectId
        ? Promise.resolve(
            [] as Array<{
              projectId: string | null;
              weightedTokens: number;
              chargedMicroUsd: number;
              requests: number;
            }>,
          )
        : getUsageByProject(team.id, since),
    ]);

    const [modelNames, projectNames] = await Promise.all([
      resolveModelNames(modelAggregate.map((row) => row.modelSlug)),
      resolveProjectNames(projectAggregate.map((row) => row.projectId)),
    ]);

    return json({
      range: {
        since: since.toISOString(),
        until: new Date().toISOString(),
        projectId,
      },
      period: {
        start: context.periodStart.toISOString(),
        end: context.periodEnd.toISOString(),
        spendMicroUsd: context.periodSpendMicroUsd,
        projectedMicroUsd: projectPeriodTotal(
          context.periodSpendMicroUsd,
          context.periodStart,
          context.periodEnd,
        ),
      },
      quota: {
        planKey: context.plan.key,
        planName: context.plan.name,
        hasActiveSubscription: context.hasActiveSubscription,
        includedWeightedTokens: context.plan.includedWeightedTokens,
        includedComputeHours: context.plan.includedComputeHours,
        weightedTokensUsed: context.weightedTokensUsed,
        computeHoursUsed: context.computeHoursUsed,
        weightedTokensRemaining: context.quotaRemainingWeighted,
        computeHoursRemaining: context.quotaRemainingComputeHours,
        balanceMicroUsd: context.balanceMicroUsd,
        creditLimitMicroUsd: context.creditLimitMicroUsd,
        spendCapMicroUsd: context.spendCapMicroUsd,
      },
      totals: {
        ...totals,
        runs: runCosts.runs,
        averageCostPerRunMicroUsd: runCosts.averageMicroUsd,
      },
      daily,
      byModel: modelAggregate.map((row) => ({
        modelSlug: row.modelSlug,
        displayName: modelNames.get(row.modelSlug) ?? row.modelSlug,
        weightedTokens: Number(row.weightedTokens),
        chargedMicroUsd: Number(row.chargedMicroUsd),
        requests: Number(row.requests),
      })),
      byProject: projectAggregate.map((row) => ({
        projectId: row.projectId,
        name: row.projectId
          ? (projectNames.get(row.projectId) ?? 'Deleted project')
          : 'No project',
        weightedTokens: Number(row.weightedTokens),
        chargedMicroUsd: Number(row.chargedMicroUsd),
        requests: Number(row.requests),
      })),
    });
  },
);
