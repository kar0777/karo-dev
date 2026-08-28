'use client';

import Link from 'next/link';

import { Coins, Cpu, Gauge, Wallet } from 'lucide-react';

import type { ShellQuota } from '@/components/app/shell-data';
import { Meter } from '@/components/ui/meter';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  cn,
  formatCompactNumber,
  formatHours,
  formatMicroUsd,
  formatNumber,
  formatPercent,
} from '@/lib/utils';

/**
 * The sidebar quota block.
 *
 * On a plan it shows what is left of the included allowance; on pay-as-you-go
 * there is no allowance to show, so it shows the balance instead — an empty
 * meter reading "0 / 0" would be actively misleading.
 */

export type QuotaBlockProps = {
  quota: ShellQuota;
  planName: string;
  subscribed: boolean;
  collapsed?: boolean;
};

export function QuotaBlock({
  quota,
  planName,
  subscribed,
  collapsed = false,
}: QuotaBlockProps) {
  const tokenRatio =
    quota.weightedTokensIncluded > 0
      ? quota.weightedTokensUsed / quota.weightedTokensIncluded
      : 0;
  const computeRatio =
    quota.computeHoursIncluded > 0 ? quota.computeHoursUsed / quota.computeHoursIncluded : 0;
  const lowBalance = !subscribed && quota.balanceMicroUsd <= 0;

  if (collapsed) {
    const worst = Math.max(tokenRatio, computeRatio);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/app/usage"
            aria-label="Usage this period"
            className="flex flex-col items-center gap-1 rounded-md px-1 py-2 hover:bg-surface-2"
          >
            <Gauge
              className={cn(
                'size-4',
                lowBalance || worst > 0.95
                  ? 'text-danger'
                  : worst > 0.8
                    ? 'text-warning'
                    : 'text-subtle',
              )}
              aria-hidden="true"
            />
            <span className="karo-numeric text-[10px] text-subtle">
              {subscribed ? formatPercent(Math.min(worst, 1)) : '$'}
            </span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          {subscribed
            ? `${formatCompactNumber(quota.weightedTokensUsed)} of ${formatCompactNumber(
                quota.weightedTokensIncluded,
              )} weighted tokens used`
            : `Balance ${formatMicroUsd(quota.balanceMicroUsd)}`}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-line bg-surface-2/50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-subtle uppercase">
          This period
        </span>
        <Link
          href="/app/usage"
          className="rounded-sm text-[11px] text-muted transition-colors hover:text-fg"
        >
          Details
        </Link>
      </div>

      {subscribed ? (
        <>
          <Meter
            value={quota.weightedTokensUsed}
            max={quota.weightedTokensIncluded}
            label={
              <span className="inline-flex items-center gap-1">
                <Coins className="size-3 text-subtle" aria-hidden="true" />
                Weighted tokens
              </span>
            }
            caption={`${formatCompactNumber(quota.weightedTokensUsed)} / ${formatCompactNumber(
              quota.weightedTokensIncluded,
            )}`}
          />
          <Meter
            value={quota.computeHoursUsed}
            max={quota.computeHoursIncluded}
            tone={computeRatio > 0.8 ? undefined : 'ember'}
            label={
              <span className="inline-flex items-center gap-1">
                <Cpu className="size-3 text-subtle" aria-hidden="true" />
                Compute hours
              </span>
            }
            caption={`${formatHours(quota.computeHoursUsed)} / ${formatHours(
              quota.computeHoursIncluded,
            )}`}
          />
        </>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-fg">
              <Wallet className="size-3 text-subtle" aria-hidden="true" />
              Balance
            </span>
            <span
              className={cn(
                'karo-numeric text-[12px] font-medium',
                lowBalance ? 'text-danger' : 'text-ember',
              )}
            >
              {formatMicroUsd(quota.balanceMicroUsd)}
            </span>
          </div>
          <p className="text-[11px] leading-snug text-subtle">
            {lowBalance
              ? 'Out of credit — runs are blocked until you top up.'
              : `${planName}: you pay only for what you use.`}
          </p>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>Spent this period</span>
            <span className="karo-numeric text-ember">
              {formatMicroUsd(quota.spendMicroUsd)}
            </span>
          </div>
          <Link
            href="/app/billing"
            className="inline-flex rounded-sm text-[11px] font-medium text-primary hover:underline"
          >
            Top up balance
          </Link>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-2 text-[11px] text-muted">
        <span>Active sandboxes</span>
        <span className="karo-numeric">
          {formatNumber(quota.activeSandboxes)} / {formatNumber(quota.maxActiveSandboxes)}
        </span>
      </div>
    </div>
  );
}
