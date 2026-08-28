'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { Check, CircleAlert, Server, Sparkles } from 'lucide-react';

import {
  RUNTIME_TARGET_META,
  RUNTIME_TARGET_OPTIONS,
  SHELL_META,
  templateIcon,
  type RuntimeTargetOption,
} from '@/components/app/meta';
import { AGENT_MODES, AGENT_MODE_META } from '@/lib/agent/policy';
import type { ModelOption, TemplateOption, WorkerOption } from '@/components/app/shell-data';
import type { CreateProjectResponse, ProjectDraft } from '@/components/app/projects/types';
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiFetch, describeError } from '@/lib/client/api';
import type { AgentMode, ShellKind } from '@/lib/db/schema';
import { cn, formatMicroUsd, formatCompactNumber, groupBy, slugify } from '@/lib/utils';

/**
 * Project creation.
 *
 * The dialog collects everything the first agent run needs — where the machine
 * runs, which model answers, what the agent is allowed to assume — because
 * asking now is cheaper than discovering halfway through a task that the
 * project points at a server that was never registered.
 */

const MAX_NAME = 80;
const MAX_DESCRIPTION = 240;

export type ProjectCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly TemplateOption[];
  models: readonly ModelOption[];
  workers: readonly WorkerOption[];
  /** Plan capability flags — a disabled target explains *why* it is disabled. */
  allowOwnServer: boolean;
  allowExternalSandbox: boolean;
  planName: string;
  defaultTemplate?: string;
  /** Lets the list render a pending card while the request is in flight. */
  onCreating?: (draft: ProjectDraft) => void;
  onCreateFailed?: () => void;
};

export function ProjectCreateDialog({
  open,
  onOpenChange,
  templates,
  models,
  workers,
  allowOwnServer,
  allowExternalSandbox,
  planName,
  defaultTemplate,
  onCreating,
  onCreateFailed,
}: ProjectCreateDialogProps) {
  const router = useRouter();

  const defaultModelId = React.useMemo(
    () => models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? null,
    [models],
  );

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [template, setTemplate] = React.useState(defaultTemplate ?? 'blank');
  const [runtimeTarget, setRuntimeTarget] = React.useState<RuntimeTargetOption>('karo_cloud');
  const [workerId, setWorkerId] = React.useState<string | null>(null);
  const [modelId, setModelId] = React.useState<string | null>(defaultModelId);
  const [agentMode, setAgentMode] = React.useState<AgentMode>('build');
  const [shell, setShell] = React.useState<ShellKind>('bash');
  const [submitting, setSubmitting] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<{ title: string; message: string } | null>(null);

  const nameId = React.useId();
  const descriptionId = React.useId();

  // Reset to a clean form whenever the dialog is re-opened, or whenever the
  // defaults it seeds from change. Adjusting during render instead of from an
  // effect means a re-opened dialog never paints the previous attempt's values
  // for a frame; the inputs are held in state so the reset still fires exactly
  // when the effect's dependencies used to change.
  const [seeded, setSeeded] = React.useState({ open, defaultTemplate, defaultModelId });
  if (
    seeded.open !== open ||
    seeded.defaultTemplate !== defaultTemplate ||
    seeded.defaultModelId !== defaultModelId
  ) {
    setSeeded({ open, defaultTemplate, defaultModelId });
    if (open) {
      setName('');
      setDescription('');
      setTemplate(defaultTemplate ?? 'blank');
      setRuntimeTarget('karo_cloud');
      setWorkerId(null);
      setModelId(defaultModelId);
      setAgentMode('build');
      setShell('bash');
      setNameError(null);
      setFailure(null);
      setSubmitting(false);
    }
  }

  const onlineWorkers = workers.filter((w) => w.status === 'online');
  const modelsByFamily = React.useMemo(
    () => groupBy(models, (m) => m.family || 'other'),
    [models],
  );

  function targetDisabledReason(target: RuntimeTargetOption): string | null {
    if (target === 'own_server') {
      if (!allowOwnServer) return `${planName} does not include bring-your-own-server.`;
      if (workers.length === 0) {
        return 'No server registered yet. Add one under API keys → Servers, then come back.';
      }
      if (onlineWorkers.length === 0)
        return 'Your registered servers are all offline right now.';
    }
    if (target === 'external_sandbox' && !allowExternalSandbox) {
      return `${planName} does not include external sandbox providers.`;
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError('Give the project a name so you can find it later.');
      document.getElementById(nameId)?.focus();
      return;
    }
    if (trimmed.length > MAX_NAME) {
      setNameError(`Keep the name to ${MAX_NAME} characters or fewer.`);
      return;
    }
    setNameError(null);
    setFailure(null);

    const draft: ProjectDraft = {
      name: trimmed,
      description: description.trim(),
      template,
      runtimeTarget,
      workerId: runtimeTarget === 'own_server' ? workerId : null,
      modelId,
      agentMode,
      shell,
    };

    setSubmitting(true);
    onCreating?.(draft);

    try {
      const response = await apiFetch<CreateProjectResponse>('/api/projects', {
        json: {
          name: draft.name,
          description: draft.description || undefined,
          template: draft.template,
          runtimeTarget: draft.runtimeTarget,
          workerId: draft.workerId ?? undefined,
          modelId: draft.modelId ?? undefined,
          agentMode: draft.agentMode,
          shell: draft.shell,
        },
      });

      onOpenChange(false);
      router.push(`/app/projects/${response.project.id}`);
    } catch (error) {
      setFailure(describeError(error));
      onCreateFailed?.();
      setSubmitting(false);
    }
  }

  const disabledReason = targetDisabledReason(runtimeTarget);
  const slugPreview = slugify(name.trim()) || 'your-project';

  return (
    <Dialog open={open} onOpenChange={submitting ? undefined : onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project is a workspace plus the machine that runs it. You can change every one of
            these later in project settings.
          </DialogDescription>
        </DialogHeader>

        <form id="new-project-form" onSubmit={handleSubmit} className="space-y-4">
          {failure ? (
            <Alert variant="danger" icon={CircleAlert}>
              <AlertTitle>{failure.title}</AlertTitle>
              <AlertDescription>
                {failure.message} Nothing was created — adjust the form and try again.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={nameId} required aside={`${name.length}/${MAX_NAME}`}>
                Project name
              </FieldLabel>
              <Input
                id={nameId}
                value={name}
                maxLength={MAX_NAME}
                autoFocus
                placeholder="Invoice parser"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={`${nameId}-hint`}
                onChange={(event) => {
                  setName(event.target.value);
                  if (nameError) setNameError(null);
                }}
              />
              {nameError ? (
                <FieldError>{nameError}</FieldError>
              ) : (
                <FieldHint id={`${nameId}-hint`}>
                  Workspace path will be{' '}
                  <span className="font-mono text-[11px]">/workspace/{slugPreview}</span>
                </FieldHint>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor={descriptionId} aside="Optional">
                Description
              </FieldLabel>
              <Input
                id={descriptionId}
                value={description}
                maxLength={MAX_DESCRIPTION}
                placeholder="Reads supplier PDFs and posts them to Xero"
                onChange={(event) => setDescription(event.target.value)}
              />
              <FieldHint>
                Shown on the project card and given to the agent as context.
              </FieldHint>
            </Field>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-fg">Starter template</legend>
            <p className="text-xs text-subtle">
              Every template installs and runs on the first command — nothing here needs fixing
              before you start.
            </p>
            <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {templates.map((option) => {
                const Icon = templateIcon(option.icon);
                const selected = template === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setTemplate(option.key)}
                    className={cn(
                      'flex items-start gap-2.5 rounded-md border p-2.5 text-left',
                      'transition-[border-color,background-color] duration-150 ease-[var(--k-ease)]',
                      selected
                        ? 'border-primary bg-primary-soft/40'
                        : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                    )}
                  >
                    <Icon
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        selected ? 'text-primary' : 'text-subtle',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-fg">
                          {option.name}
                        </span>
                        {selected ? (
                          <Check
                            className="size-3.5 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                      <span className="karo-truncate-2 mt-0.5 block text-[11.5px] leading-snug text-muted">
                        {option.description}
                      </span>
                      <span className="mt-1 flex items-center gap-1">
                        <Badge variant="outline" size="sm">
                          {option.language}
                        </Badge>
                        {option.devPort ? (
                          <Badge variant="neutral" size="sm">
                            :{option.devPort}
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-fg">Where should it run?</legend>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {RUNTIME_TARGET_OPTIONS.map((target) => {
                const meta = RUNTIME_TARGET_META[target];
                const Icon = meta.icon;
                const reason = targetDisabledReason(target);
                const selected = runtimeTarget === target;
                return (
                  <button
                    key={target}
                    type="button"
                    aria-pressed={selected}
                    disabled={Boolean(reason)}
                    title={reason ?? undefined}
                    onClick={() => setRuntimeTarget(target)}
                    className={cn(
                      'rounded-md border p-2.5 text-left',
                      'transition-[border-color,background-color] duration-150 ease-[var(--k-ease)]',
                      'disabled:cursor-not-allowed disabled:opacity-55',
                      selected
                        ? 'border-primary bg-primary-soft/40'
                        : 'border-line bg-surface hover:border-line-strong enabled:hover:bg-surface-2',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon
                        className={cn('size-4', selected ? 'text-primary' : 'text-subtle')}
                      />
                      <span className="text-[13px] font-medium text-fg">{meta.label}</span>
                    </span>
                    <span className="mt-1 block text-[11.5px] leading-snug text-muted">
                      {meta.description}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-subtle">
              {disabledReason ?? RUNTIME_TARGET_META[runtimeTarget].requirement}
            </p>
          </fieldset>

          {runtimeTarget === 'own_server' ? (
            <Field>
              <FieldLabel htmlFor="new-project-worker" required>
                Server
              </FieldLabel>
              <Select
                value={workerId ?? ''}
                onValueChange={(value) => setWorkerId(value || null)}
              >
                <SelectTrigger id="new-project-worker">
                  <SelectValue placeholder="Pick a registered server" />
                </SelectTrigger>
                <SelectContent>
                  {workers.map((worker) => (
                    <SelectItem
                      key={worker.id}
                      value={worker.id}
                      disabled={worker.status !== 'online'}
                    >
                      <span className="flex items-center gap-1.5">
                        <Server className="size-3.5 text-subtle" aria-hidden="true" />
                        {worker.name}
                        <span className="text-subtle">
                          {worker.hostname ? `· ${worker.hostname}` : ''} ({worker.status})
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>
                Only servers whose worker is currently online can accept new projects.
              </FieldHint>
            </Field>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="new-project-model">Model</FieldLabel>
              <Select
                value={modelId ?? ''}
                onValueChange={(value) => setModelId(value || null)}
              >
                <SelectTrigger id="new-project-model">
                  <SelectValue placeholder="Use the workspace default" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(modelsByFamily).map(([family, familyModels]) => (
                    <SelectGroup key={family}>
                      <SelectLabel>{family}</SelectLabel>
                      {familyModels.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          <span className="flex w-full items-center justify-between gap-3">
                            <span className="truncate">{model.displayName}</span>
                            <span className="karo-numeric shrink-0 text-[11px] text-subtle">
                              {formatMicroUsd(model.inputMicroUsdPerMtok)}/Mtok in
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>
                {selectedModelHint(models, modelId) ??
                  'Each conversation can override this without changing the project.'}
              </FieldHint>
            </Field>

            <Field>
              <FieldLabel htmlFor="new-project-mode">Agent mode</FieldLabel>
              <Select
                value={agentMode}
                onValueChange={(value) => setAgentMode(value as AgentMode)}
              >
                <SelectTrigger id="new-project-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {AGENT_MODE_META[mode].label} — {AGENT_MODE_META[mode].short}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>{AGENT_MODE_META[agentMode].description}</FieldHint>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="new-project-shell">Shell</FieldLabel>
            <Select value={shell} onValueChange={(value) => setShell(value as ShellKind)}>
              <SelectTrigger id="new-project-shell" className="sm:max-w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SHELL_META) as ShellKind[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {SHELL_META[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldHint>{SHELL_META[shell].description}</FieldHint>
          </Field>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-project-form"
            loading={submitting}
            iconLeft={<Sparkles />}
            disabled={Boolean(disabledReason)}
          >
            {submitting ? 'Creating…' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function selectedModelHint(
  models: readonly ModelOption[],
  modelId: string | null,
): string | null {
  const model = models.find((m) => m.id === modelId);
  if (!model) return null;
  return `${formatCompactNumber(model.contextWindow)} token context · ${formatMicroUsd(
    model.inputMicroUsdPerMtok,
  )} in / ${formatMicroUsd(model.outputMicroUsdPerMtok)} out per Mtok`;
}
