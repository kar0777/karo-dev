export const dynamic = 'force-dynamic';

import { asc, desc, eq } from 'drizzle-orm';
import { BarChart3 } from 'lucide-react';
import Link from 'next/link';

import { BalanceCard } from '@/components/billing/balance-card';
import {
  CheckoutReturnBanner,
  SimulatedBillingBanner,
  type CheckoutOutcome,
} from '@/components/billing/billing-banners';
import { CurrentPlanCard } from '@/components/billing/current-plan-card';
import { OverageExplainer } from '@/components/billing/overage-explainer';
import {
  PaymentHistory,
  type InvoiceRow,
  type TopupRow,
} from '@/components/billing/payment-history';
import { PlanPicker, type PlanOption } from '@/components/billing/plan-picker';
import { SpendingControls } from '@/components/billing/spending-controls';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { isSimulatedBilling } from '@/lib/billing';
import { db } from '@/lib/db';
import {
  invoices,
  paygBalances,
  plans,
  subscriptions,
  topups,
  type Plan,
} from '@/lib/db/schema';
import { can } from '@/lib/rbac/permissions';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';
import { loadBillingContext } from '@/lib/usage/metering';

/**
 * Billing.
 *
 * Every figure is read from the database at request time: plan quotas come from
 * the `plans` row, money from `payg_balances` and `usage_periods`. Nothing on
 * this page is a constant, which is what makes an admin plan edit visible here
 * immediately.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A top-up finished this recently is almost certainly the one just returned from. */
const RECENT_TOPUP_WINDOW_MS = 5 * 60_000;

function hasRecentSuccessfulTopup(
  rows: ReadonlyArray<{ status: string; completedAt: Date | null; createdAt: Date }>,
): boolean {
  const now = Date.now();
  return rows.some(
    (topup) =>
      topup.status === 'succeeded' &&
      now - (topup.completedAt ?? topup.createdAt).getTime() < RECENT_TOPUP_WINDOW_MS,
  );
}

/** ISO string only while the trial is still running; `null` once it has passed. */
function activeTrialEnd(trialEndsAt: Date | null | undefined): string | null {
  if (!trialEndsAt) return null;
  return trialEndsAt.getTime() > Date.now() ? trialEndsAt.toISOString() : null;
}

/**
 * The plan a scheduled downgrade moves to. It is normally one of the rows the
 * picker already loaded, but a plan an admin has since retired still has to be
 * nameable — the team is going to land on it either way.
 */
async function loadScheduledPlan(
  pendingPlanId: string | null,
  loaded: readonly Plan[],
): Promise<Plan | null> {
  if (!pendingPlanId) return null;
  const known = loaded.find((plan) => plan.id === pendingPlanId);
  if (known) return known;
  const [row] = await db.select().from(plans).where(eq(plans.id, pendingPlanId)).limit(1);
  return row ?? null;
}

function resolveOutcome(
  params: Record<string, string | string[] | undefined>,
  hadRecentTopup: boolean,
  simulated: boolean,
): CheckoutOutcome | null {
  if (firstParam(params.checkout) === 'cancelled') return { kind: 'cancelled' };
  if (firstParam(params.portal) === 'simulated') return { kind: 'portal' };

  const sessionId = firstParam(params.session_id);
  if (!sessionId) return null;

  const wasSimulated = firstParam(params.simulated) === '1' || simulated;
  // A `cs_..._payment` style id is not guaranteed, so fall back to what changed.
  if (hadRecentTopup) return { kind: 'topup', simulated: wasSimulated };
  return { kind: 'generic', simulated: wasSimulated };
}

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  if (!can(role, 'billing.read')) {
    return (
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <PageHeader
          title="Billing"
          description="Plan, balance and invoices for this team."
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/usage">
                <BarChart3 aria-hidden="true" />
                Usage
              </Link>
            </Button>
          }
        />
        <ErrorState
          code="forbidden"
          title="Billing is limited to admins and owners"
          description="Your role does not include billing. You can still see what your team is using on the Usage page — ask an owner if you need billing access."
          secondaryAction={
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/usage">Open usage</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const canManage = can(role, 'billing.manage');
  const simulated = isSimulatedBilling();

  const [context, subscriptionRow, planRows, balanceRow, invoiceRows, topupRows, minTopup] =
    await Promise.all([
      loadBillingContext(team.id),
      db
        .select({ subscription: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(subscriptions.planId, plans.id))
        .where(eq(subscriptions.teamId, team.id))
        .limit(1),
      db
        .select()
        .from(plans)
        .where(eq(plans.isActive, true))
        .orderBy(asc(plans.sortOrder), asc(plans.priceMicroUsdMonthly)),
      db.select().from(paygBalances).where(eq(paygBalances.teamId, team.id)).limit(1),
      db
        .select()
        .from(invoices)
        .where(eq(invoices.teamId, team.id))
        .orderBy(desc(invoices.createdAt))
        .limit(12),
      db
        .select()
        .from(topups)
        .where(eq(topups.teamId, team.id))
        .orderBy(desc(topups.createdAt))
        .limit(12),
      getSetting(
        SETTING_KEYS.billingMinTopupMicroUsd,
        settingDefault(SETTING_KEYS.billingMinTopupMicroUsd),
      ),
    ]);

  const subscription = subscriptionRow[0]?.subscription ?? null;
  const subscriptionPlan = subscriptionRow[0]?.plan ?? null;
  const activePlan = subscriptionPlan ?? context.plan;
  const balance = balanceRow[0] ?? null;

  const publicPlans: PlanOption[] = planRows
    .filter((plan) => plan.isPublic || plan.id === activePlan.id)
    .map((plan) => ({
      id: plan.id,
      key: plan.key,
      tier: plan.tier,
      name: plan.name,
      tagline: plan.tagline,
      priceMicroUsdMonthly: plan.priceMicroUsdMonthly,
      priceMicroUsdYearly: plan.priceMicroUsdYearly,
      includedWeightedTokens: plan.includedWeightedTokens,
      includedComputeHours: plan.includedComputeHours,
      maxActiveSandboxes: plan.maxActiveSandboxes,
      maxTeamMembers: plan.maxTeamMembers,
      maxProjects: plan.maxProjects,
      features: plan.features,
      highlight: plan.highlight,
      trialDays: plan.trialDays,
    }));

  const interval: 'month' | 'year' = subscription?.interval === 'year' ? 'year' : 'month';

  const scheduledPlan = await loadScheduledPlan(subscription?.pendingPlanId ?? null, planRows);
  const scheduledInterval: 'month' | 'year' =
    subscription?.pendingInterval === 'year' ? 'year' : 'month';

  const invoiceViews: InvoiceRow[] = invoiceRows.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    totalMicroUsd: invoice.totalMicroUsd,
    amountPaidMicroUsd: invoice.amountPaidMicroUsd,
    periodStartIso: invoice.periodStart?.toISOString() ?? null,
    periodEndIso: invoice.periodEnd?.toISOString() ?? null,
    issuedAtIso: (invoice.issuedAt ?? invoice.createdAt).toISOString(),
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    pdfUrl: invoice.pdfUrl,
  }));

  const topupViews: TopupRow[] = topupRows.map((topup) => ({
    id: topup.id,
    amountMicroUsd: topup.amountMicroUsd,
    bonusMicroUsd: topup.bonusMicroUsd,
    status: topup.status,
    provider: topup.provider,
    createdAtIso: topup.createdAt.toISOString(),
    completedAtIso: topup.completedAt?.toISOString() ?? null,
    failureReason: topup.failureReason,
  }));

  // Lets the return banner name what actually happened rather than saying
  // "payment completed" for both a subscription and a balance top-up.
  const outcome = resolveOutcome(params, hasRecentSuccessfulTopup(topupRows), simulated);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title="Billing"
        description="Your plan, balance and spending controls. All amounts are in US dollars."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/app/usage">
              <BarChart3 aria-hidden="true" />
              Usage
            </Link>
          </Button>
        }
      />

      {outcome ? <CheckoutReturnBanner outcome={outcome} /> : null}
      {simulated ? <SimulatedBillingBanner /> : null}

      <CurrentPlanCard
        planId={activePlan.id}
        planName={activePlan.name}
        planTagline={activePlan.tagline}
        planTier={activePlan.tier}
        hasSubscription={Boolean(subscription)}
        status={subscription?.status ?? 'active'}
        interval={interval}
        scheduledPlanName={scheduledPlan?.name ?? null}
        scheduledInterval={scheduledPlan ? scheduledInterval : null}
        // The metered period end, which is the window the sweep measures the
        // parked change against. `subscriptions.current_period_end` only moves
        // when a provider webhook says so, so it can sit in the past and would
        // render a change that has "already" landed.
        scheduledEffectiveAtIso={scheduledPlan ? context.periodEnd.toISOString() : null}
        priceMicroUsd={
          interval === 'year' ? activePlan.priceMicroUsdYearly : activePlan.priceMicroUsdMonthly
        }
        currentPeriodEndIso={context.periodEnd.toISOString()}
        cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
        trialEndsAtIso={activeTrialEnd(subscription?.trialEndsAt)}
        includedWeightedTokens={
          context.hasActiveSubscription ? activePlan.includedWeightedTokens : 0
        }
        includedComputeHours={
          context.hasActiveSubscription ? activePlan.includedComputeHours : 0
        }
        canManage={canManage}
        isSimulated={simulated}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BalanceCard
          balanceMicroUsd={balance?.balanceMicroUsd ?? 0}
          creditLimitMicroUsd={balance?.creditLimitMicroUsd ?? context.creditLimitMicroUsd}
          lifetimeToppedUpMicroUsd={balance?.lifetimeToppedUpMicroUsd ?? 0}
          lifetimeSpentMicroUsd={balance?.lifetimeSpentMicroUsd ?? 0}
          minTopupMicroUsd={minTopup}
          autoTopupEnabled={team.autoTopupEnabled}
          autoTopupThresholdMicroUsd={team.autoTopupThresholdMicroUsd}
          autoTopupAmountMicroUsd={team.autoTopupAmountMicroUsd}
          canManage={canManage}
          isSimulated={simulated}
        />
        <SpendingControls
          spendCapMicroUsd={team.spendCapMicroUsd}
          periodSpendMicroUsd={context.periodSpendMicroUsd}
          periodEndIso={context.periodEnd.toISOString()}
          canManage={canManage}
        />
      </div>

      <OverageExplainer
        planName={activePlan.name}
        hasSubscription={context.hasActiveSubscription}
        includedWeightedTokens={activePlan.includedWeightedTokens}
        quotaRemainingWeighted={context.quotaRemainingWeighted}
        overageMicroUsdPerMWeighted={activePlan.overageMicroUsdPerMWeighted}
        overageMicroUsdPerComputeHour={activePlan.overageMicroUsdPerComputeHour}
        marginBps={activePlan.marginBps}
      />

      <PlanPicker
        plans={publicPlans}
        currentPlanId={activePlan.id}
        currentInterval={interval}
        hasSubscription={Boolean(subscription) && context.hasActiveSubscription}
        cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
        canManage={canManage}
      />

      <PaymentHistory invoices={invoiceViews} topups={topupViews} />
    </div>
  );
}
