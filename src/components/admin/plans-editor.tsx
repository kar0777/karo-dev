'use client';

import { Plus, RotateCcw, Save, Trash2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { cn, formatCompactNumber, formatMicroUsd } from '@/lib/utils';

import {
  PLAN_SECTIONS,
  planFormSchema,
  type PlanField,
  type PlanFormValues,
} from './plan-schema';

/**
 * The plan editor — the concrete form of the "no hard-coded limits" rule.
 *
 * The form, its validation and the diff shown before saving are all generated
 * from `PLAN_SECTIONS`, so a new quota column becomes a new descriptor rather
 * than a new special case in three places.
 */

export type AdminPlan = PlanFormValues & {
  id: string;
  activeSubscriptions: number;
};

type Draft = Record<string, string | boolean>;

const NEW_PLAN_ID = '__new__';

const DEFAULT_PLAN: PlanFormValues = {
  key: '',
  tier: 'lite',
  name: '',
  tagline: '',
  description: '',
  priceMicroUsdMonthly: 0,
  priceMicroUsdYearly: 0,
  stripePriceIdMonthly: null,
  stripePriceIdYearly: null,
  includedWeightedTokens: 0,
  includedComputeHours: 0,
  maxActiveSandboxes: 1,
  maxSandboxMemoryMb: 512,
  maxSandboxCpuCores: 0.25,
  storageGb: 5,
  maxTeamMembers: 1,
  maxProjects: 10,
  maxSkills: 5,
  maxPlugins: 5,
  maxMcpServers: 3,
  maxConcurrentRuns: 1,
  queuePriority: 0,
  auditRetentionDays: 7,
  autoSleepMinutes: 15,
  autoDestroyHours: 72,
  allowByok: false,
  allowDocker: false,
  allowOwnServer: true,
  allowExternalSandbox: false,
  allowCustomSandboxSize: false,
  allowPreviewDeployments: false,
  allowPrivateSkills: false,
  allowApiAccess: false,
  allowSso: false,
  allowDedicatedWorker: false,
  allowCustomModelRouting: false,
  allowedShells: ['bash'],
  supportLevel: 'community',
  marginBps: 2000,
  overageMicroUsdPerMWeighted: 0,
  overageMicroUsdPerComputeHour: 0,
  trialDays: 0,
  isPublic: true,
  isActive: true,
  highlight: false,
  features: [],
  sortOrder: 100,
};

function toDraft(values: PlanFormValues): Draft {
  const draft: Draft = {};
  for (const section of PLAN_SECTIONS) {
    for (const field of section.fields) {
      const value = values[field.key];
      switch (field.type) {
        case 'bool':
          draft[field.key] = Boolean(value);
          break;
        case 'money':
          draft[field.key] = String((Number(value) || 0) / 1_000_000);
          break;
        case 'stringList':
          draft[field.key] = Array.isArray(value) ? value.join('\n') : '';
          break;
        default:
          draft[field.key] = value === null || value === undefined ? '' : String(value);
      }
    }
  }
  return draft;
}

function fromDraft(draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const section of PLAN_SECTIONS) {
    for (const field of section.fields) {
      const raw = draft[field.key];
      switch (field.type) {
        case 'bool':
          out[field.key] = Boolean(raw);
          break;
        case 'money':
          out[field.key] = Math.round((Number.parseFloat(String(raw)) || 0) * 1_000_000);
          break;
        case 'int':
          out[field.key] = Math.round(Number.parseFloat(String(raw)) || 0);
          break;
        case 'float':
          out[field.key] = Number.parseFloat(String(raw)) || 0;
          break;
        case 'stringList':
          out[field.key] = String(raw ?? '')
            .split(/[\n,]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
          break;
        case 'text':
          out[field.key] = String(raw ?? '').trim();
          break;
        default:
          out[field.key] = String(raw ?? '');
      }
    }
  }
  return out;
}

function displayValue(field: PlanField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field.type) {
    case 'bool':
      return value ? 'On' : 'Off';
    case 'money':
      return formatMicroUsd(Number(value), { precise: true });
    case 'int':
      return field.zeroMeansUnlimited && Number(value) === 0
        ? 'Unlimited'
        : `${formatCompactNumber(Number(value))}${field.unit ? ` ${field.unit}` : ''}`;
    case 'float':
      return `${Number(value)}${field.unit ? ` ${field.unit}` : ''}`;
    case 'stringList':
      return Array.isArray(value) ? value.join(', ') || '—' : String(value);
    default:
      return String(value);
  }
}

export function PlansEditor({ plans }: { plans: AdminPlan[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const editing =
    editingId === NEW_PLAN_ID ? null : (plans.find((plan) => plan.id === editingId) ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-muted">
          {plans.length} plan{plans.length === 1 ? '' : 's'} · every quota below is read from
          this table at runtime, never hard-coded in the product.
        </p>
        <Button size="sm" iconLeft={<Plus />} onClick={() => setEditingId(NEW_PLAN_ID)}>
          New plan
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <article
            key={plan.id}
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
          >
            <header className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-[13px] font-semibold text-fg">{plan.name}</h3>
                <p className="truncate font-mono text-[11px] text-subtle">{plan.key}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant={plan.isActive ? 'primary' : 'neutral'} size="sm">
                  {plan.isActive ? plan.tier : 'inactive'}
                </Badge>
                {plan.highlight ? (
                  <Badge variant="ember" size="sm">
                    Recommended
                  </Badge>
                ) : null}
              </div>
            </header>

            <dl className="grid grid-cols-2 gap-2 text-[12px]">
              <Summary label="Monthly" value={formatMicroUsd(plan.priceMicroUsdMonthly)} />
              <Summary label="Yearly" value={formatMicroUsd(plan.priceMicroUsdYearly)} />
              <Summary
                label="Tokens"
                value={formatCompactNumber(plan.includedWeightedTokens)}
              />
              <Summary label="Compute" value={`${plan.includedComputeHours} h`} />
              <Summary label="Sandboxes" value={String(plan.maxActiveSandboxes)} />
              <Summary label="Margin" value={`${(plan.marginBps / 100).toFixed(0)}%`} />
            </dl>

            <footer className="mt-auto flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-subtle">
                {plan.activeSubscriptions} active subscription
                {plan.activeSubscriptions === 1 ? '' : 's'}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setEditingId(plan.id)}>
                Edit
              </Button>
            </footer>
          </article>
        ))}
      </div>

      {editingId ? (
        <PlanFormDialog
          key={editingId}
          plan={editing}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] font-medium tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="karo-numeric text-[12.5px] text-fg">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Form
 * ------------------------------------------------------------------ */

function PlanFormDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: AdminPlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = React.useMemo<PlanFormValues>(() => plan ?? DEFAULT_PLAN, [plan]);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(base));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirming, setConfirming] = React.useState<Array<{
    field: PlanField;
    from: unknown;
    to: unknown;
  }> | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const set = React.useCallback((key: string, value: string | boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  function validate(): Record<string, unknown> | null {
    const payload = fromDraft(draft);
    const result = planFormSchema.safeParse(payload);
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.map(String)[0];
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      toast.error('Some values need fixing', {
        description: 'The highlighted fields are outside the allowed range.',
      });
      return null;
    }
    setErrors({});
    return result.data as Record<string, unknown>;
  }

  function review() {
    const payload = validate();
    if (!payload) return;

    const changes: Array<{ field: PlanField; from: unknown; to: unknown }> = [];
    for (const section of PLAN_SECTIONS) {
      for (const field of section.fields) {
        const from = plan ? (plan as unknown as Record<string, unknown>)[field.key] : undefined;
        const to = payload[field.key];
        if (!plan) {
          changes.push({ field, from: undefined, to });
        } else if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
          changes.push({ field, from, to });
        }
      }
    }

    if (changes.length === 0) {
      toast.info('Nothing to save', { description: 'This plan is unchanged.' });
      return;
    }
    setConfirming(changes);
  }

  async function save() {
    const payload = validate();
    if (!payload) return;

    setBusy(true);
    try {
      if (plan) {
        await apiFetch(`/api/admin/plans/${plan.id}`, { method: 'PATCH', json: payload });
        toast.success('Plan updated', {
          description: 'New subscriptions use these values from now on.',
        });
      } else {
        await apiFetch('/api/admin/plans', { method: 'POST', json: payload });
        toast.success('Plan created');
      }
      onSaved();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function remove() {
    if (!plan) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/plans/${plan.id}`, { method: 'DELETE' });
      toast.success('Plan deleted');
      onSaved();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
        <DialogContent className="flex max-h-[90dvh] w-[min(52rem,calc(100vw-1.5rem))] max-w-none flex-col p-0">
          <DialogHeader className="px-5 py-4">
            <DialogTitle>{plan ? `Edit ${plan.name}` : 'New plan'}</DialogTitle>
            <DialogDescription>
              Every field maps to a column on the `plans` table. Nothing here is duplicated in
              code.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {plan && plan.activeSubscriptions > 0 ? (
              <Alert
                variant="warning"
                className="mb-4"
                icon={<TriangleAlert className="size-4" />}
              >
                <AlertTitle>
                  {plan.activeSubscriptions} active subscription
                  {plan.activeSubscriptions === 1 ? '' : 's'} on this plan
                </AlertTitle>
                <AlertDescription>
                  Changes apply to new subscriptions only. Existing subscribers keep the quota
                  snapshot taken when they subscribed, so their limits will not move mid-cycle.
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-6">
              {PLAN_SECTIONS.map((section) => (
                <section key={section.id}>
                  <h3 className="text-[13px] font-semibold text-fg">{section.title}</h3>
                  <p className="mt-0.5 mb-3 text-[12px] text-muted">{section.description}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {section.fields.map((field) => (
                      <PlanFieldControl
                        key={field.key}
                        field={field}
                        value={draft[field.key]}
                        error={errors[field.key]}
                        onChange={(value) => set(field.key, value)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <DialogFooter className="border-t border-line px-5 py-3">
            {plan ? (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto text-danger"
                iconLeft={<Trash2 />}
                loading={deleting}
                onClick={remove}
              >
                Delete
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<RotateCcw />}
              onClick={() => {
                setDraft(toDraft(base));
                setErrors({});
              }}
            >
              Reset
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" iconLeft={<Save />} onClick={review}>
              Review changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirming ? (
        <Dialog open onOpenChange={(open) => (open ? null : setConfirming(null))}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{plan ? 'Confirm plan changes' : 'Confirm new plan'}</DialogTitle>
              <DialogDescription>
                {plan
                  ? 'These columns will change. Existing subscriptions keep their quota snapshot; only new subscriptions get these values.'
                  : 'Review the plan before it is created.'}
              </DialogDescription>
            </DialogHeader>

            <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {confirming.map(({ field, from, to }) => (
                <li key={field.key} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                  <span className="min-w-[9rem] flex-1 text-[12.5px] text-fg">
                    {field.label}
                  </span>
                  {plan ? (
                    <span className="karo-numeric text-[12px] text-subtle line-through">
                      {displayValue(field, from)}
                    </span>
                  ) : null}
                  <span className="karo-numeric text-[12px] font-medium text-primary">
                    {displayValue(field, to)}
                  </span>
                </li>
              ))}
            </ul>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                Keep editing
              </Button>
              <Button size="sm" loading={busy} onClick={save}>
                {plan ? 'Save plan' : 'Create plan'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function PlanFieldControl({
  field,
  value,
  error,
  onChange,
}: {
  field: PlanField;
  value: string | boolean | undefined;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const id = `plan-field-${field.key}`;
  const hint = field.zeroMeansUnlimited
    ? `${field.hint ?? ''} 0 means unlimited.`.trim()
    : field.hint;

  if (field.type === 'bool') {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2',
          'sm:col-span-1',
        )}
      >
        <label htmlFor={id} className="min-w-0 text-[12.5px] text-fg">
          {field.label}
          {field.hint ? (
            <span className="mt-0.5 block text-[11px] text-subtle">{field.hint}</span>
          ) : null}
        </label>
        <Switch id={id} checked={Boolean(value)} onCheckedChange={(next) => onChange(next)} />
      </div>
    );
  }

  return (
    <Field
      className={
        field.type === 'textarea' || field.type === 'stringList' ? 'sm:col-span-2' : undefined
      }
    >
      <FieldLabel htmlFor={id} aside={field.type === 'money' ? 'USD' : field.unit}>
        {field.label}
      </FieldLabel>

      {field.type === 'select' ? (
        <Select value={String(value ?? '')} onValueChange={(next) => onChange(next)}>
          <SelectTrigger id={id} aria-invalid={error ? true : undefined}>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'textarea' || field.type === 'stringList' ? (
        <Textarea
          id={id}
          rows={field.type === 'stringList' ? 3 : 3}
          value={String(value ?? '')}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={field.type === 'text' ? 'text' : 'number'}
          step={field.type === 'money' ? '0.000001' : field.type === 'float' ? '0.05' : '1'}
          inputMode={field.type === 'text' ? undefined : 'decimal'}
          value={String(value ?? '')}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      <FieldHint>{error ? null : hint}</FieldHint>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
