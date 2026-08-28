'use client';

import * as React from 'react';

import { Label } from '@/components/ui/label';
import { Meter } from '@/components/ui/meter';
import { Slider } from '@/components/ui/slider';
import { settleComputeUsage, settleModelUsage } from '@/lib/pricing/calculator';
import type { TokenPrices } from '@/lib/pricing/weighted-tokens';
import { cn, formatCompactNumber, formatMicroUsd } from '@/lib/utils';

import type { PlanView } from './plan-view';

/* ------------------------------------------------------------------ *
 *  Live cost widget
 *
 *  One slider, real settlement maths. Everything it prints comes from
 *  `@/lib/pricing/*` — the same functions that settle a real run — and
 *  from the plan row passed in, so the widget cannot drift away from
 *  what the product actually charges.
 * ------------------------------------------------------------------ */

/**
 * One "build turn" is a full agent iteration: it re-reads its context,
 * writes a reply, and usually runs a command. These are the medians the
 * demo workload is modelled on, printed under the slider so the reader
 * can check the arithmetic.
 */
const PER_TURN = {
  inputTokens: 12_000,
  cachedInputTokens: 8_000,
  outputTokens: 1_400,
  sandboxMinutes: 6,
} as const;

const WORKING_DAYS = 22;

export type CostWidgetProps = {
  plan: PlanView;
  prices: TokenPrices;
  /** What Karo pays per base compute hour, micro-USD. From admin settings. */
  computeUpstreamMicroUsdPerBaseHour: number;
  className?: string;
};

export function CostWidget({
  plan,
  prices,
  computeUpstreamMicroUsdPerBaseHour,
  className,
}: CostWidgetProps) {
  const [turnsPerDay, setTurnsPerDay] = React.useState(20);
  const sliderId = React.useId();

  const turns = turnsPerDay * WORKING_DAYS;

  const counts = {
    inputTokens: PER_TURN.inputTokens * turns,
    cachedInputTokens: PER_TURN.cachedInputTokens * turns,
    outputTokens: PER_TURN.outputTokens * turns,
  };

  const planConfig = {
    tier: plan.tier,
    marginBps: plan.marginBps,
    includedWeightedTokens: plan.includedWeightedTokens,
    includedComputeHours: plan.includedComputeHours,
    overageMicroUsdPerMWeighted: plan.overageMicroUsdPerMWeighted,
    overageMicroUsdPerComputeHour: plan.overageMicroUsdPerComputeHour,
  };

  const model = settleModelUsage({
    counts,
    prices,
    plan: planConfig,
    quotaRemainingWeighted: plan.includedWeightedTokens,
  });

  // Base machine: 0.25 vCPU + 512 MB is exactly ×1, so wall clock is billed 1:1.
  const computeHours = (turns * PER_TURN.sandboxMinutes) / 60;
  const compute = settleComputeUsage({
    billedComputeHours: computeHours,
    upstreamMicroUsdPerBaseHour: computeUpstreamMicroUsdPerBaseHour,
    plan: planConfig,
    quotaRemainingHours: plan.includedComputeHours,
  });

  const total = plan.priceMicroUsdMonthly + model.chargedMicroUsd + compute.chargedMicroUsd;

  return (
    <div className={cn('rounded-lg border border-line bg-surface p-4 shadow-sm', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={sliderId} className="text-[13px]">
          Build turns per working day
        </Label>
        <span className="karo-numeric text-[13px] font-medium text-fg">{turnsPerDay}</span>
      </div>

      <Slider
        id={sliderId}
        className="mt-3"
        min={2}
        max={80}
        step={1}
        value={[turnsPerDay]}
        onValueChange={([next]) => setTurnsPerDay(next ?? turnsPerDay)}
        aria-label="Build turns per working day"
      />

      <p className="mt-2 text-[11.5px] leading-relaxed text-subtle">
        {formatCompactNumber(PER_TURN.inputTokens, 0)} input +{' '}
        {formatCompactNumber(PER_TURN.cachedInputTokens, 0)} cached +{' '}
        {formatCompactNumber(PER_TURN.outputTokens, 0)} output tokens and{' '}
        {PER_TURN.sandboxMinutes} sandbox minutes per turn, over {WORKING_DAYS} working days.
      </p>

      <div className="mt-4 space-y-3">
        <Meter
          value={Math.min(model.weightedTokens, plan.includedWeightedTokens)}
          max={plan.includedWeightedTokens || 1}
          tone="primary"
          label={`${plan.name} weighted-token allowance`}
          caption={`${formatCompactNumber(model.weightedTokens)} of ${formatCompactNumber(plan.includedWeightedTokens)} used`}
        />
        <Meter
          value={Math.min(compute.billedComputeHours, plan.includedComputeHours)}
          max={plan.includedComputeHours || 1}
          tone="ember"
          label="Compute-hour allowance"
          caption={`${compute.billedComputeHours.toFixed(1)} of ${plan.includedComputeHours} h used`}
        />
      </div>

      <dl className="mt-4 divide-y divide-line border-t border-line">
        <Row
          label={`${plan.name} subscription`}
          value={formatMicroUsd(plan.priceMicroUsdMonthly)}
        />
        <Row
          label="Model overage"
          value={formatMicroUsd(model.chargedMicroUsd)}
          hint={
            model.overageWeighted > 0
              ? `${formatCompactNumber(model.overageWeighted)} weighted tokens past the allowance`
              : 'Covered by the plan'
          }
        />
        <Row
          label="Compute overage"
          value={formatMicroUsd(compute.chargedMicroUsd)}
          hint={
            compute.overageHours > 0
              ? `${compute.overageHours.toFixed(1)} h past the allowance`
              : 'Covered by the plan'
          }
        />
      </dl>

      <div className="mt-3 flex items-baseline justify-between gap-3 rounded-md bg-ember-soft px-3 py-2.5">
        <span className="text-[13px] font-medium text-ember-soft-fg">Estimated per month</span>
        <span className="karo-numeric text-lg font-semibold text-ember-soft-fg">
          {formatMicroUsd(total)}
        </span>
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-subtle">
        An estimate, not a quote — real usage varies with how large your files are and how often
        the agent has to retry. You are billed for what actually ran, itemised per request.
      </p>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-[13px] text-muted">
        {label}
        {hint ? <span className="block text-[11px] text-subtle">{hint}</span> : null}
      </dt>
      <dd className="karo-numeric shrink-0 text-[13px] font-medium text-fg">{value}</dd>
    </div>
  );
}
