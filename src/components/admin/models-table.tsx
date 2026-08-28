'use client';

import { Check, History, RefreshCw, Save, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { cn, formatCompactNumber, formatDateTime } from '@/lib/utils';

/**
 * Model catalogue management.
 *
 * Prices are edited inline but never overwritten: the PATCH endpoint closes the
 * current `model_prices` row and opens a new one, which is why the drawer can
 * show a real history rather than a single mutable number.
 */

export type AdminModelPrice = {
  inputMicroUsdPerMtok: number;
  outputMicroUsdPerMtok: number;
  cachedInputMicroUsdPerMtok: number;
  cacheWriteMicroUsdPerMtok: number;
  effectiveFrom: string;
};

export type AdminModelRow = {
  id: string;
  slug: string;
  displayName: string;
  family: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsCaching: boolean;
  supportsStreaming: boolean;
  minPlanTier: string;
  isEnabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  adminOverride: Record<string, unknown> | null;
  providerKey: string;
  providerName: string;
  price: AdminModelPrice | null;
};

type SyncChange = { slug: string; displayName: string; kind: string; detail: string };

/** Micro-USD per Mtok is unreadable in a table; edit in dollars per Mtok. */
function toDollars(microUsd: number): string {
  return (microUsd / 1_000_000).toString();
}

function toMicro(dollars: string): number {
  return Math.round((Number.parseFloat(dollars) || 0) * 1_000_000);
}

export function ModelsTable({ models }: { models: AdminModelRow[] }) {
  const router = useRouter();
  const [term, setTerm] = React.useState('');
  const [scope, setScope] = React.useState<'all' | 'enabled' | 'disabled'>('all');
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [syncReport, setSyncReport] = React.useState<{
    changes: SyncChange[];
    errors: Array<{ provider: string; message: string }>;
  } | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const visible = models.filter((model) => {
    if (scope === 'enabled' && !model.isEnabled) return false;
    if (scope === 'disabled' && model.isEnabled) return false;
    if (!term.trim()) return true;
    const haystack = `${model.displayName} ${model.slug} ${model.family} ${model.providerKey}`;
    return haystack.toLowerCase().includes(term.trim().toLowerCase());
  });

  async function patch(model: AdminModelRow, body: Record<string, unknown>, message: string) {
    setSavingId(model.id);
    try {
      await apiFetch(`/api/admin/models/${model.id}`, { method: 'PATCH', json: body });
      toast.success(message, { description: model.displayName });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setSavingId(null);
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncReport(null);
    try {
      const result = await apiFetch<{
        changes: SyncChange[];
        errors: Array<{ provider: string; message: string }>;
        syncedProviders: number;
      }>('/api/admin/models/sync', { method: 'POST' });

      setSyncReport({ changes: result.changes, errors: result.errors });
      toast.success('Catalogue synced', {
        description: `${result.changes.length} change${result.changes.length === 1 ? '' : 's'} across ${result.syncedProviders} provider${result.syncedProviders === 1 ? '' : 's'}.`,
      });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setSyncing(false);
    }
  }

  const detail = models.find((model) => model.id === detailId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <Input
            aria-label="Filter models"
            placeholder="Filter by name, slug or family"
            className="pl-8"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>

        <SegmentedControl
          size="sm"
          aria-label="Model availability"
          value={scope}
          options={[
            { value: 'all', label: 'All' },
            { value: 'enabled', label: 'Enabled' },
            { value: 'disabled', label: 'Disabled' },
          ]}
          onValueChange={(value) => setScope(value as typeof scope)}
        />

        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          loading={syncing}
          iconLeft={<RefreshCw />}
          onClick={sync}
        >
          Sync from provider
        </Button>
      </div>

      {syncReport ? (
        <Alert variant={syncReport.errors.length > 0 ? 'warning' : 'success'}>
          <AlertTitle>
            {syncReport.changes.length === 0
              ? 'Catalogue already up to date'
              : `${syncReport.changes.length} catalogue change${syncReport.changes.length === 1 ? '' : 's'}`}
          </AlertTitle>
          <AlertDescription>
            {syncReport.errors.length > 0 ? (
              <ul className="mb-2 list-disc pl-4">
                {syncReport.errors.map((error) => (
                  <li key={error.provider}>
                    <span className="font-medium">{error.provider}</span>: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {syncReport.changes.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto">
                {syncReport.changes.map((change, index) => (
                  <li key={`${change.slug}-${index}`} className="flex gap-2">
                    <Badge variant="outline" size="sm">
                      {change.kind}
                    </Badge>
                    <span className="min-w-0">
                      <span className="font-medium">{change.displayName}</span> —{' '}
                      {change.detail}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span>Every model the key can reach already matches the stored catalogue.</span>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {visible.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Search}
            title="No models match"
            description={
              models.length === 0
                ? 'The catalogue is empty. Run a sync, or seed the database with `npm run db:seed`.'
                : 'Clear the filter or switch the availability toggle back to “All”.'
            }
            action={
              models.length === 0 ? (
                <Button size="sm" loading={syncing} onClick={sync}>
                  Sync now
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setTerm('');
                    setScope('all');
                  }}
                >
                  Clear filter
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="hidden md:table-cell">Provider</TableHead>
                <TableHead className="hidden lg:table-cell">Context</TableHead>
                <TableHead className="hidden xl:table-cell">Capabilities</TableHead>
                <TableHead className="hidden sm:table-cell">Min tier</TableHead>
                <TableHead className="text-right">Price / Mtok</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Default</TableHead>
                <TableHead className="w-8" aria-label="Details" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((model) => (
                <TableRow key={model.id} className={cn(!model.isEnabled && 'opacity-70')}>
                  <TableCell className="max-w-[16rem]">
                    <span className="block truncate font-medium text-fg">
                      {model.displayName}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-subtle">
                      {model.slug}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted md:table-cell">
                    {model.providerName}
                  </TableCell>
                  <TableCell className="karo-numeric hidden text-muted lg:table-cell">
                    {formatCompactNumber(model.contextWindow)}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {model.supportsTools ? (
                        <Badge variant="neutral" size="sm">
                          tools
                        </Badge>
                      ) : null}
                      {model.supportsVision ? (
                        <Badge variant="neutral" size="sm">
                          vision
                        </Badge>
                      ) : null}
                      {model.supportsCaching ? (
                        <Badge variant="neutral" size="sm">
                          cache
                        </Badge>
                      ) : null}
                      {model.adminOverride ? (
                        <Badge variant="ember" size="sm">
                          pinned
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" size="sm">
                      {model.minPlanTier}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <InlinePrice
                      model={model}
                      saving={savingId === model.id}
                      onSave={(prices) => patch(model, { prices }, 'New price recorded')}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`${model.isEnabled ? 'Disable' : 'Enable'} ${model.displayName}`}
                      checked={model.isEnabled}
                      disabled={savingId === model.id}
                      onCheckedChange={(next) =>
                        patch(
                          model,
                          { isEnabled: next },
                          next ? 'Model enabled' : 'Model disabled',
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      aria-label={`Make ${model.displayName} the default model`}
                      checked={model.isDefault}
                      disabled={savingId === model.id || !model.isEnabled}
                      onCheckedChange={(next) =>
                        patch(
                          model,
                          { isDefault: next },
                          next ? 'Default model changed' : 'No longer the default',
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Price history and overrides for ${model.displayName}`}
                      onClick={() => setDetailId(model.id)}
                    >
                      <History />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ModelDrawer model={detail} onClose={() => setDetailId(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Inline price editing
 * ------------------------------------------------------------------ */

function InlinePrice({
  model,
  saving,
  onSave,
}: {
  model: AdminModelRow;
  saving: boolean;
  onSave: (prices: {
    inputMicroUsdPerMtok: number;
    outputMicroUsdPerMtok: number;
    cachedInputMicroUsdPerMtok: number;
    cacheWriteMicroUsdPerMtok: number;
  }) => void;
}) {
  // Outside an edit the two figures are nothing but a reading of the stored
  // price, so they are derived during render instead of being mirrored into
  // state and resynced from an effect. The draft — `null` when the cell is not
  // being edited — is the only thing that genuinely belongs to this component,
  // and keeping it separate is also what lets a half-typed edit survive the
  // `router.refresh()` that a sibling row's save triggers.
  const [draft, setDraft] = React.useState<{ input: string; output: string } | null>(null);

  const input = toDollars(model.price?.inputMicroUsdPerMtok ?? 0);
  const output = toDollars(model.price?.outputMicroUsdPerMtok ?? 0);

  if (!draft) {
    return (
      <button
        type="button"
        className="karo-numeric rounded-sm px-1 text-right text-[12.5px] text-fg hover:bg-surface-2"
        onClick={() => setDraft({ input, output })}
        aria-label={`Edit price for ${model.displayName}`}
      >
        <span className="block">${input} in</span>
        <span className="block text-[11px] text-subtle">${output} out</span>
      </button>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        aria-label="Input price per million tokens, USD"
        inputSize="sm"
        type="number"
        step="0.01"
        className="w-20"
        value={draft.input}
        onChange={(event) => setDraft({ ...draft, input: event.target.value })}
      />
      <Input
        aria-label="Output price per million tokens, USD"
        inputSize="sm"
        type="number"
        step="0.01"
        className="w-20"
        value={draft.output}
        onChange={(event) => setDraft({ ...draft, output: event.target.value })}
      />
      <Button
        variant="primary"
        size="icon-sm"
        aria-label="Save price"
        loading={saving}
        onClick={() => {
          onSave({
            inputMicroUsdPerMtok: toMicro(draft.input),
            outputMicroUsdPerMtok: toMicro(draft.output),
            cachedInputMicroUsdPerMtok: model.price?.cachedInputMicroUsdPerMtok ?? 0,
            cacheWriteMicroUsdPerMtok: model.price?.cacheWriteMicroUsdPerMtok ?? 0,
          });
          setDraft(null);
        }}
      >
        <Check />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Cancel price edit"
        onClick={() => setDraft(null)}
      >
        <X />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Detail drawer
 * ------------------------------------------------------------------ */

type PriceHistoryRow = {
  id: string;
  inputMicroUsdPerMtok: number;
  outputMicroUsdPerMtok: number;
  cachedInputMicroUsdPerMtok: number;
  cacheWriteMicroUsdPerMtok: number;
  source: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

function ModelDrawer({ model, onClose }: { model: AdminModelRow | null; onClose: () => void }) {
  const router = useRouter();
  const [history, setHistory] = React.useState<PriceHistoryRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [override, setOverride] = React.useState(() =>
    model?.adminOverride ? JSON.stringify(model.adminOverride, null, 2) : '',
  );
  const [overrideError, setOverrideError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // The drawer stays mounted across models, so opening a different one has to
  // reload the override editor and throw away the previous model's history. That
  // adjustment happens during render rather than in the effect below: React
  // re-runs this component before painting, so the panel never shows one model's
  // price history or pinned JSON under another model's name. Closing the drawer
  // (model becomes null) leaves the state alone so the exit animation does not
  // show a half-reset panel. The effect keeps only the fetch, which is real
  // synchronisation with an external system.
  const [seenModel, setSeenModel] = React.useState(model);
  if (model !== seenModel) {
    setSeenModel(model);
    if (model) {
      setOverride(model.adminOverride ? JSON.stringify(model.adminOverride, null, 2) : '');
      setOverrideError(null);
      setHistory(null);
      setError(null);
    }
  }

  React.useEffect(() => {
    if (!model) return;

    let cancelled = false;
    apiFetch<{ history: PriceHistoryRow[] }>(`/api/admin/models/${model.id}`)
      .then((result) => {
        if (!cancelled) setHistory(result.history);
      })
      .catch((caught) => {
        if (!cancelled) setError(describeError(caught).message);
      });

    return () => {
      cancelled = true;
    };
  }, [model]);

  async function saveOverride() {
    if (!model) return;
    let parsed: Record<string, unknown> | null = null;
    const trimmed = override.trim();
    if (trimmed) {
      try {
        const value: unknown = JSON.parse(trimmed);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          setOverrideError(
            'The override must be a JSON object, e.g. {"displayName":"Custom"}.',
          );
          return;
        }
        parsed = value as Record<string, unknown>;
      } catch {
        setOverrideError('That is not valid JSON. Fix the syntax and save again.');
        return;
      }
    }

    setOverrideError(null);
    setBusy(true);
    try {
      await apiFetch(`/api/admin/models/${model.id}`, {
        method: 'PATCH',
        json: { adminOverride: parsed },
      });
      toast.success(parsed ? 'Override pinned' : 'Override cleared', {
        description: parsed
          ? 'These fields now survive catalogue syncs.'
          : 'The next sync will refresh this model from the provider.',
      });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={model !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-[min(32rem,calc(100vw-1.5rem))] p-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle className="truncate">{model?.displayName ?? 'Model'}</SheetTitle>
          <p className="truncate font-mono text-[11px] text-muted">{model?.slug}</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          <section className="py-4">
            <h3 className="mb-2 text-[11px] font-medium tracking-wide text-subtle uppercase">
              Price history
            </h3>
            {error ? (
              <Alert variant="danger">
                <AlertTitle>Could not load history</AlertTitle>
                <AlertDescription>
                  {error} Close and reopen the panel to retry.
                </AlertDescription>
              </Alert>
            ) : history === null ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-[12px] text-muted">
                No price has been recorded for this model yet. Set one inline in the table, or
                run a catalogue sync.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-md border border-line">
                {history.map((row) => (
                  <li key={row.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="karo-numeric block text-[12.5px] text-fg">
                        ${toDollars(row.inputMicroUsdPerMtok)} in · $
                        {toDollars(row.outputMicroUsdPerMtok)} out
                      </span>
                      <span className="block text-[11px] text-subtle">
                        {formatDateTime(row.effectiveFrom)} →{' '}
                        {row.effectiveTo ? formatDateTime(row.effectiveTo) : 'now'}
                      </span>
                    </span>
                    <Badge variant={row.effectiveTo ? 'neutral' : 'primary'} size="sm">
                      {row.effectiveTo ? row.source : 'current'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-t border-line py-4">
            <Field>
              <FieldLabel htmlFor="model-override">Admin override</FieldLabel>
              <Textarea
                id="model-override"
                mono
                rows={6}
                value={override}
                aria-invalid={overrideError ? true : undefined}
                placeholder={'{\n  "displayName": "Claude Sonnet (internal)"\n}'}
                onChange={(event) => setOverride(event.target.value)}
              />
              <FieldHint>
                A JSON object of model fields to pin. Anything listed here wins over the
                provider catalogue on every sync. Add a `prices` key to freeze the price as
                well. Leave empty to let the catalogue drive everything.
              </FieldHint>
              {overrideError ? (
                <p role="alert" className="text-xs text-danger">
                  {overrideError}
                </p>
              ) : null}
            </Field>

            <Button
              size="sm"
              className="mt-3"
              iconLeft={<Save />}
              loading={busy}
              onClick={saveOverride}
            >
              Save override
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
