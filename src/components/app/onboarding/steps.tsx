'use client';

import * as React from 'react';

import { Building2, Check, Compass, Cpu, Eye, Server, Sparkles, UserRound } from 'lucide-react';

import {
  RUNTIME_TARGET_META,
  RUNTIME_TARGET_OPTIONS,
  templateIcon,
} from '@/components/app/meta';
import type { OnboardingState, OnboardingUsage } from '@/components/app/onboarding/types';
import type {
  ModelOption,
  PlanOption,
  TemplateOption,
  WorkerOption,
} from '@/components/app/shell-data';
import { Badge } from '@/components/ui/badge';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AGENT_PERMISSION_META,
  type AgentPermissionKey,
  type AgentPermissions,
} from '@/lib/agent/policy';
import { cn, formatCompactNumber, formatHours, formatMicroUsd, groupBy } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  Shared chrome
 * ------------------------------------------------------------------ */

type ChoiceProps = {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title: React.ReactNode;
  description: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  footer?: React.ReactNode;
  className?: string;
};

/** The one card shape every choice step uses, so selection reads identically. */
function Choice({
  selected,
  onSelect,
  disabled = false,
  title,
  description,
  icon: Icon,
  footer,
  className,
}: ChoiceProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex h-full flex-col gap-1.5 rounded-lg border p-3.5 text-left',
        'transition-[border-color,background-color,box-shadow] duration-150 ease-[var(--k-ease)]',
        'disabled:cursor-not-allowed disabled:opacity-55',
        selected
          ? 'border-primary bg-primary-soft/35 shadow-sm'
          : 'border-line bg-surface enabled:hover:border-line-strong enabled:hover:bg-surface-2',
        className,
      )}
    >
      <span className="flex items-start gap-2">
        {Icon ? (
          <Icon
            className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-primary' : 'text-subtle')}
            aria-hidden="true"
          />
        ) : null}
        <span className="flex-1 text-[13px] font-medium text-fg">{title}</span>
        {selected ? (
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        ) : null}
      </span>
      <span className="text-[12px] leading-snug text-muted">{description}</span>
      {footer ? <span className="mt-auto pt-1.5">{footer}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 *  1 — Usage
 * ------------------------------------------------------------------ */

const USAGE_CHOICES: ReadonlyArray<{
  value: OnboardingUsage;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  effect: string;
}> = [
  {
    value: 'personal',
    icon: UserRound,
    title: 'On my own',
    description: 'Side projects, prototypes, automating things you keep doing by hand.',
    effect: 'Defaults to Build mode with auto-approved commands and one sandbox at a time.',
  },
  {
    value: 'team',
    icon: Building2,
    title: 'With my team',
    description: 'Shared projects, several people in the same workspace, reviewed changes.',
    effect: 'Defaults to reviewing every file change and keeps a fuller audit trail.',
  },
  {
    value: 'evaluating',
    icon: Compass,
    title: 'Just looking around',
    description: 'Working out whether an agent with a real computer is useful to you.',
    effect: 'Starts read-heavy and conservative — nothing is written without you saying so.',
  },
];

export function UsageStep({
  value,
  onChange,
}: {
  value: OnboardingUsage | null;
  onChange: (usage: OnboardingUsage) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="How do you want to use Karo?"
      className="grid gap-2.5 sm:grid-cols-3"
    >
      {USAGE_CHOICES.map((choice) => (
        <Choice
          key={choice.value}
          selected={value === choice.value}
          onSelect={() => onChange(choice.value)}
          icon={choice.icon}
          title={choice.title}
          description={choice.description}
          footer={
            <span className="block text-[11px] leading-snug text-subtle">{choice.effect}</span>
          }
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  2 — Plan
 * ------------------------------------------------------------------ */

export function PlanStep({
  plans,
  value,
  onChange,
}: {
  plans: readonly PlanOption[];
  value: string | null;
  onChange: (planKey: string | null) => void;
}) {
  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Choose a plan"
        className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
      >
        {plans.map((plan) => (
          <Choice
            key={plan.id}
            selected={value === plan.key}
            onSelect={() => onChange(plan.key)}
            title={
              <span className="flex items-center gap-1.5">
                {plan.name}
                {plan.highlight ? (
                  <Badge variant="primary" size="sm">
                    Popular
                  </Badge>
                ) : null}
              </span>
            }
            description={plan.tagline || 'No description set for this plan.'}
            footer={
              <span className="block space-y-1">
                <span className="karo-numeric block text-[13px] font-semibold text-fg">
                  {plan.priceMicroUsdMonthly > 0
                    ? `${formatMicroUsd(plan.priceMicroUsdMonthly)}/mo`
                    : 'Usage-based'}
                </span>
                <span className="block text-[11px] text-subtle">
                  {plan.includedWeightedTokens > 0
                    ? `${formatCompactNumber(plan.includedWeightedTokens)} weighted tokens · ${formatHours(
                        plan.includedComputeHours,
                      )} compute`
                    : 'You pay only for what you use'}
                </span>
                <span className="block text-[11px] text-subtle">
                  {plan.maxActiveSandboxes} sandbox
                  {plan.maxActiveSandboxes === 1 ? '' : 'es'} · {plan.maxTeamMembers} seat
                  {plan.maxTeamMembers === 1 ? '' : 's'}
                </span>
              </span>
            }
          />
        ))}
        <Choice
          selected={value === null}
          onSelect={() => onChange(null)}
          icon={Eye}
          title="Decide later"
          description="Start on pay-as-you-go. No card, no commitment — top up whenever you are ready."
          footer={
            <span className="block text-[11px] text-subtle">
              You can subscribe at any time from Billing without losing anything.
            </span>
          }
        />
      </div>
      <p className="text-[12px] text-subtle">
        Choosing a paid plan here records your preference. Checkout happens in Billing when you
        are ready — nothing is charged during setup.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  3 — Model
 * ------------------------------------------------------------------ */

export function ModelStep({
  models,
  value,
  onChange,
}: {
  models: readonly ModelOption[];
  value: string | null;
  onChange: (modelId: string) => void;
}) {
  const byFamily = React.useMemo(() => groupBy(models, (m) => m.family || 'other'), [models]);

  if (models.length === 0) {
    return (
      <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-[13px] text-warning-soft-fg">
        No models are enabled yet. A platform administrator needs to sync the catalogue under
        Admin → Models — you can finish setup and pick a model later.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(byFamily).map(([family, familyModels]) => (
        <div key={family}>
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
            {family}
          </p>
          <div
            role="radiogroup"
            aria-label={`${family} models`}
            className="grid gap-2 sm:grid-cols-2"
          >
            {familyModels.map((model) => (
              <Choice
                key={model.id}
                selected={value === model.id}
                onSelect={() => onChange(model.id)}
                icon={Sparkles}
                title={
                  <span className="flex items-center gap-1.5">
                    {model.displayName}
                    {model.isDefault ? (
                      <Badge variant="primary" size="sm">
                        Default
                      </Badge>
                    ) : null}
                  </span>
                }
                description={model.description || 'No description supplied by the provider.'}
                footer={
                  <span className="karo-numeric flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
                    <span className="text-ember">
                      {formatMicroUsd(model.inputMicroUsdPerMtok)} in /{' '}
                      {formatMicroUsd(model.outputMicroUsdPerMtok)} out per Mtok
                    </span>
                    <span>{formatCompactNumber(model.contextWindow)} ctx</span>
                    {model.supportsVision ? <span>vision</span> : null}
                  </span>
                }
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  4 — Runtime
 * ------------------------------------------------------------------ */

export function RuntimeStep({
  state,
  workers,
  allowOwnServer,
  allowExternalSandbox,
  planName,
  onChange,
}: {
  state: OnboardingState;
  workers: readonly WorkerOption[];
  allowOwnServer: boolean;
  allowExternalSandbox: boolean;
  planName: string;
  onChange: (patch: Partial<OnboardingState>) => void;
}) {
  const onlineWorkers = workers.filter((w) => w.status === 'online');

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Where should your machines run?"
        className="grid gap-2.5 sm:grid-cols-3"
      >
        {RUNTIME_TARGET_OPTIONS.map((target) => {
          const meta = RUNTIME_TARGET_META[target];
          const blocked =
            (target === 'own_server' && !allowOwnServer) ||
            (target === 'external_sandbox' && !allowExternalSandbox);
          return (
            <Choice
              key={target}
              selected={state.runtimeTarget === target}
              onSelect={() => onChange({ runtimeTarget: target, workerId: null })}
              disabled={blocked}
              icon={meta.icon}
              title={meta.label}
              description={meta.description}
              footer={
                <span className="block text-[11px] leading-snug text-subtle">
                  {blocked ? `${planName} does not include this.` : meta.requirement}
                </span>
              }
            />
          );
        })}
      </div>

      {state.runtimeTarget === 'own_server' ? (
        onlineWorkers.length > 0 ? (
          <div
            role="radiogroup"
            aria-label="Choose a server"
            className="grid gap-2 sm:grid-cols-2"
          >
            {workers.map((worker) => (
              <Choice
                key={worker.id}
                selected={state.workerId === worker.id}
                onSelect={() => onChange({ workerId: worker.id })}
                disabled={worker.status !== 'online'}
                icon={Server}
                title={worker.name}
                description={`${worker.hostname ?? 'Hostname not reported'} · ${worker.status}`}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-[13px] leading-snug text-warning-soft-fg">
            No server has registered yet. Install the Karo worker on your machine from{' '}
            <span className="font-medium">API keys → Servers</span> — it dials out to Karo, so
            you never open an inbound port. Until then, pick Karo Cloud; switching later is one
            setting.
          </p>
        )
      ) : null}

      {state.runtimeTarget === 'karo_cloud' ? (
        <p className="flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[12px] leading-snug text-muted">
          <Cpu className="mt-0.5 size-3.5 shrink-0 text-ember" aria-hidden="true" />
          Compute is metered per second while the machine is awake. Sandboxes sleep
          automatically when idle and wake on your next command in about four seconds — sleeping
          costs nothing.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  5 — Project
 * ------------------------------------------------------------------ */

export function ProjectStep({
  state,
  templates,
  onChange,
  nameInputId,
}: {
  state: OnboardingState;
  templates: readonly TemplateOption[];
  onChange: (patch: Partial<OnboardingState>) => void;
  nameInputId: string;
}) {
  const quick = templates.slice(0, 3);

  return (
    <div className="max-w-xl space-y-4">
      <Field>
        <FieldLabel htmlFor={nameInputId} required>
          Project name
        </FieldLabel>
        <Input
          id={nameInputId}
          value={state.projectName}
          maxLength={80}
          autoFocus
          placeholder="Invoice parser"
          onChange={(event) => onChange({ projectName: event.target.value })}
        />
        <FieldHint>
          Used for the workspace directory and everywhere the project is listed.
        </FieldHint>
      </Field>

      <Field>
        <FieldLabel htmlFor="onboarding-project-description" aside="Optional">
          What is it for?
        </FieldLabel>
        <Textarea
          id="onboarding-project-description"
          rows={3}
          maxLength={240}
          value={state.projectDescription}
          placeholder="Reads supplier PDFs from a folder and posts the totals to our accounting API."
          onChange={(event) => onChange({ projectDescription: event.target.value })}
        />
        <FieldHint>
          The agent reads this as standing context, so one honest sentence here saves repeating
          yourself in chat.
        </FieldHint>
      </Field>

      <div>
        <p className="text-[13px] font-medium text-fg">Starting point</p>
        <p className="mt-0.5 text-[12px] text-muted">
          Pick one of the common ones now, or see all of them on the next step.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {quick.map((template) => {
            const Icon = templateIcon(template.icon);
            return (
              <Choice
                key={template.key}
                selected={state.template === template.key}
                onSelect={() => onChange({ template: template.key })}
                icon={Icon}
                title={template.name}
                description={template.language}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  6 — Template
 * ------------------------------------------------------------------ */

export function TemplateStep({
  templates,
  value,
  onChange,
}: {
  templates: readonly TemplateOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Pick a starter template"
      className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
    >
      {templates.map((template) => {
        const Icon = templateIcon(template.icon);
        return (
          <Choice
            key={template.key}
            selected={value === template.key}
            onSelect={() => onChange(template.key)}
            icon={Icon}
            title={template.name}
            description={template.description}
            footer={
              <span className="flex flex-wrap items-center gap-1">
                <Badge variant="outline" size="sm">
                  {template.language}
                </Badge>
                {template.devPort ? (
                  <Badge variant="neutral" size="sm">
                    preview :{template.devPort}
                  </Badge>
                ) : null}
                {template.tags.slice(0, 2).map((tag) => (
                  <Badge key={tag} variant="neutral" size="sm">
                    {tag}
                  </Badge>
                ))}
              </span>
            }
          />
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  7 — Permissions
 * ------------------------------------------------------------------ */

const RISK_VARIANT = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
} as const;

const PERMISSION_KEYS = Object.keys(AGENT_PERMISSION_META) as AgentPermissionKey[];

export function PermissionsStep({
  permissions,
  onChange,
}: {
  permissions: AgentPermissions;
  onChange: (permissions: AgentPermissions) => void;
}) {
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {PERMISSION_KEYS.map((key) => {
          const meta = AGENT_PERMISSION_META[key];
          const id = `permission-${key}`;
          return (
            <li key={key} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-fg"
                >
                  {meta.label}
                  <Badge variant={RISK_VARIANT[meta.risk]} size="sm">
                    {meta.risk} risk
                  </Badge>
                </label>
                <p className="mt-0.5 text-[12px] leading-snug text-muted">{meta.description}</p>
              </div>
              <Switch
                id={id}
                checked={permissions[key]}
                onCheckedChange={(checked) => onChange({ ...permissions, [key]: checked })}
                aria-describedby={`${id}-description`}
              />
              <span id={`${id}-description`} className="sr-only">
                {meta.description} Risk level: {meta.risk}.
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] leading-snug text-subtle">
        Permissions are enforced when the agent calls a tool, not by asking it to behave. A
        denied capability returns an error the agent has to work around, and every attempt is
        recorded in the audit log.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  8 — First message
 * ------------------------------------------------------------------ */

const SUGGESTED_PROMPTS: readonly string[] = [
  'Read the project files, then summarise what is here and what you would build first.',
  'Add a health endpoint with a test for it, run the test suite and show me the diff before applying.',
  'Set up linting and formatting for this project, then fix everything it reports.',
];

export function PromptStep({
  value,
  onChange,
  textareaId,
}: {
  value: string;
  onChange: (prompt: string) => void;
  textareaId: string;
}) {
  return (
    <div className="max-w-2xl space-y-3">
      <Field>
        <FieldLabel htmlFor={textareaId} required>
          Your first message
        </FieldLabel>
        <Textarea
          id={textareaId}
          rows={5}
          maxLength={2000}
          autoFocus
          value={value}
          placeholder="Describe what you want built, changed or explained."
          onChange={(event) => onChange(event.target.value)}
        />
        <FieldHint>
          Be specific about the outcome. The agent will plan, run commands on the machine and
          show you every file change before it applies.
        </FieldHint>
      </Field>

      <div>
        <p className="text-[12px] font-medium text-fg">Or start from one of these</p>
        <div className="mt-1.5 grid gap-1.5">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onChange(prompt)}
              className={cn(
                'rounded-md border px-3 py-2 text-left text-[12.5px] leading-snug',
                'transition-[border-color,background-color] duration-150 ease-[var(--k-ease)]',
                value === prompt
                  ? 'border-primary bg-primary-soft/35 text-fg'
                  : 'border-line bg-surface text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg',
              )}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
