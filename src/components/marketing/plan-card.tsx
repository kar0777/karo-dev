import { Check } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatCompactNumber, formatMicroUsd, formatNumber } from '@/lib/utils';

import {
  type BillingInterval,
  monthlyPriceMicroUsd,
  type PlanView,
  supportLabel,
  yearlyFreeMonths,
} from './plan-view';

/* ------------------------------------------------------------------ *
 *  Plan card
 *
 *  Rendered from a `plans` row on both the landing preview and the
 *  pricing page. No tier numbers are written here — every figure comes
 *  from the row. Kept free of `'use client'` so it can sit inside the
 *  client-side interval toggle *and* inside a Server Component.
 * ------------------------------------------------------------------ */

export type PlanCardProps = {
  plan: PlanView;
  interval: BillingInterval;
  /** Trims the feature list on the landing preview. */
  maxFeatures?: number;
  className?: string;
};

function priceLabel(plan: PlanView, interval: BillingInterval): string {
  if (plan.priceMicroUsdMonthly === 0) return 'Usage only';
  return formatMicroUsd(monthlyPriceMicroUsd(plan, interval));
}

export function PlanCard({ plan, interval, maxFeatures, className }: PlanCardProps) {
  const isPayg = plan.priceMicroUsdMonthly === 0;
  const freeMonths = yearlyFreeMonths(plan);
  const features = maxFeatures ? plan.features.slice(0, maxFeatures) : plan.features;

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border bg-surface p-5 shadow-sm',
        plan.highlight ? 'border-line-accent shadow-md' : 'border-line',
        className,
      )}
    >
      {plan.highlight ? (
        <Badge variant="primary" size="sm" className="absolute -top-2.5 left-5">
          Most popular
        </Badge>
      ) : null}

      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-fg">{plan.name}</h3>
        {plan.comingSoon ? (
          <Badge variant="neutral" size="sm">
            Coming soon
          </Badge>
        ) : plan.trialDays > 0 ? (
          <Badge variant="neutral" size="sm">
            {plan.trialDays}-day trial
          </Badge>
        ) : null}
      </div>

      <p className="mt-1 text-[13px] leading-snug text-muted">{plan.tagline}</p>

      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="karo-numeric text-3xl font-semibold text-fg">
          {priceLabel(plan, interval)}
        </span>
        {!isPayg ? <span className="text-[13px] text-subtle">/ month</span> : null}
      </div>

      <p className="mt-1 min-h-[1.25rem] text-[12px] text-subtle">
        {isPayg ? (
          <>
            Upstream cost plus {(plan.marginBps / 100).toFixed(0)}% margin, drawn from your
            balance
          </>
        ) : interval === 'year' ? (
          <>
            {formatMicroUsd(plan.priceMicroUsdYearly)} billed yearly
            {freeMonths > 0 ? ` — ${freeMonths} months free` : null}
          </>
        ) : (
          <>Billed monthly, cancel any time</>
        )}
      </p>

      {plan.comingSoon ? (
        <Button className="mt-4 size-lg" size="lg" variant="secondary" disabled>
          Not on sale yet
        </Button>
      ) : (
        <Button asChild className="mt-4" size="lg">
          <Link href={`/register?plan=${encodeURIComponent(plan.key)}`}>
            {isPayg ? 'Start with a balance' : `Start on ${plan.name}`}
          </Link>
        </Button>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4">
        <Spec
          label="Weighted tokens"
          value={
            plan.includedWeightedTokens > 0
              ? `${formatCompactNumber(plan.includedWeightedTokens)} / mo`
              : 'Metered'
          }
        />
        <Spec
          label="Compute hours"
          value={
            plan.includedComputeHours > 0
              ? `${formatNumber(plan.includedComputeHours)} / mo`
              : 'Metered'
          }
        />
        <Spec label="Sandboxes" value={`${plan.maxActiveSandboxes} active`} />
        <Spec
          label="Machine"
          value={`${plan.maxSandboxCpuCores} vCPU · ${formatNumber(plan.maxSandboxMemoryMb)} MB`}
        />
        <Spec label="Storage" value={`${plan.storageGb} GB`} />
        <Spec label="Seats" value={formatNumber(plan.maxTeamMembers)} />
        <Spec
          label="Overage"
          value={
            plan.overageMicroUsdPerMWeighted > 0
              ? `${formatMicroUsd(plan.overageMicroUsdPerMWeighted)} / M`
              : 'Cost plus margin'
          }
        />
        <Spec label="Support" value={supportLabel(plan.supportLevel)} />
      </dl>

      <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        {features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 text-[13px] leading-snug text-muted"
          >
            <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="karo-numeric truncate text-[12.5px] font-medium text-fg">{value}</dd>
    </div>
  );
}
