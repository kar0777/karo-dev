'use client';

import { ArrowDownRight, ArrowUpRight, Check } from 'lucide-react';
import * as React from 'react';

import {
  useBillingMutation,
  postJson,
  type BillingRedirect,
} from '@/components/billing/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented';
import { cn, formatCompactNumber, formatMicroUsd } from '@/lib/utils';

/**
 * Plan picker. Every number is read from the `plans` table upstream of this
 * component — nothing about a tier is hard-coded here, so an admin editing a
 * quota changes this screen without a deploy.
 */

export type PlanOption = {
  id: string;
  key: string;
  tier: 'payg' | 'lite' | 'pro' | 'scale' | 'ultra';
  name: string;
  tagline: string;
  priceMicroUsdMonthly: number;
  priceMicroUsdYearly: number;
  includedWeightedTokens: number;
  includedComputeHours: number;
  maxActiveSandboxes: number;
  maxTeamMembers: number;
  maxProjects: number;
  features: string[];
  highlight: boolean;
  trialDays: number;
  /** Advertised but not purchasable yet; the picker badges and disables it. */
  comingSoon: boolean;
};

export interface PlanPickerProps {
  plans: readonly PlanOption[];
  currentPlanId: string | null;
  currentInterval: 'month' | 'year';
  hasSubscription: boolean;
  cancelAtPeriodEnd: boolean;
  canManage: boolean;
}

function yearlySavingPercent(plan: PlanOption): number | null {
  if (plan.priceMicroUsdMonthly <= 0 || plan.priceMicroUsdYearly <= 0) return null;
  const yearlyAsMonthly = plan.priceMicroUsdMonthly * 12;
  if (plan.priceMicroUsdYearly >= yearlyAsMonthly) return null;
  return Math.round((1 - plan.priceMicroUsdYearly / yearlyAsMonthly) * 100);
}

export function PlanPicker({
  plans,
  currentPlanId,
  currentInterval,
  hasSubscription,
  cancelAtPeriodEnd,
  canManage,
}: PlanPickerProps) {
  const { pendingKey, run } = useBillingMutation();
  const [interval, setInterval] = React.useState<'month' | 'year'>(currentInterval);

  const currentPlan = plans.find((plan) => plan.id === currentPlanId) ?? null;
  const currentMonthly = currentPlan?.priceMicroUsdMonthly ?? 0;

  const bestSaving = plans.reduce<number | null>((best, plan) => {
    const saving = yearlySavingPercent(plan);
    if (saving === null) return best;
    return best === null || saving > best ? saving : best;
  }, null);

  async function choose(plan: PlanOption) {
    const isCurrent = plan.id === currentPlanId && interval === currentInterval;
    if (isCurrent) return;

    if (plan.tier === 'payg') {
      await run(
        plan.id,
        () =>
          postJson<{ ok: boolean }>('/api/billing/subscription', { action: 'cancel' }, 'PATCH'),
        {
          success: () => ({
            title: 'Moving to pay-as-you-go',
            description:
              'Your current plan stays active until the end of the period, then billing switches to your balance.',
          }),
        },
      );
      return;
    }

    if (hasSubscription && !cancelAtPeriodEnd) {
      await run(
        plan.id,
        () =>
          postJson<{ ok: boolean; direction: string; planName: string }>(
            '/api/billing/subscription',
            { action: 'change', planId: plan.id, interval },
            'PATCH',
          ),
        {
          success: (result) => ({
            title: `Now on ${result.planName}`,
            description:
              result.direction === 'upgrade'
                ? 'The new allowance is available immediately and the difference is prorated.'
                : 'The change is in effect; the lower rate applies from the next invoice.',
          }),
        },
      );
      return;
    }

    await run(
      plan.id,
      () => postJson<BillingRedirect>('/api/billing/checkout', { planId: plan.id, interval }),
      { redirect: (result) => result.url },
    );
  }

  return (
    <section
      id="plans"
      aria-labelledby="plans-title"
      className="scroll-mt-20 rounded-lg border border-line bg-surface shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id="plans-title" className="text-sm leading-tight font-semibold text-fg">
            Plans
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Upgrades apply immediately and are prorated for the rest of the current period.
            Downgrades keep your current allowance until the period ends, then bill at the lower
            rate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="sm"
            aria-label="Billing interval"
            options={[
              { value: 'month', label: 'Monthly' },
              { value: 'year', label: 'Yearly' },
            ]}
            value={interval}
            onValueChange={(value) => setInterval(value as 'month' | 'year')}
          />
          {bestSaving !== null ? (
            <Badge variant="primary" size="sm">
              Save up to {bestSaving}%
            </Badge>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const price =
            interval === 'year' ? plan.priceMicroUsdYearly : plan.priceMicroUsdMonthly;
          const isCurrent = plan.id === currentPlanId;
          const isCurrentExact = isCurrent && interval === currentInterval;
          const direction =
            plan.priceMicroUsdMonthly > currentMonthly
              ? 'upgrade'
              : plan.priceMicroUsdMonthly < currentMonthly
                ? 'downgrade'
                : 'same';
          const busy = pendingKey === plan.id;

          return (
            <article
              key={plan.id}
              className={cn(
                'flex flex-col gap-3 bg-surface p-4',
                plan.highlight && !isCurrent && 'bg-surface-2',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-fg">
                    {plan.name}
                    {isCurrent ? (
                      <Badge variant="primary" size="sm">
                        <Check className="size-3" aria-hidden="true" />
                        Current
                      </Badge>
                    ) : null}
                    {!isCurrent && plan.comingSoon ? (
                      <Badge size="sm">Coming soon</Badge>
                    ) : null}
                    {!isCurrent && plan.highlight && !plan.comingSoon ? (
                      <Badge variant="ember" size="sm">
                        Most picked
                      </Badge>
                    ) : null}
                  </h3>
                  {plan.tagline ? (
                    <p className="mt-1 text-[12px] leading-snug text-muted">{plan.tagline}</p>
                  ) : null}
                </div>
              </div>

              <p className="flex items-baseline gap-1.5">
                <span className="karo-numeric text-xl leading-none font-semibold text-fg">
                  {price > 0 ? formatMicroUsd(price) : '$0'}
                </span>
                <span className="text-[11px] text-subtle">
                  {price > 0 ? (interval === 'year' ? '/year' : '/month') : 'usage only'}
                </span>
              </p>

              <ul className="flex flex-col gap-1 text-[12px] text-muted">
                <li className="karo-numeric">
                  {plan.includedWeightedTokens > 0
                    ? `${formatCompactNumber(plan.includedWeightedTokens)} weighted tokens included`
                    : 'No included tokens — pay per request'}
                </li>
                <li className="karo-numeric">
                  {plan.includedComputeHours > 0
                    ? `${plan.includedComputeHours.toFixed(0)} compute hours included`
                    : 'Compute billed per second'}
                </li>
                <li className="karo-numeric">
                  {plan.maxActiveSandboxes} concurrent{' '}
                  {plan.maxActiveSandboxes === 1 ? 'sandbox' : 'sandboxes'} · {plan.maxProjects}{' '}
                  projects
                </li>
                <li className="karo-numeric">
                  {plan.maxTeamMembers} team {plan.maxTeamMembers === 1 ? 'member' : 'members'}
                </li>
                {plan.features.slice(0, 3).map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <div className="mt-auto flex flex-col gap-1.5 pt-1">
                <Button
                  size="sm"
                  variant={
                    isCurrentExact ? 'secondary' : plan.highlight ? 'primary' : 'outline'
                  }
                  onClick={() => void choose(plan)}
                  loading={busy}
                  disabled={
                    !canManage || isCurrentExact || pendingKey !== null || plan.comingSoon
                  }
                >
                  {isCurrentExact ? (
                    'Your plan'
                  ) : plan.tier === 'payg' ? (
                    'Move to pay as you go'
                  ) : direction === 'upgrade' ? (
                    <>
                      <ArrowUpRight aria-hidden="true" />
                      Upgrade to {plan.name}
                    </>
                  ) : direction === 'downgrade' ? (
                    <>
                      <ArrowDownRight aria-hidden="true" />
                      Downgrade to {plan.name}
                    </>
                  ) : (
                    `Switch to ${interval === 'year' ? 'yearly' : 'monthly'}`
                  )}
                </Button>
                {!isCurrentExact && plan.trialDays > 0 && !hasSubscription ? (
                  <p className="text-center text-[11px] text-subtle">
                    {plan.trialDays}-day trial, cancel any time
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {!canManage ? (
        <p className="border-t border-line px-4 py-2.5 text-[12px] text-subtle">
          Only a team owner can change the plan. Ask an owner to make the change, or to give you
          the owner role.
        </p>
      ) : null}
    </section>
  );
}
