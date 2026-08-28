import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BASE_COMPUTE_UNIT,
  calculateComputeMultiplier,
  SANDBOX_SIZE_PRESETS,
  usableMemoryMb,
} from '@/lib/pricing/compute';
import { calculateWeightedTokens, type TokenPrices } from '@/lib/pricing/weighted-tokens';
import { formatMicroUsd, formatNumber } from '@/lib/utils';

import type { ModelPriceView } from './plan-view';
import { SpecRow } from './section';

/* ------------------------------------------------------------------ *
 *  The two units a Karo bill is written in.
 *
 *  Both explainers compute their worked example at request time with the
 *  same functions the biller uses, against the live price sheet. A
 *  number in this section is therefore never stale relative to what a
 *  run would actually be charged.
 * ------------------------------------------------------------------ */

/** One representative agent iteration. Printed so the reader can check it. */
const EXAMPLE_TURN = {
  inputTokens: 12_000,
  cachedInputTokens: 8_000,
  outputTokens: 1_400,
} as const;

export function WeightedTokenExplainer({
  model,
  prices,
}: {
  model: ModelPriceView | undefined;
  prices: TokenPrices;
}) {
  const result = calculateWeightedTokens(EXAMPLE_TURN, prices);
  const modelName = model?.displayName ?? 'the default model';

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-relaxed text-muted">
          Providers charge four different rates for what looks like one thing. Input tokens are
          the cheapest, output tokens cost several times more, a cached read is close to free,
          and writing to the cache costs a premium. Those ratios move whenever a catalogue
          refresh lands.
        </p>
        <p className="text-[15px] leading-relaxed text-muted">
          If a plan promised &ldquo;6 million tokens&rdquo;, the same allowance would be worth
          wildly different amounts of money on two different models — and would silently shrink
          every time a price changed. So a Karo plan promises{' '}
          <strong className="text-fg">weighted tokens</strong>, defined against a single anchor:
        </p>

        <p className="rounded-md border border-line-accent bg-primary-soft px-4 py-3 font-mono text-[13.5px] text-primary-soft-fg">
          1 input token = 1 weighted token
        </p>

        <p className="text-[15px] leading-relaxed text-muted">
          Every other class converts at that model&rsquo;s{' '}
          <em className="text-fg not-italic">current</em> price ratio against its input price.
          When prices move, the multipliers recompute — no plan edits, no migration, no
          renegotiated allowance.
        </p>

        <dl className="rounded-lg border border-line bg-surface p-4">
          <SpecRow label="Input" value={`×${result.multipliers.input}`} />
          <SpecRow label="Output" value={`×${result.multipliers.output}`} />
          <SpecRow label="Cached read" value={`×${result.multipliers.cachedInput}`} />
          <SpecRow label="Cache write" value={`×${result.multipliers.cacheWrite}`} />
        </dl>

        <p className="text-[13px] leading-relaxed text-subtle">
          {result.estimated
            ? 'This model publishes no input price, so documented fallback ratios are used and every charge derived from them is flagged as estimated.'
            : `Derived from the current price sheet for ${modelName}: ${formatMicroUsd(result.basisMicroUsdPerMtok)} per million input tokens.`}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[14px] font-semibold text-fg">Worked example</h3>
            <p className="mt-0.5 text-[12.5px] text-muted">
              One agent iteration on {modelName}: it re-reads its context, most of which is
              cached, and writes a short reply.
            </p>
          </div>

          <Table containerClassName="px-1 pb-1">
            <TableHeader>
              <TableRow>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Multiplier</TableHead>
                <TableHead className="text-right">Weighted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.components
                .filter((component) => component.tokens > 0)
                .map((component) => (
                  <TableRow key={component.key}>
                    <TableCell className="text-fg">{component.label}</TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      {formatNumber(component.tokens)}
                    </TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      ×{component.multiplier}
                    </TableCell>
                    <TableCell className="karo-numeric text-right font-medium text-fg">
                      {formatNumber(component.weightedTokens)}
                    </TableCell>
                  </TableRow>
                ))}
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="font-medium text-fg">
                  Charged to the allowance
                </TableCell>
                <TableCell className="karo-numeric text-right font-semibold text-primary">
                  {formatNumber(result.weightedTokens)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <p className="text-[13px] leading-relaxed text-subtle">
          Note what the cache does: 8,000 tokens of re-read context cost{' '}
          {formatNumber(
            result.components.find((component) => component.key === 'cachedInput')
              ?.weightedTokens ?? 0,
          )}{' '}
          weighted tokens instead of 8,000. Long conversations stay affordable because the agent
          is re-reading, not re-paying.
        </p>
      </div>
    </div>
  );
}

export function ComputeUnitExplainer() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-relaxed text-muted">
          Compute is metered in <strong className="text-fg">compute hours</strong>. One base
          compute hour is one hour of a machine this size:
        </p>

        <dl className="rounded-lg border border-line bg-surface p-4">
          <SpecRow label="vCPU" value={`${BASE_COMPUTE_UNIT.cpuCores} shared`} />
          <SpecRow label="RAM" value={`${formatNumber(BASE_COMPUTE_UNIT.memoryMb)} MB`} />
          <SpecRow
            label="RAM your processes see"
            value={`≈ ${formatNumber(usableMemoryMb(BASE_COMPUTE_UNIT.memoryMb))} MB`}
          />
          <SpecRow label="System disk" value={`${BASE_COMPUTE_UNIT.diskGb} GB`} />
        </dl>

        <p className="text-[15px] leading-relaxed text-muted">
          A bigger machine does not get a different price list — it burns the same budget
          faster, by a multiplier you can compute yourself:
        </p>

        <p className="rounded-md border border-line bg-bg-inset px-4 py-3 font-mono text-[13px] text-fg">
          multiplier = (vCPU ÷ {BASE_COMPUTE_UNIT.cpuCores}) × (MB ÷{' '}
          {BASE_COMPUTE_UNIT.memoryMb}) × provider
        </p>

        <p className="text-[15px] leading-relaxed text-muted">
          The provider factor is 1.0 on Karo Cloud, varies for external providers, and is
          exactly 0 on your own server — bring-your-own-server compute is metered so you can see
          it, and never charged. The multiplier is shown before a sandbox starts and again on
          every usage row, so &ldquo;100 compute hours&rdquo; is never a surprise.
        </p>

        <p className="text-[13px] leading-relaxed text-subtle">
          Sandboxes accrue compute only while awake. They sleep after the idle timeout on your
          plan and wake on the next command in about four seconds. Disk is billed as storage,
          separately, and is not part of the multiplier.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-[14px] font-semibold text-fg">Machine sizes</h3>
            <p className="mt-0.5 text-[12.5px] text-muted">
              How fast each size draws down an allowance, and what one wall-clock hour actually
              costs you in compute hours.
            </p>
          </div>

          <Table containerClassName="px-1 pb-1">
            <TableHeader>
              <TableRow>
                <TableHead>Size</TableHead>
                <TableHead className="text-right">vCPU</TableHead>
                <TableHead className="text-right">RAM</TableHead>
                <TableHead className="text-right">Usable RAM</TableHead>
                <TableHead className="text-right">Per wall-clock hour</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SANDBOX_SIZE_PRESETS.map((preset) => {
                const multiplier = calculateComputeMultiplier({
                  cpuCores: preset.cpuCores,
                  memoryMb: preset.memoryMb,
                });
                return (
                  <TableRow key={preset.key}>
                    <TableCell className="text-fg">{preset.label}</TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      {preset.cpuCores}
                    </TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      {formatNumber(preset.memoryMb)} MB
                    </TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      ≈ {formatNumber(usableMemoryMb(preset.memoryMb))} MB
                    </TableCell>
                    <TableCell className="karo-numeric text-right font-medium text-ember">
                      {multiplier.value} h
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <p className="text-[13px] leading-relaxed text-subtle">
          Worked example: a Small machine is 0.5 vCPU (×2) and 1 GB (×2), so it consumes 4
          compute hours for every hour it is awake. Ten wall-clock hours of building on Small
          costs 40 of the 100 compute hours a Pro plan includes.
        </p>
      </div>
    </div>
  );
}
