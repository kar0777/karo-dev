import { Scale } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber } from '@/lib/utils';

/**
 * Why a synthetic unit exists, what the current multipliers are, and the same
 * arithmetic applied to this team's own numbers. Quota that a user cannot
 * recompute by hand is quota they will not trust.
 */

export type ExplainerModelRow = {
  modelSlug: string;
  displayName: string;
  providerKey: string;
  multipliers: { input: number; output: number; cachedInput: number; cacheWrite: number };
  estimated: boolean;
  weightedTokens: number;
};

export type ExplainerExample = {
  modelName: string;
  components: Array<{
    label: string;
    tokens: number;
    multiplier: number;
    weightedTokens: number;
  }>;
  weightedTokens: number;
  estimated: boolean;
};

export interface WeightedTokenExplainerProps {
  models: readonly ExplainerModelRow[];
  example: ExplainerExample | null;
  rangeLabel: string;
}

export function WeightedTokenExplainer({
  models,
  example,
  rangeLabel,
}: WeightedTokenExplainerProps) {
  return (
    <section
      aria-labelledby="weighted-token-explainer-title"
      className="rounded-lg border border-line bg-surface shadow-sm"
    >
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-ember"
        >
          <Scale className="size-4" />
        </span>
        <div className="min-w-0">
          <h2
            id="weighted-token-explainer-title"
            className="text-sm leading-tight font-semibold text-fg"
          >
            How weighted tokens are counted
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Your plan allowance is denominated in{' '}
            <strong className="font-medium text-fg">weighted tokens</strong>, not raw tokens, so
            the same allowance is worth the same amount of money on every model.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-px bg-line lg:grid-cols-2">
        <div className="bg-surface p-4">
          <h3 className="text-[12px] font-medium text-fg">The rule</h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            One input token is exactly one weighted token — that is the definition of the unit.
            Every other token class converts at its current price ratio against the same
            model&rsquo;s input price, so a provider price change updates the multipliers
            automatically and no plan has to be re-priced.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-md border border-line bg-bg-inset px-3 py-2.5 text-[12px] leading-relaxed text-fg">
            {`weighted = input × 1
         + output × (output $/Mtok ÷ input $/Mtok)
         + cached input × (cached $/Mtok ÷ input $/Mtok)
         + cache write × (cache-write $/Mtok ÷ input $/Mtok)`}
          </pre>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            Models with no published input price fall back to documented ratios (output ×4,
            cached ×0.1, cache write ×1.25) and are marked <em>estimated</em>.
          </p>
        </div>

        <div className="bg-surface p-4">
          <h3 className="text-[12px] font-medium text-fg">Your numbers</h3>
          {example ? (
            <>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Worked from your actual traffic on{' '}
                <span className="font-medium text-fg">{example.modelName}</span> over the{' '}
                {rangeLabel.toLowerCase()}.
              </p>
              <ul className="mt-3 flex flex-col gap-1">
                {example.components.map((component) => (
                  <li
                    key={component.label}
                    className="karo-numeric flex items-baseline justify-between gap-3 text-[12px]"
                  >
                    <span className="text-muted">
                      {formatNumber(component.tokens)} {component.label.toLowerCase()} ×{' '}
                      {component.multiplier}
                    </span>
                    <span className="font-medium text-fg">
                      {formatNumber(component.weightedTokens)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="karo-numeric mt-2 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-[13px]">
                <span className="font-medium text-fg">Weighted tokens</span>
                <span className="font-semibold text-ember">
                  {formatNumber(example.weightedTokens)}
                </span>
              </div>
              {example.estimated ? (
                <p className="mt-2 text-[11px] text-subtle">
                  This model has no published input price, so estimated ratios were used.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              No requests in this period yet. Once the agent runs, this panel shows the exact
              arithmetic applied to your own token counts.
            </p>
          )}
        </div>
      </div>

      {models.length > 0 ? (
        <div className="border-t border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cached input</TableHead>
                <TableHead className="text-right">Cache write</TableHead>
                <TableHead className="text-right">Weighted used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={`${model.providerKey}:${model.modelSlug}`}>
                  <TableCell className="max-w-56">
                    <span className="block truncate font-medium text-fg">
                      {model.displayName}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[11px] text-subtle">
                        {model.modelSlug}
                      </span>
                      {model.estimated ? (
                        <Badge variant="warning" size="sm">
                          Estimated
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    ×{model.multipliers.input}
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-fg">
                    ×{model.multipliers.output}
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    ×{model.multipliers.cachedInput}
                  </TableCell>
                  <TableCell className="karo-numeric text-right text-muted">
                    ×{model.multipliers.cacheWrite}
                  </TableCell>
                  <TableCell className="karo-numeric text-right font-medium text-fg">
                    {formatNumber(model.weightedTokens)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  );
}
