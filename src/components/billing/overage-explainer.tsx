import { TrendingUp } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { formatCompactNumber, formatMicroUsd } from '@/lib/utils';

/**
 * What a request costs once the included allowance is gone.
 *
 * Two shapes exist: a published overage rate set on the plan, or cost-plus at
 * the plan's margin when no rate is published. Both are shown as an actual
 * price against a concrete quantity, not as a percentage in isolation.
 */

export interface OverageExplainerProps {
  planName: string;
  hasSubscription: boolean;
  includedWeightedTokens: number;
  quotaRemainingWeighted: number;
  overageMicroUsdPerMWeighted: number;
  overageMicroUsdPerComputeHour: number;
  marginBps: number;
}

export function OverageExplainer({
  planName,
  hasSubscription,
  includedWeightedTokens,
  quotaRemainingWeighted,
  overageMicroUsdPerMWeighted,
  overageMicroUsdPerComputeHour,
  marginBps,
}: OverageExplainerProps) {
  const publishedTokenRate = overageMicroUsdPerMWeighted > 0;
  const publishedComputeRate = overageMicroUsdPerComputeHour > 0;
  const marginPercent = Math.round(marginBps / 100);

  return (
    <section
      aria-labelledby="overage-title"
      className="rounded-lg border border-line bg-surface shadow-sm"
    >
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ember"
        >
          <TrendingUp className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 id="overage-title" className="text-sm leading-tight font-semibold text-fg">
            Usage past your allowance
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {hasSubscription
              ? `Included usage on ${planName} is spent first. Anything beyond it is billed at the rate below and drawn from your balance.`
              : `${planName} has no included allowance — every request is billed at upstream cost plus a ${marginPercent}% platform margin.`}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
        <div className="bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">
            Weighted tokens
          </dt>
          <dd className="karo-numeric mt-1 text-[13px] font-medium text-fg">
            {publishedTokenRate
              ? `${formatMicroUsd(overageMicroUsdPerMWeighted)} / 1M`
              : `Cost + ${marginPercent}%`}
          </dd>
          <dd className="mt-0.5 text-[11px] text-subtle">
            {publishedTokenRate
              ? `About ${formatMicroUsd(Math.round(overageMicroUsdPerMWeighted / 1000))} per 1,000 weighted tokens.`
              : 'Priced from the model your run used, at that model’s live rate.'}
          </dd>
        </div>

        <div className="bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">
            Compute
          </dt>
          <dd className="karo-numeric mt-1 text-[13px] font-medium text-fg">
            {publishedComputeRate
              ? `${formatMicroUsd(overageMicroUsdPerComputeHour)} / hour`
              : `Cost + ${marginPercent}%`}
          </dd>
          <dd className="mt-0.5 text-[11px] text-subtle">
            Per base compute hour — 0.25 vCPU and 512 MB. Larger sandboxes burn it faster.
          </dd>
        </div>

        <div className="bg-surface px-4 py-3">
          <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">
            Remaining now
          </dt>
          <dd className="karo-numeric mt-1 text-[13px] font-medium text-fg">
            {hasSubscription && includedWeightedTokens > 0
              ? `${formatCompactNumber(quotaRemainingWeighted)} weighted`
              : 'Balance only'}
          </dd>
          <dd className="mt-0.5 text-[11px] text-subtle">
            {hasSubscription && includedWeightedTokens > 0
              ? `of ${formatCompactNumber(includedWeightedTokens)} included this period.`
              : 'Add credit to keep runs going.'}
          </dd>
        </div>
      </dl>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
        <p className="text-[11px] text-subtle">
          Runs on your own API key (BYOK) or your own server are metered but never charged.
        </p>
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/usage">See the breakdown</Link>
        </Button>
      </footer>
    </section>
  );
}
