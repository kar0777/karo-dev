'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { ArrowLeft, ArrowRight, Check, CircleAlert, Rocket } from 'lucide-react';

import {
  ModelStep,
  PermissionsStep,
  ProjectStep,
  PlanStep,
  PromptStep,
  RuntimeStep,
  TemplateStep,
  UsageStep,
} from '@/components/app/onboarding/steps';
import {
  ONBOARDING_STEPS,
  type OnboardingState,
  type OnboardingStepId,
} from '@/components/app/onboarding/types';
import type { CreateProjectResponse } from '@/components/app/projects/types';
import type {
  ModelOption,
  PlanOption,
  TemplateOption,
  WorkerOption,
} from '@/components/app/shell-data';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { KaroLogo } from '@/components/brand/logo';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { DEFAULT_AGENT_PERMISSIONS, type AgentPermissions } from '@/lib/agent/policy';
import type { AgentMode } from '@/lib/db/schema';
import { cn } from '@/lib/utils';

/**
 * The eight-step setup wizard.
 *
 * Everything is held client-side and submitted once at the end, so a user who
 * changes their mind on step 6 has not already half-created an account state
 * they now have to unpick. "Skip setup" is always available and writes the
 * same conservative defaults the wizard starts from — an unfinished setup must
 * never leave the product in a state it cannot run in.
 */

export type CompleteOnboardingInput = {
  usage: string | null;
  planKey: string | null;
  modelId: string | null;
  runtimeTarget: string;
  template: string;
  permissions: Record<string, boolean>;
  projectId: string | null;
  skipped: boolean;
};

export type CompleteOnboardingResult = { ok: true } | { ok: false; error: string };

export type OnboardingWizardProps = {
  plans: readonly PlanOption[];
  models: readonly ModelOption[];
  templates: readonly TemplateOption[];
  workers: readonly WorkerOption[];
  allowOwnServer: boolean;
  allowExternalSandbox: boolean;
  planName: string;
  firstName: string;
  canCreateProject: boolean;
  completeOnboarding: (input: CompleteOnboardingInput) => Promise<CompleteOnboardingResult>;
};

/** Usage answer → the defaults that answer actually changes. */
function permissionsForUsage(usage: OnboardingState['usage']): AgentPermissions {
  if (usage === 'team') {
    return {
      ...DEFAULT_AGENT_PERMISSIONS,
      autoApproveEdits: false,
      autoApproveCommands: false,
    };
  }
  if (usage === 'evaluating') {
    return {
      ...DEFAULT_AGENT_PERMISSIONS,
      writeFiles: false,
      deleteFiles: false,
      installPackages: false,
      gitCommit: false,
      autoApproveEdits: false,
      autoApproveCommands: false,
    };
  }
  return { ...DEFAULT_AGENT_PERMISSIONS };
}

function agentModeForUsage(usage: OnboardingState['usage']): AgentMode {
  if (usage === 'evaluating') return 'plan';
  return 'build';
}

export function OnboardingWizard({
  plans,
  models,
  templates,
  workers,
  allowOwnServer,
  allowExternalSandbox,
  planName,
  firstName,
  canCreateProject,
  completeOnboarding,
}: OnboardingWizardProps) {
  const router = useRouter();
  const nameInputId = React.useId();
  const promptInputId = React.useId();

  const [index, setIndex] = React.useState(0);
  const [furthest, setFurthest] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<{ title: string; message: string } | null>(null);
  const [validation, setValidation] = React.useState<string | null>(null);
  /** True once the user has touched permissions — stops the usage answer stomping them. */
  const permissionsTouched = React.useRef(false);

  const [state, setState] = React.useState<OnboardingState>(() => ({
    usage: null,
    planKey: null,
    modelId: models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? null,
    runtimeTarget: 'karo_cloud',
    workerId: null,
    projectName: '',
    projectDescription: '',
    template: templates[0]?.key ?? 'blank',
    permissions: { ...DEFAULT_AGENT_PERMISSIONS },
    firstPrompt: '',
  }));

  const step = ONBOARDING_STEPS[index];
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Move focus to the new heading on every step change: without it a keyboard
  // user is left on a "Continue" button that has just changed meaning.
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [index]);

  function patch(next: Partial<OnboardingState>) {
    setValidation(null);
    setState((previous) => ({ ...previous, ...next }));
  }

  function chooseUsage(usage: OnboardingState['usage']) {
    setValidation(null);
    setState((previous) => ({
      ...previous,
      usage,
      permissions: permissionsTouched.current
        ? previous.permissions
        : permissionsForUsage(usage),
    }));
  }

  function validate(stepId: OnboardingStepId): string | null {
    if (stepId === 'usage' && state.usage === null) {
      return 'Pick the option that fits best — it only sets defaults you can change later.';
    }
    if (stepId === 'model' && models.length > 0 && !state.modelId) {
      return 'Choose a model so new conversations have a default.';
    }
    if (stepId === 'runtime' && state.runtimeTarget === 'own_server' && !state.workerId) {
      return 'Pick a registered server, or switch to Karo Cloud for now.';
    }
    if (stepId === 'project' && state.projectName.trim().length === 0) {
      return 'Give the project a name.';
    }
    if (stepId === 'prompt' && state.firstPrompt.trim().length === 0) {
      return 'Write a message, or pick one of the suggestions below the box.';
    }
    return null;
  }

  function goNext() {
    if (!step) return;
    const problem = validate(step.id);
    if (problem) {
      setValidation(problem);
      return;
    }
    setValidation(null);
    const next = Math.min(index + 1, ONBOARDING_STEPS.length - 1);
    setIndex(next);
    setFurthest((f) => Math.max(f, next));
  }

  function goBack() {
    setValidation(null);
    setIndex((i) => Math.max(0, i - 1));
  }

  function jumpTo(target: number) {
    // Backwards is always allowed; forwards only into ground already covered.
    if (target > furthest) return;
    setValidation(null);
    setIndex(target);
  }

  async function skip() {
    setBusy(true);
    setFailure(null);
    const result = await completeOnboarding({
      usage: state.usage,
      planKey: state.planKey,
      modelId: state.modelId,
      runtimeTarget: state.runtimeTarget,
      template: state.template,
      permissions: { ...DEFAULT_AGENT_PERMISSIONS },
      projectId: null,
      skipped: true,
    }).catch((error: unknown) => ({ ok: false as const, error: describeError(error).message }));

    if (!result.ok) {
      setFailure({ title: 'Could not save your setup', message: result.error });
      setBusy(false);
      return;
    }
    toast.success('Setup skipped', {
      description: 'Karo is using conservative defaults. Change them any time in Settings.',
    });
    router.push('/app');
    router.refresh();
  }

  async function finish() {
    const problem = validate('prompt');
    if (problem) {
      setValidation(problem);
      return;
    }

    setBusy(true);
    setFailure(null);

    try {
      const project = await apiFetch<CreateProjectResponse>('/api/projects', {
        json: {
          name: state.projectName.trim(),
          description: state.projectDescription.trim() || undefined,
          template: state.template,
          runtimeTarget: state.runtimeTarget,
          workerId: state.workerId ?? undefined,
          modelId: state.modelId ?? undefined,
          agentMode: agentModeForUsage(state.usage),
          shell: 'bash',
        },
      });

      const conversation = await apiFetch<{ conversation: { id: string } }>(
        `/api/projects/${project.project.id}/conversations`,
        {
          json: {
            title: state.firstPrompt.trim().slice(0, 60),
            modelId: state.modelId ?? undefined,
            agentMode: agentModeForUsage(state.usage),
          },
        },
      );

      const result = await completeOnboarding({
        usage: state.usage,
        planKey: state.planKey,
        modelId: state.modelId,
        runtimeTarget: state.runtimeTarget,
        template: state.template,
        permissions: state.permissions,
        projectId: project.project.id,
        skipped: false,
      });

      if (!result.ok) {
        // The project exists; not being able to flip a flag must not lose it.
        toast.warning('Project created, but setup was not marked complete', {
          description: `${result.error} You can finish setup again from the banner.`,
        });
      }

      if (state.planKey) {
        toast.info(`${planName === state.planKey ? 'Plan' : 'Plan choice'} saved`, {
          description:
            'Complete checkout from Billing whenever you are ready — nothing is charged yet.',
        });
      }

      const params = new URLSearchParams({
        conversation: conversation.conversation.id,
        prompt: state.firstPrompt.trim(),
      });
      router.push(`/app/projects/${project.project.id}?${params.toString()}`);
      router.refresh();
    } catch (error) {
      setFailure(describeError(error));
      setBusy(false);
    }
  }

  const isLast = index === ONBOARDING_STEPS.length - 1;
  const progress = ((index + 1) / ONBOARDING_STEPS.length) * 100;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <KaroLogo size={22} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void skip()}
          disabled={busy}
        >
          Skip setup
        </Button>
      </div>

      {/* Mobile progress */}
      <div className="mt-4 lg:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-medium text-fg">{step?.title}</p>
          <p className="karo-numeric text-[11px] text-subtle">
            Step {index + 1} of {ONBOARDING_STEPS.length}
          </p>
        </div>
        <Progress value={progress} className="mt-1.5" />
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* Rail */}
        <nav aria-label="Setup progress" className="hidden lg:block">
          <ol className="space-y-0.5">
            {ONBOARDING_STEPS.map((item, itemIndex) => {
              const done = itemIndex < index;
              const current = itemIndex === index;
              const reachable = itemIndex <= furthest;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!reachable || busy}
                    aria-current={current ? 'step' : undefined}
                    onClick={() => jumpTo(itemIndex)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left',
                      'transition-colors duration-150 ease-[var(--k-ease)]',
                      'disabled:cursor-default',
                      current ? 'bg-surface-2' : reachable ? 'hover:bg-surface-2/60' : '',
                    )}
                  >
                    <span
                      className={cn(
                        'karo-numeric mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium',
                        done
                          ? 'border-primary bg-primary text-primary-fg'
                          : current
                            ? 'border-primary text-primary'
                            : 'border-line text-subtle',
                      )}
                    >
                      {done ? <Check className="size-3" aria-hidden="true" /> : itemIndex + 1}
                    </span>
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block truncate text-[12.5px]',
                          current
                            ? 'font-medium text-fg'
                            : reachable
                              ? 'text-muted'
                              : 'text-subtle',
                        )}
                      >
                        {item.title}
                      </span>
                      <span className="block truncate text-[11px] text-subtle">
                        {item.railHint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Panel */}
        <div className="min-w-0">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-lg leading-tight font-semibold text-fg outline-none"
          >
            {step?.heading}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
            {step?.description}
          </p>

          {failure ? (
            <Alert variant="danger" icon={CircleAlert} className="mt-4">
              <AlertTitle>{failure.title}</AlertTitle>
              <AlertDescription>
                {failure.message} Your answers are still here — fix the problem and try again.
              </AlertDescription>
            </Alert>
          ) : null}

          {!canCreateProject && index >= 4 ? (
            <Alert variant="warning" className="mt-4">
              <AlertTitle>Your role cannot create projects</AlertTitle>
              <AlertDescription>
                Ask a team admin for the Developer role, or skip setup and browse the workspace
                in the meantime.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-5">
            {step?.id === 'usage' ? (
              <UsageStep value={state.usage} onChange={chooseUsage} />
            ) : null}

            {step?.id === 'plan' ? (
              <PlanStep
                plans={plans}
                value={state.planKey}
                onChange={(planKey) => patch({ planKey })}
              />
            ) : null}

            {step?.id === 'model' ? (
              <ModelStep
                models={models}
                value={state.modelId}
                onChange={(modelId) => patch({ modelId })}
              />
            ) : null}

            {step?.id === 'runtime' ? (
              <RuntimeStep
                state={state}
                workers={workers}
                allowOwnServer={allowOwnServer}
                allowExternalSandbox={allowExternalSandbox}
                planName={planName}
                onChange={patch}
              />
            ) : null}

            {step?.id === 'project' ? (
              <ProjectStep
                state={state}
                templates={templates}
                onChange={patch}
                nameInputId={nameInputId}
              />
            ) : null}

            {step?.id === 'template' ? (
              <TemplateStep
                templates={templates}
                value={state.template}
                onChange={(template) => patch({ template })}
              />
            ) : null}

            {step?.id === 'permissions' ? (
              <PermissionsStep
                permissions={state.permissions}
                onChange={(permissions) => {
                  permissionsTouched.current = true;
                  patch({ permissions });
                }}
              />
            ) : null}

            {step?.id === 'prompt' ? (
              <PromptStep
                value={state.firstPrompt}
                onChange={(firstPrompt) => patch({ firstPrompt })}
                textareaId={promptInputId}
              />
            ) : null}
          </div>

          {validation ? (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-[12.5px] text-danger">
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {validation}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={goBack}
              disabled={index === 0 || busy}
              iconLeft={<ArrowLeft />}
            >
              Back
            </Button>

            <div className="flex items-center gap-2">
              {isLast ? (
                <Button
                  type="button"
                  loading={busy}
                  iconLeft={<Rocket />}
                  onClick={() => void finish()}
                  disabled={!canCreateProject}
                >
                  {busy ? 'Setting things up…' : 'Create project and send'}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={goNext}
                  disabled={busy}
                  iconRight={<ArrowRight />}
                >
                  Continue
                </Button>
              )}
            </div>
          </div>

          {index === 0 ? (
            <p className="mt-3 text-[12px] text-subtle">
              {firstName ? `${firstName}, this ` : 'This '}takes about a minute. Nothing here is
              permanent — every answer maps to a setting you can change afterwards.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
