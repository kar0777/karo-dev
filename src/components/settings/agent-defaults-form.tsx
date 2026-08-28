'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Save } from 'lucide-react';

import { RISK_META, permissionsByRisk, type AgentDefaults } from '@/lib/account/preferences';
import {
  AGENT_MODE_META,
  AGENT_PERMISSION_META,
  type AgentPermissionKey,
} from '@/lib/agent/policy';
import { apiFetch, describeError } from '@/lib/client/api';
import type { AgentMode, ShellKind } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  toast,
} from '@/components/ui';

export type ModelOption = {
  id: string;
  label: string;
  providerName: string;
  available: boolean;
  requiredPlanLabel: string;
};

export type ShellOption = {
  value: ShellKind;
  label: string;
  available: boolean;
};

export type AgentDefaultsFormProps = {
  defaults: AgentDefaults;
  models: ModelOption[];
  shells: ShellOption[];
  planName: string;
};

const AUTO_MODEL = '__auto__';

const RISK_BADGE_TONE: Record<
  'danger' | 'warning' | 'neutral',
  'danger' | 'warning' | 'neutral'
> = {
  danger: 'danger',
  warning: 'warning',
  neutral: 'neutral',
};

export function AgentDefaultsForm({
  defaults,
  models,
  shells,
  planName,
}: AgentDefaultsFormProps) {
  const router = useRouter();
  const groups = React.useMemo(() => permissionsByRisk(), []);

  const [modelId, setModelId] = React.useState<string>(defaults.modelId ?? AUTO_MODEL);
  const [agentMode, setAgentMode] = React.useState<AgentMode>(defaults.agentMode);
  const [shell, setShell] = React.useState<ShellKind>(defaults.shell);
  const [permissions, setPermissions] = React.useState(defaults.permissions);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const dirty =
    (defaults.modelId ?? AUTO_MODEL) !== modelId ||
    defaults.agentMode !== agentMode ||
    defaults.shell !== shell ||
    (Object.keys(permissions) as AgentPermissionKey[]).some(
      (key) => permissions[key] !== defaults.permissions[key],
    );

  function toggle(key: AgentPermissionKey, value: boolean) {
    setPermissions((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;

    setSaving(true);
    setError(null);

    try {
      await apiFetch('/api/settings/agent-defaults', {
        method: 'PATCH',
        json: {
          modelId: modelId === AUTO_MODEL ? null : modelId,
          agentMode,
          shell,
          permissions,
        },
      });
      toast.success('Agent defaults saved', {
        description: 'New projects and conversations start from these settings.',
      });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      toast.error(described.title, { description: described.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Defaults for new work</CardTitle>
          <CardDescription>
            The starting point for every project you create. A project can narrow these later —
            it can never widen them beyond what your team role allows.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="default-model">Default model</FieldLabel>
              <Select value={modelId} onValueChange={setModelId}>
                <SelectTrigger id="default-model" className="w-full">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_MODEL}>Let Karo choose (recommended)</SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id} disabled={!model.available}>
                      {model.label}
                      {model.available ? '' : ` — needs ${model.requiredPlanLabel}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>
                “Let Karo choose” follows the catalogue default, so you inherit new models as
                they are added.
              </FieldHint>
            </Field>

            <Field>
              <FieldLabel htmlFor="default-shell">Default shell</FieldLabel>
              <Select value={shell} onValueChange={(value) => setShell(value as ShellKind)}>
                <SelectTrigger id="default-shell" className="w-full">
                  <SelectValue placeholder="Choose a shell" />
                </SelectTrigger>
                <SelectContent>
                  {shells.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      disabled={!option.available}
                    >
                      {option.label}
                      {option.available ? '' : ' — not on this plan'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>
                The {planName} plan allows{' '}
                {shells
                  .filter((option) => option.available)
                  .map((option) => option.label)
                  .join(', ') || 'no shells'}
                .
              </FieldHint>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-fg">Default agent mode</legend>
            <RadioGroup
              value={agentMode}
              onValueChange={(value) => setAgentMode(value as AgentMode)}
              className="grid gap-2 sm:grid-cols-2"
            >
              {(['ask', 'plan', 'build', 'auto'] as const).map((mode) => {
                const meta = AGENT_MODE_META[mode];
                const selected = agentMode === mode;
                return (
                  <label
                    key={mode}
                    htmlFor={`agent-mode-${mode}`}
                    className={cn(
                      'flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors duration-150 ease-[var(--k-ease)]',
                      selected
                        ? 'border-line-accent bg-primary-soft/40'
                        : 'border-line bg-surface hover:border-line-strong',
                    )}
                  >
                    <RadioGroupItem id={`agent-mode-${mode}`} value={mode} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium text-fg">{meta.label}</span>
                        <Badge variant="outline" size="sm">
                          {meta.short}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                        {meta.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent permissions</CardTitle>
          <CardDescription>
            What the agent itself may do inside a sandbox. This sits below your team role:
            turning something on here never grants more than your role already allows.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {groups.map((group, index) => {
            const meta = RISK_META[group.risk];
            return (
              <div key={group.risk} className="space-y-3">
                {index > 0 ? <Separator /> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={RISK_BADGE_TONE[meta.badge]} size="sm">
                    {meta.label}
                  </Badge>
                  <span className="text-[12px] text-muted">{meta.blurb}</span>
                </div>

                <ul className="space-y-2.5">
                  {group.keys.map((key) => {
                    const permission = AGENT_PERMISSION_META[key];
                    return (
                      <li key={key} className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <label
                            htmlFor={`perm-${key}`}
                            className="text-[13px] font-medium text-fg"
                          >
                            {permission.label}
                          </label>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                            {permission.description}
                          </p>
                        </div>
                        <Switch
                          id={`perm-${key}`}
                          checked={permissions[key]}
                          onCheckedChange={(value) => toggle(key, value)}
                          aria-describedby={`perm-${key}-desc`}
                        />
                        <span id={`perm-${key}-desc`} className="sr-only">
                          {permission.description} Risk level: {meta.label}.
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          <Alert variant="info" icon={<Lock />}>
            <AlertTitle>Mode still caps every switch</AlertTitle>
            <AlertDescription>
              Ask never touches the machine and Plan never writes, whatever is enabled here.
              Auto is the only mode that uses the full matrix.
            </AlertDescription>
          </Alert>

          {error ? <FieldError>{error}</FieldError> : null}
        </CardContent>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <span aria-live="polite" className="mr-auto text-[12px] text-subtle">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <Button type="submit" loading={saving} disabled={!dirty} iconLeft={<Save />}>
            Save defaults
          </Button>
        </div>
      </Card>
    </form>
  );
}
