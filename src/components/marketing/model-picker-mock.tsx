'use client';

import { Check, KeyRound } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { deriveMultipliers } from '@/lib/pricing/weighted-tokens';
import { cn, formatCompactNumber } from '@/lib/utils';

import type { ModelPriceView } from './plan-view';

/* ------------------------------------------------------------------ *
 *  Model picker mock
 *
 *  A working replica of the picker in the workspace: choosing a model
 *  recomputes the weighted-token multipliers from that model's *current*
 *  price sheet, which is the whole point of the unit. Prices arrive as
 *  props from the catalogue — nothing here is hard-coded.
 * ------------------------------------------------------------------ */

function usdPerMtok(microUsd: number): string {
  if (microUsd <= 0) return 'free';
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

export function ModelPickerMock({
  models,
  className,
}: {
  models: readonly ModelPriceView[];
  className?: string;
}) {
  const [selected, setSelected] = React.useState(
    () => models.find((model) => model.inputMicroUsdPerMtok > 0)?.slug ?? models[0]?.slug ?? '',
  );

  const active = models.find((model) => model.slug === selected) ?? models[0];

  if (!active) {
    return (
      <div className={cn('rounded-lg border border-line bg-surface p-4', className)}>
        <p className="text-[13px] text-muted">
          The model catalogue is unavailable right now. Sign in to see the models enabled for
          your team.
        </p>
      </div>
    );
  }

  const { multipliers, estimated } = deriveMultipliers(active);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-line bg-surface shadow-md',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-subtle uppercase">
          Model
        </span>
        <span className="ml-auto font-mono text-[10.5px] text-subtle">
          {models.length} available
        </span>
      </div>

      <ul
        role="listbox"
        aria-label="Model catalogue"
        className="max-h-64 overflow-y-auto p-1.5"
      >
        {models.map((model) => {
          const isActive = model.slug === active.slug;
          return (
            <li key={model.slug}>
              <button
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => setSelected(model.slug)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-150 ease-[var(--k-ease)]',
                  isActive ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
              >
                <Check
                  className={cn('size-3.5 shrink-0', isActive ? 'text-primary' : 'opacity-0')}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">
                    {model.displayName}
                  </span>
                  <span className="block truncate text-[11px] text-subtle">
                    {formatCompactNumber(model.contextWindow, 0)} context ·{' '}
                    {usdPerMtok(model.inputMicroUsdPerMtok)} in ·{' '}
                    {usdPerMtok(model.outputMicroUsdPerMtok)} out per Mtok
                  </span>
                </span>
                {model.inputMicroUsdPerMtok === 0 ? (
                  <Badge variant="neutral" size="sm">
                    demo
                  </Badge>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line bg-bg-inset p-3">
        <p className="text-[11px] font-semibold tracking-[0.1em] text-subtle uppercase">
          Weighted-token multipliers
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
          {(
            [
              ['Input', multipliers.input],
              ['Output', multipliers.output],
              ['Cached in', multipliers.cachedInput],
              ['Cache write', multipliers.cacheWrite],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-2">
              <dt className="text-[11.5px] text-muted">{label}</dt>
              <dd className="karo-numeric text-[12px] font-medium text-fg">×{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-subtle">
          {estimated
            ? 'This model has no published input price, so documented fallback ratios are used and every charge is flagged as estimated.'
            : 'Derived from this model’s current price sheet. When the catalogue refreshes, the multipliers move with it — your plan allowance never has to be renegotiated.'}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-primary">
          <KeyRound className="size-3.5" aria-hidden="true" />
          Bring your own key and these tokens are billed by your provider, not by Karo.
        </p>
      </div>
    </div>
  );
}
