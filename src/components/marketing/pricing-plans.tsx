'use client';

import { Check, Minus } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { SegmentedControl } from '@/components/ui/segmented';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usableMemoryMb } from '@/lib/pricing/compute';
import { cn, formatCompactNumber, formatMicroUsd, formatNumber } from '@/lib/utils';

import { PlanCard } from './plan-card';
import {
  type BillingInterval,
  formatPlanLimit,
  monthlyPriceMicroUsd,
  type PlanView,
  supportLabel,
} from './plan-view';

/* ------------------------------------------------------------------ *
 *  Pricing plans: interval toggle, cards, comparison table.
 *
 *  Every cell reads a column off the `plans` row. If an admin edits a
 *  quota, this table changes with it — there is no second copy of the
 *  tier numbers anywhere in the marketing site.
 *
 *  Several entitlement columns are deliberately absent: SSO, the
 *  dedicated worker pool, custom model routing, REST-API access, preview
 *  deployments, queue priority, the concurrent-run cap and audit
 *  retention all exist in the `plans` table and in the admin editor, but
 *  no request path reads them. Publishing a row for a limit nothing
 *  enforces sells a feature rather than describing one, so those rows
 *  belong here only once the code behind them does.
 * ------------------------------------------------------------------ */

type Row = {
  label: string;
  hint?: string;
  render: (plan: PlanView, interval: BillingInterval) => React.ReactNode;
};

type RowGroup = { title: string; rows: readonly Row[] };

function Yes() {
  return (
    <>
      <Check className="size-4 text-primary" aria-hidden="true" />
      <span className="sr-only">Included</span>
    </>
  );
}

function No() {
  return (
    <>
      <Minus className="size-4 text-subtle" aria-hidden="true" />
      <span className="sr-only">Not included</span>
    </>
  );
}

function bool(value: boolean): React.ReactNode {
  return value ? <Yes /> : <No />;
}

const GROUPS: readonly RowGroup[] = [
  {
    title: 'Price',
    rows: [
      {
        label: 'Price per month',
        render: (plan, interval) =>
          plan.priceMicroUsdMonthly === 0
            ? 'Usage only'
            : formatMicroUsd(monthlyPriceMicroUsd(plan, interval)),
      },
      {
        label: 'Billed yearly',
        render: (plan) =>
          plan.priceMicroUsdYearly === 0 ? '—' : formatMicroUsd(plan.priceMicroUsdYearly),
      },
      {
        label: 'Free trial',
        render: (plan) => (plan.trialDays > 0 ? `${plan.trialDays} days` : <No />),
      },
    ],
  },
  {
    title: 'Allowance and metering',
    rows: [
      {
        label: 'Included weighted tokens',
        hint: 'Per month, pooled across the team',
        render: (plan) =>
          plan.includedWeightedTokens > 0
            ? formatCompactNumber(plan.includedWeightedTokens)
            : 'Metered',
      },
      {
        label: 'Included compute hours',
        hint: 'At the 0.25 vCPU / 512 MB base rate',
        render: (plan) =>
          plan.includedComputeHours > 0 ? formatNumber(plan.includedComputeHours) : 'Metered',
      },
      {
        label: 'Overage per million weighted',
        render: (plan) =>
          plan.overageMicroUsdPerMWeighted > 0
            ? formatMicroUsd(plan.overageMicroUsdPerMWeighted)
            : 'Cost plus margin',
      },
      {
        label: 'Overage per compute hour',
        render: (plan) =>
          plan.overageMicroUsdPerComputeHour > 0
            ? formatMicroUsd(plan.overageMicroUsdPerComputeHour)
            : 'Cost plus margin',
      },
      {
        label: 'Platform margin',
        hint: 'Added to upstream cost when billed cost-plus',
        render: (plan) => `${(plan.marginBps / 100).toFixed(0)}%`,
      },
    ],
  },
  {
    title: 'Machines',
    rows: [
      { label: 'Active sandboxes', render: (plan) => formatNumber(plan.maxActiveSandboxes) },
      { label: 'Max vCPU per sandbox', render: (plan) => `${plan.maxSandboxCpuCores}` },
      {
        label: 'Max RAM per sandbox',
        render: (plan) => `${formatNumber(plan.maxSandboxMemoryMb)} MB`,
      },
      {
        label: 'RAM available to your processes',
        hint: 'After the agent, shell and base image',
        render: (plan) => `${formatNumber(usableMemoryMb(plan.maxSandboxMemoryMb))} MB`,
      },
      { label: 'Persistent storage', render: (plan) => `${formatNumber(plan.storageGb)} GB` },
      { label: 'Custom sandbox sizes', render: (plan) => bool(plan.allowCustomSandboxSize) },
      { label: 'Sleeps after', render: (plan) => `${plan.autoSleepMinutes} min idle` },
      { label: 'Destroyed after', render: (plan) => `${plan.autoDestroyHours} h idle` },
    ],
  },
  {
    title: 'Workspace',
    rows: [
      { label: 'Projects', render: (plan) => formatPlanLimit(plan.maxProjects) },
      { label: 'Skills', render: (plan) => formatPlanLimit(plan.maxSkills) },
      { label: 'Plugins', render: (plan) => formatPlanLimit(plan.maxPlugins) },
      { label: 'MCP servers', render: (plan) => formatPlanLimit(plan.maxMcpServers) },
      {
        label: 'Shells',
        render: (plan) => plan.allowedShells.join(', '),
      },
    ],
  },
  {
    title: 'Capabilities',
    rows: [
      { label: 'Bring your own model key', render: (plan) => bool(plan.allowByok) },
      { label: 'Bring your own server', render: (plan) => bool(plan.allowOwnServer) },
      { label: 'External sandbox provider', render: (plan) => bool(plan.allowExternalSandbox) },
      { label: 'Rootless Docker', render: (plan) => bool(plan.allowDocker) },
      { label: 'Private team skills', render: (plan) => bool(plan.allowPrivateSkills) },
    ],
  },
  {
    title: 'Team and support',
    rows: [
      { label: 'Team seats', render: (plan) => formatNumber(plan.maxTeamMembers) },
      { label: 'Support', render: (plan) => supportLabel(plan.supportLevel) },
    ],
  },
];

export function PricingPlans({ plans }: { plans: readonly PlanView[] }) {
  const [interval, setInterval] = React.useState<BillingInterval>('month');

  if (plans.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface p-5 text-[13px] text-muted">
        No public plans are configured. Contact support and we will get the catalogue back up.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: 'Yearly' },
          ]}
          value={interval}
          onValueChange={(value) => setInterval(value as BillingInterval)}
          aria-label="Billing interval"
        />
        <Badge variant="primary" size="sm">
          Yearly = 2 months free
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.key} plan={plan} interval={interval} />
        ))}
      </div>

      <div id="compare" className="scroll-mt-20">
        <h2 className="text-xl sm:text-2xl">Compare every limit</h2>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
          Every figure below is read from the plan catalogue at request time. If a number here
          disagrees with what checkout shows, checkout is right — tell us and we will fix the
          page.
        </p>

        <Table
          className="mt-5 min-w-[46rem]"
          containerClassName="rounded-lg border border-line bg-surface"
        >
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-surface">Feature</TableHead>
              {plans.map((plan) => (
                <TableHead key={plan.key} className="text-center">
                  <span className={cn(plan.highlight && 'text-primary')}>{plan.name}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {GROUPS.map((group) => (
              <React.Fragment key={group.title}>
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={plans.length + 1}
                    className="sticky left-0 bg-surface-2 text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase"
                  >
                    {group.title}
                  </TableCell>
                </TableRow>
                {group.rows.map((row) => (
                  <TableRow key={`${group.title}-${row.label}`}>
                    <TableCell className="sticky left-0 z-10 bg-surface align-top">
                      <span className="block text-[13px] text-fg">{row.label}</span>
                      {row.hint ? (
                        <span className="block text-[11px] text-subtle">{row.hint}</span>
                      ) : null}
                    </TableCell>
                    {plans.map((plan) => (
                      <TableCell key={plan.key} className="text-center">
                        <span className="karo-numeric inline-flex items-center justify-center text-[12.5px] text-muted">
                          {row.render(plan, interval)}
                        </span>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
