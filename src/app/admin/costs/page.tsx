import { PeriodPicker } from '@/components/admin/period-picker';
import { AdminPanel, MarginPercent, Money, SignedMoney } from '@/components/admin/primitives';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCompactNumber, formatHours, formatMicroUsd, formatPercent } from '@/lib/utils';

import { loadCosts } from '../_data/costs';
import { resolvePeriod } from '../_data/period';
import { requirePlatformAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

const VERDICT_VARIANT = {
  healthy: 'success',
  thin: 'warning',
  loss: 'danger',
} as const;

const VERDICT_COPY = {
  healthy: 'Comfortable margin at full consumption',
  thin: 'Under 20% margin if the allowance is fully used',
  loss: 'Loses money if the allowance is fully used',
} as const;

/*
 * Authorisation lives here, not only in `app/admin/layout.tsx`.
 *
 * A layout is not a security boundary in the App Router. `notFound()` thrown
 * from the layout renders the 404 shell, but the page segment beside it has
 * already been invoked and its RSC flight payload is still streamed into the
 * response — so an anonymous `curl` of this route returned 200 with the real
 * data in the body while a browser politely painted "not found". Verified
 * against the production build: /admin/costs handed out platform revenue and
 * margins, /admin/usage every team by id and name, /admin/sandboxes the fleet.
 * Each page therefore proves the caller itself.
 */
export default async function AdminCostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const period = resolvePeriod(params.days);
  const data = await loadCosts(period);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Costs"
        description={`Unit economics for the last ${period.days} days: what each model and each plan tier costs upstream against what it earned.`}
        actions={<PeriodPicker value={period.days} />}
      />

      <StatGrid columns={4}>
        <Stat
          label="Revenue"
          value={<Money microUsd={data.totals.revenueMicroUsd} />}
          caption="Prorated subscription plus metered charges"
        />
        <Stat
          label="Upstream cost"
          value={<Money microUsd={data.totals.upstreamMicroUsd} />}
          tone="ember"
          caption="Models and compute, excluding card fees"
        />
        <Stat
          label="Contribution margin"
          value={<Money microUsd={data.totals.marginMicroUsd} />}
          tone={data.totals.marginMicroUsd >= 0 ? 'primary' : 'default'}
          caption={
            data.totals.marginFraction === null
              ? 'No revenue in this window'
              : `${formatPercent(data.totals.marginFraction, 1)} of revenue`
          }
        />
        <Stat
          label="Blended token cost"
          value={formatMicroUsd(data.blendedUpstreamPerMWeighted)}
          caption="Upstream cost per 1M weighted tokens"
        />
      </StatGrid>

      <AdminPanel
        title="Per model"
        description="Upstream cost against what was charged. A negative margin here is normal for subscription traffic — that revenue is booked on the plan, not on the call — so read this together with the plan table below."
      >
        {data.byModel.length === 0 ? (
          <EmptyState
            size="sm"
            title="No model usage in this window"
            description="Nothing was metered. Widen the period, or check that runs are reaching a provider."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="hidden sm:table-cell">Provider</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Weighted</TableHead>
                <TableHead className="text-right">Cost / Mtok</TableHead>
                <TableHead className="text-right">Upstream</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byModel.map((model) => (
                <TableRow key={`${model.modelId ?? model.modelSlug}`}>
                  <TableCell className="max-w-[15rem]">
                    <span className="block truncate font-medium text-fg">
                      {model.displayName}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-subtle">
                      {model.modelSlug}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted sm:table-cell">
                    {model.providerKey}
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    {formatCompactNumber(model.calls)}
                  </TableCell>
                  <TableCell className="karo-numeric text-right">
                    {formatCompactNumber(model.weightedTokens)}
                  </TableCell>
                  <TableCell className="text-right text-muted">
                    <Money microUsd={model.upstreamPerMWeighted} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={model.upstreamMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={model.chargedMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <SignedMoney microUsd={model.marginMicroUsd} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminPanel>

      <AdminPanel
        title="Per plan tier"
        description="The honest view: subscription revenue attributed to the window, against everything those teams consumed."
      >
        {data.byTier.length === 0 ? (
          <EmptyState
            size="sm"
            title="No teams consumed anything"
            description="Once a team runs an agent or starts a sandbox its tier appears here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Teams</TableHead>
                <TableHead className="text-right">Subscription</TableHead>
                <TableHead className="text-right">Metered</TableHead>
                <TableHead className="text-right">Model cost</TableHead>
                <TableHead className="text-right">Compute cost</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.byTier.map((tier) => (
                <TableRow key={tier.tier}>
                  <TableCell className="font-medium text-fg">{tier.label}</TableCell>
                  <TableCell className="karo-numeric text-right">{tier.teams}</TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={tier.subscriptionRevenueMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={tier.meteredChargedMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right text-muted">
                    <Money microUsd={tier.modelUpstreamMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right text-muted">
                    <Money microUsd={tier.computeUpstreamMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <SignedMoney microUsd={tier.marginMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MarginPercent fraction={tier.marginFraction} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminPanel>

      <AdminPanel
        title="Compute economics"
        description={`One base compute hour costs ${formatMicroUsd(data.computeUpstreamPerBaseHour)} upstream, from the platform settings.`}
      >
        {data.compute.length === 0 ? (
          <EmptyState
            size="sm"
            title="No compute in this window"
            description="No sandbox ran long enough to produce a compute event."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Upstream</TableHead>
                <TableHead className="text-right">Charged</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.compute.map((row) => (
                <TableRow key={row.providerKey}>
                  <TableCell className="font-medium text-fg">{row.providerKey}</TableCell>
                  <TableCell className="karo-numeric text-right">
                    {formatHours(row.hours)}
                  </TableCell>
                  <TableCell className="text-right text-muted">
                    <Money microUsd={row.upstreamMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={row.chargedMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <SignedMoney microUsd={row.marginMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <MarginPercent fraction={row.marginFraction} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminPanel>

      <AdminPanel
        title="Break-even by plan"
        description="At what consumption each plan stops being profitable, using the blended upstream cost observed above. Break-even below 100% of the included allowance means a fully-consuming subscriber loses money."
      >
        {data.breakEven.length === 0 ? (
          <EmptyState
            size="sm"
            title="No paid plans"
            description="Break-even only applies to plans with a monthly price. Add one on the Plans page."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Price / month</TableHead>
                <TableHead className="text-right">Included</TableHead>
                <TableHead className="text-right">Cost at 100%</TableHead>
                <TableHead className="text-right">Margin at 100%</TableHead>
                <TableHead className="text-right">Break-even</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.breakEven.map((row) => (
                <TableRow key={row.planId}>
                  <TableCell>
                    <span className="block font-medium text-fg">{row.planName}</span>
                    <span className="block font-mono text-[11px] text-subtle">
                      {row.planKey}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={row.priceMicroUsdMonthly} />
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    {formatCompactNumber(row.includedWeightedTokens)} tok
                    <span className="block text-[11px]">
                      {formatHours(row.includedComputeHours)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money microUsd={row.fullAllowanceCostMicroUsd} />
                  </TableCell>
                  <TableCell className="text-right">
                    <SignedMoney microUsd={row.marginAtFullAllowanceMicroUsd} />
                  </TableCell>
                  <TableCell className="karo-numeric text-right">
                    {formatCompactNumber(row.breakEvenWeightedTokens)} tok
                    <span className="block text-[11px] text-subtle">
                      {row.breakEvenFractionOfAllowance === null
                        ? 'no allowance'
                        : `${formatPercent(row.breakEvenFractionOfAllowance, 0)} of allowance`}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={VERDICT_VARIANT[row.verdict]}
                      size="sm"
                      title={VERDICT_COPY[row.verdict]}
                    >
                      {row.verdict}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminPanel>

      <p className="text-[11px] leading-relaxed text-subtle">
        Break-even assumes a subscriber consumes only weighted tokens at the blended rate above;
        a subscriber who also runs sandboxes reaches it sooner. The compute-only break-even for
        each plan is {formatHours(data.breakEven[0]?.breakEvenComputeHours ?? 0)} for{' '}
        {data.breakEven[0]?.planName ?? 'the first plan'} and scales with price. Card fees are
        not included in this page — see the overview for the fully-loaded margin.
      </p>
    </div>
  );
}
