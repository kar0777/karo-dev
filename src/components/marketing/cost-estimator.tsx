'use client';

import { KeyRound } from 'lucide-react';
import * as React from 'react';

import { Label } from '@/components/ui/label';
import { Meter } from '@/components/ui/meter';
import { SegmentedControl } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  calculateComputeMultiplier,
  SANDBOX_SIZE_PRESETS,
  usableMemoryMb,
} from '@/lib/pricing/compute';
import { settleComputeUsage, settleModelUsage } from '@/lib/pricing/calculator';
import { cn, formatCompactNumber, formatMicroUsd, formatNumber } from '@/lib/utils';

import type { ModelPriceView, PlanView } from './plan-view';

/* ------------------------------------------------------------------ *
 *  Cost estimator
 *
 *  Every number is produced by the same functions that settle a real
 *  run — `settleModelUsage`, `settleComputeUsage`,
 *  `calculateComputeMultiplier`. Plans and model prices arrive as props
 *  from the database, so nothing here can drift from what is charged.
 * ------------------------------------------------------------------ */

/**
 * Token mix of a typical agentic workload. Shown to the reader rather than
 * hidden, because it is the single biggest lever on the estimate: agent loops
 * are read-heavy and cache a lot of that reading.
 */
const MIX = { input: 0.7, cached: 0.2, output: 0.1 } as const;

/** Slider positions in millions of tokens per month. */
const TOKEN_STOPS = [0.5, 1, 2, 4, 6, 10, 15, 20, 30, 45, 60, 80, 100, 150, 200];
const HOUR_STOPS = [5, 10, 20, 40, 60, 100, 150, 200, 300, 500, 750, 1_000, 1_500];

function stopAt(stops: readonly number[], index: number): number {
  return stops[Math.min(Math.max(index, 0), stops.length - 1)] ?? stops[0] ?? 0;
}

/** Savings under this are noise; never churn the selection for them. */
const AUTO_SWITCH_EPSILON_MICRO_USD = 1_000_000;

export type CostEstimatorProps = {
  plans: readonly PlanView[];
  models: readonly ModelPriceView[];
  computeUpstreamMicroUsdPerBaseHour: number;
  className?: string;
};

export function CostEstimator({
  plans,
  models,
  computeUpstreamMicroUsdPerBaseHour,
  className,
}: CostEstimatorProps) {
  const pricedModels = models.filter((model) => model.inputMicroUsdPerMtok > 0);
  const usableModels = pricedModels.length > 0 ? pricedModels : models;

  const [planKey, setPlanKey] = React.useState(
    () => plans.find((plan) => plan.highlight)?.key ?? plans[0]?.key ?? '',
  );
  const [modelSlug, setModelSlug] = React.useState(() => usableModels[0]?.slug ?? '');
  const [tokenIndex, setTokenIndex] = React.useState(5);
  const [hourIndex, setHourIndex] = React.useState(4);
  const [sizeKey, setSizeKey] = React.useState('nano');
  const [byok, setByok] = React.useState(false);

  const tokenSliderId = React.useId();
  const hourSliderId = React.useId();
  const byokId = React.useId();

  const plan = plans.find((entry) => entry.key === planKey) ?? plans[0];
  const model = usableModels.find((entry) => entry.slug === modelSlug) ?? usableModels[0];

  const totalTokens = stopAt(TOKEN_STOPS, tokenIndex) * 1_000_000;
  const wallClockHours = stopAt(HOUR_STOPS, hourIndex);

  const counts = {
    inputTokens: Math.round(totalTokens * MIX.input),
    cachedInputTokens: Math.round(totalTokens * MIX.cached),
    outputTokens: Math.round(totalTokens * MIX.output),
  };

  const prices = {
    inputMicroUsdPerMtok: model?.inputMicroUsdPerMtok ?? 0,
    outputMicroUsdPerMtok: model?.outputMicroUsdPerMtok ?? 0,
    cachedInputMicroUsdPerMtok: model?.cachedInputMicroUsdPerMtok ?? 0,
    cacheWriteMicroUsdPerMtok: model?.cacheWriteMicroUsdPerMtok ?? 0,
  };

  // Sizes the selected plan is actually allowed to run.
  const sizes = plan
    ? SANDBOX_SIZE_PRESETS.filter(
        (preset) =>
          preset.cpuCores <= plan.maxSandboxCpuCores &&
          preset.memoryMb <= plan.maxSandboxMemoryMb,
      )
    : [];
  const size =
    sizes.find((preset) => preset.key === sizeKey) ?? sizes[0] ?? SANDBOX_SIZE_PRESETS[0]!;

  const multiplier = calculateComputeMultiplier({
    cpuCores: size.cpuCores,
    memoryMb: size.memoryMb,
  });
  const billedHours = Math.round(wallClockHours * multiplier.value * 10_000) / 10_000;

  /**
   * The same settlement run for any plan, holding the usage fixed. This is
   * what powers the auto-switch: without a cross-plan comparison the
   * estimator happily quoted a selected Lite plan at $1,790/month for usage
   * that costs $690 on Ultra.
   */
  const estimateForPlan = (candidate: PlanView) => {
    const planConfig = {
      tier: candidate.tier,
      marginBps: candidate.marginBps,
      includedWeightedTokens: candidate.includedWeightedTokens,
      includedComputeHours: candidate.includedComputeHours,
      overageMicroUsdPerMWeighted: candidate.overageMicroUsdPerMWeighted,
      overageMicroUsdPerComputeHour: candidate.overageMicroUsdPerComputeHour,
    };
    const modelSettlement = settleModelUsage({
      counts,
      prices,
      plan: planConfig,
      quotaRemainingWeighted: candidate.includedWeightedTokens,
      usedByok: byok,
    });
    const computeSettlement = settleComputeUsage({
      billedComputeHours: billedHours,
      upstreamMicroUsdPerBaseHour: computeUpstreamMicroUsdPerBaseHour,
      plan: planConfig,
      quotaRemainingHours: candidate.includedComputeHours,
    });
    return {
      plan: candidate,
      modelSettlement,
      computeSettlement,
      total:
        candidate.priceMicroUsdMonthly +
        modelSettlement.chargedMicroUsd +
        computeSettlement.chargedMicroUsd,
    };
  };

  const selected = plan ? estimateForPlan(plan) : null;
  const ranked = plans.map(estimateForPlan).sort((a, b) => a.total - b.total);
  const best = ranked[0] ?? null;

  // Auto-switch at the crossover. Crossing the threshold where a bigger plan
  // becomes cheaper is exactly when a reader is least likely to run the
  // comparison themselves — the $5 plan quoting four figures is the failure
  // mode this exists to prevent. Derived during render (state follows the
  // numbers) rather than in an effect, so no intermediate frame shows the
  // dominated plan.
  const [switchNote, setSwitchNote] = React.useState<{ name: string; saved: number } | null>(
    null,
  );
  const [seenBestKey, setSeenBestKey] = React.useState<string | null>(null);
  if (selected && best && best.plan.key !== planKey && seenBestKey !== best.plan.key) {
    const saved = selected.total - best.total;
    if (saved >= AUTO_SWITCH_EPSILON_MICRO_USD) {
      setSeenBestKey(best.plan.key);
      setPlanKey(best.plan.key);
      setSwitchNote({ name: best.plan.name, saved });
    } else {
      // Keep the best-seen marker in sync so the switch fires the moment the
      // threshold is crossed rather than a render later.
      setSeenBestKey(best.plan.key);
    }
  }

  if (!plan || !model || !selected) {
    return (
      <div className={cn('rounded-lg border border-line bg-surface p-5', className)}>
        <p className="text-[13px] text-muted">
          The estimator needs the plan and model catalogue, which is unavailable right now.
          Refresh in a moment, or read the worked examples above — the arithmetic is the same.
        </p>
      </div>
    );
  }

  const { modelSettlement, computeSettlement, total } = selected;

  return (
    <div className={cn('grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]', className)}>
      <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5">
        <div>
          <p className="mb-2 text-[12px] font-medium text-fg">Plan</p>
          <SegmentedControl
            options={plans.map((entry) => ({ value: entry.key, label: entry.name }))}
            value={plan.key}
            onValueChange={(value) => {
              setPlanKey(value);
              setSwitchNote(null);
            }}
            size="sm"
            aria-label="Plan"
            className="flex-wrap"
          />
          {switchNote ? (
            <p className="mt-1.5 text-[11.5px] leading-snug text-primary">
              Switched to {switchNote.name} — {formatMicroUsd(switchNote.saved)} cheaper per
              month at this usage. Pick another plan above to compare by hand.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="estimator-model" className="text-[12px]">
              Model
            </Label>
            <Select value={model.slug} onValueChange={setModelSlug}>
              <SelectTrigger id="estimator-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {usableModels.map((entry) => (
                  <SelectItem key={entry.slug} value={entry.slug}>
                    {entry.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="estimator-size" className="text-[12px]">
              Sandbox size
            </Label>
            <Select value={size.key} onValueChange={setSizeKey}>
              <SelectTrigger id="estimator-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((preset) => (
                  <SelectItem key={preset.key} value={preset.key}>
                    {preset.label} — {preset.cpuCores} vCPU · {formatNumber(preset.memoryMb)} MB
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label htmlFor={tokenSliderId} className="text-[12px]">
              Model tokens per month
            </Label>
            <span className="karo-numeric text-[12.5px] font-medium text-fg">
              {formatCompactNumber(totalTokens)}
            </span>
          </div>
          <Slider
            id={tokenSliderId}
            className="mt-2.5"
            min={0}
            max={TOKEN_STOPS.length - 1}
            step={1}
            value={[tokenIndex]}
            onValueChange={([next]) => setTokenIndex(next ?? tokenIndex)}
            aria-label="Model tokens per month"
          />
          <p className="mt-1.5 text-[11.5px] text-subtle">
            Split {Math.round(MIX.input * 100)}% input / {Math.round(MIX.cached * 100)}% cached
            read / {Math.round(MIX.output * 100)}% output — the usual shape of an agent loop.
          </p>
        </div>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label htmlFor={hourSliderId} className="text-[12px]">
              Sandbox hours per month
            </Label>
            <span className="karo-numeric text-[12.5px] font-medium text-fg">
              {formatNumber(wallClockHours)} h
            </span>
          </div>
          <Slider
            id={hourSliderId}
            className="mt-2.5"
            min={0}
            max={HOUR_STOPS.length - 1}
            step={1}
            value={[hourIndex]}
            onValueChange={([next]) => setHourIndex(next ?? hourIndex)}
            aria-label="Sandbox hours per month"
          />
          <p className="mt-1.5 text-[11.5px] text-subtle">
            Wall-clock time awake. {multiplier.explanation} — {formatNumber(billedHours, 2)}{' '}
            compute hours billed. About {formatNumber(usableMemoryMb(size.memoryMb))} MB of that
            RAM reaches your processes.
          </p>
        </div>

        <div className="flex items-start gap-2.5 rounded-md border border-line bg-bg-inset p-3">
          <Switch id={byokId} checked={byok} onCheckedChange={setByok} />
          <div className="min-w-0">
            <Label htmlFor={byokId} className="flex items-center gap-1.5 text-[12.5px]">
              <KeyRound className="size-3.5 text-primary" aria-hidden="true" />
              Bring my own model key
            </Label>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-subtle">
              Model tokens are then billed by your provider and never draw down your Karo
              allowance. Compute and storage are still Karo&apos;s.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">
            Estimated monthly cost
          </p>
          <p className="karo-numeric mt-1 text-4xl leading-none font-semibold text-ember">
            {formatMicroUsd(total)}
          </p>
          <p className="mt-1.5 text-[12px] text-subtle">
            {plan.name} on {model.displayName}
            {byok ? ' with your own key' : ''}
          </p>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <Meter
            value={Math.min(modelSettlement.weightedTokens, plan.includedWeightedTokens)}
            max={plan.includedWeightedTokens || 1}
            tone="primary"
            label="Included weighted tokens"
            caption={`${formatCompactNumber(modelSettlement.weightedTokens)} of ${formatCompactNumber(plan.includedWeightedTokens)}`}
          />
          <Meter
            value={Math.min(billedHours, plan.includedComputeHours)}
            max={plan.includedComputeHours || 1}
            tone="ember"
            label="Included compute hours"
            caption={`${formatNumber(billedHours, 1)} of ${formatNumber(plan.includedComputeHours)}`}
          />
        </div>

        <dl className="divide-y divide-line border-t border-line">
          <EstimateRow label="Subscription" value={formatMicroUsd(plan.priceMicroUsdMonthly)} />
          <EstimateRow
            label="Model"
            value={formatMicroUsd(modelSettlement.chargedMicroUsd)}
            hint={modelSettlement.explanation}
          />
          <EstimateRow
            label="Compute"
            value={formatMicroUsd(computeSettlement.chargedMicroUsd)}
            hint={computeSettlement.explanation}
          />
        </dl>

        <p className="text-[11.5px] leading-relaxed text-subtle">
          Storage beyond the plan allowance and any external sandbox provider surcharge are not
          included here. This is an estimate for comparing plans, not a quote — you are billed
          for what actually ran.
        </p>
      </div>
    </div>
  );
}

function EstimateRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[13px] text-muted">{label}</dt>
        <dd className="karo-numeric shrink-0 text-[13px] font-medium text-fg">{value}</dd>
      </div>
      {hint ? <p className="mt-0.5 text-[11px] leading-snug text-subtle">{hint}</p> : null}
    </div>
  );
}
