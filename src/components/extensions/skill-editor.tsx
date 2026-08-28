'use client';

import { Info, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { DynamicIcon, ICON_NAMES } from '@/components/extensions/dynamic-icon';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { PluginView, SkillView } from '@/lib/extensions/types';
import { cn } from '@/lib/utils';

/**
 * Skill author/editor.
 *
 * A skill is a system-prompt fragment, so the instructions field is the whole
 * product: it gets the character count, the guidance and the space. Everything
 * else on this page is metadata around it.
 */

const MIN_INSTRUCTIONS = 40;
const MAX_INSTRUCTIONS = 20_000;

const CATEGORIES = [
  'general',
  'web',
  'backend',
  'data',
  'devops',
  'automation',
  'quality',
  'docs',
] as const;

export type ToolOption = { name: string; description: string };

export type SkillEditorProps = {
  /** Omitted when authoring a new skill. */
  skill?: SkillView;
  tools: readonly ToolOption[];
  plugins: readonly Pick<PluginView, 'key' | 'name'>[];
};

type CommandDraft = { uid: string; name: string; description: string; prompt: string };
type EnvDraft = {
  uid: string;
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  description: string;
};

let uid = 0;
const nextUid = () => {
  uid += 1;
  return `d-${uid}`;
};

export function SkillEditor({ skill, tools, plugins }: SkillEditorProps) {
  const router = useRouter();
  const editing = skill !== undefined;

  const [name, setName] = React.useState(skill?.name ?? '');
  const [description, setDescription] = React.useState(skill?.description ?? '');
  const [instructions, setInstructions] = React.useState(skill?.instructions ?? '');
  const [icon, setIcon] = React.useState(skill?.icon ?? 'sparkles');
  const [category, setCategory] = React.useState(skill?.category ?? 'general');
  const [version, setVersion] = React.useState(skill?.version ?? '1.0.0');
  const [allowedTools, setAllowedTools] = React.useState<string[]>(skill?.allowedTools ?? []);
  const [requiredPlugins, setRequiredPlugins] = React.useState<string[]>(
    skill?.requiredPlugins ?? [],
  );
  const [commands, setCommands] = React.useState<CommandDraft[]>(
    () => skill?.slashCommands.map((command) => ({ uid: nextUid(), ...command })) ?? [],
  );
  const [envFields, setEnvFields] = React.useState<EnvDraft[]>(
    () =>
      skill?.environmentSchema.map((field) => ({
        uid: nextUid(),
        key: field.key,
        label: field.label,
        required: field.required,
        secret: field.secret,
        description: field.description ?? '',
      })) ?? [],
  );
  const [busy, setBusy] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  const errors = {
    name: name.trim() === '' ? 'Give the skill a name.' : null,
    description: description.trim() === '' ? 'One sentence on what it does.' : null,
    instructions:
      instructions.trim().length < MIN_INSTRUCTIONS
        ? `Write at least ${MIN_INSTRUCTIONS} characters — the agent reads this verbatim.`
        : null,
    version: /^\d+\.\d+\.\d+$/.test(version.trim()) ? null : 'Use a version like 1.2.0.',
  };
  const valid = Object.values(errors).every((value) => value === null);

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  async function save() {
    setTouched(true);
    if (!valid) {
      toast.error('Some fields still need attention', {
        description: 'The highlighted fields below are required before the skill can be saved.',
      });
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      icon,
      category,
      version: version.trim(),
      allowedTools,
      requiredPlugins,
      slashCommands: commands
        .filter((command) => command.name.trim() !== '')
        .map((command) => ({
          name: command.name.trim(),
          description: command.description.trim() || 'Runs this skill.',
          prompt: command.prompt.trim() || 'Follow this skill for the current task.',
        })),
      environmentSchema: envFields
        .filter((field) => field.key.trim() !== '')
        .map((field) => ({
          key: field.key.trim(),
          label: field.label.trim() || field.key.trim(),
          required: field.required,
          secret: field.secret,
          description: field.description.trim() || undefined,
        })),
    };

    setBusy(true);
    try {
      if (editing) {
        await apiFetch(`/api/skills/${skill.id}`, {
          method: 'PATCH',
          json: { kind: 'definition', ...payload },
        });
        toast.success('Skill saved', {
          description: 'Installations pick up the new instructions on their next run.',
        });
      } else {
        await apiFetch('/api/skills', { method: 'POST', json: payload });
        toast.success('Skill created', {
          description: 'Install it from the Browse tab to start using it.',
        });
      }
      router.push('/app/skills');
      router.refresh();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(false);
    }
  }

  const instructionsCount = instructions.length;
  const overLimit = instructionsCount > MAX_INSTRUCTIONS;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
            <CardDescription>
              This text is concatenated into the agent&apos;s system prompt verbatim whenever
              the skill is enabled for a run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert variant="info" icon={Info}>
              <AlertTitle>What makes a skill work</AlertTitle>
              <AlertDescription>
                Write to the agent in the second person. Be specific about the order of work,
                what to read before writing, and what &ldquo;done&rdquo; looks like. Do not
                restate rules the runtime already enforces — sandboxing, approvals and path
                confinement are always on.
              </AlertDescription>
            </Alert>

            <Field disabled={busy}>
              <FieldLabel htmlFor="skill-instructions" required>
                Agent instructions
              </FieldLabel>
              <Textarea
                id="skill-instructions"
                rows={18}
                value={instructions}
                maxLength={MAX_INSTRUCTIONS}
                placeholder={
                  'You are reviewing a pull request.\n\nStart by reading the diff in full before commenting on any single file…'
                }
                aria-describedby="skill-instructions-count"
                onChange={(event) => setInstructions(event.target.value)}
              />
              <div className="flex items-center justify-between gap-3">
                <FieldHint>
                  Aim for 150–600 words. Longer skills crowd out the conversation itself.
                </FieldHint>
                <span
                  id="skill-instructions-count"
                  className={cn(
                    'karo-numeric shrink-0 text-[11px]',
                    overLimit
                      ? 'text-danger'
                      : instructionsCount < MIN_INSTRUCTIONS
                        ? 'text-subtle'
                        : 'text-muted',
                  )}
                >
                  {instructionsCount.toLocaleString('en-US')} /{' '}
                  {MAX_INSTRUCTIONS.toLocaleString('en-US')}
                </span>
              </div>
              {touched && errors.instructions ? (
                <FieldError>{errors.instructions}</FieldError>
              ) : null}
            </Field>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
              <CardDescription>How the skill appears in the catalogue.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field disabled={busy}>
                <FieldLabel htmlFor="skill-name" required>
                  Name
                </FieldLabel>
                <Input
                  id="skill-name"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                />
                {touched && errors.name ? <FieldError>{errors.name}</FieldError> : null}
              </Field>

              <Field disabled={busy}>
                <FieldLabel htmlFor="skill-description" required>
                  Description
                </FieldLabel>
                <Textarea
                  id="skill-description"
                  rows={3}
                  value={description}
                  maxLength={400}
                  placeholder="Reviews pull requests for correctness, security and test coverage."
                  onChange={(event) => setDescription(event.target.value)}
                />
                {touched && errors.description ? (
                  <FieldError>{errors.description}</FieldError>
                ) : null}
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field disabled={busy}>
                  <FieldLabel htmlFor="skill-icon">Icon</FieldLabel>
                  <Select value={icon} onValueChange={setIcon} disabled={busy}>
                    <SelectTrigger id="skill-icon" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ICON_NAMES.map((option) => (
                        <SelectItem key={option} value={option}>
                          <span className="flex items-center gap-2">
                            <DynamicIcon name={option} className="size-3.5" />
                            {option}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field disabled={busy}>
                  <FieldLabel htmlFor="skill-category">Category</FieldLabel>
                  <Select value={category} onValueChange={setCategory} disabled={busy}>
                    <SelectTrigger id="skill-category" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field disabled={busy}>
                <FieldLabel htmlFor="skill-version" required>
                  Version
                </FieldLabel>
                <Input
                  id="skill-version"
                  mono
                  value={version}
                  placeholder="1.0.0"
                  onChange={(event) => setVersion(event.target.value)}
                />
                {touched && errors.version ? <FieldError>{errors.version}</FieldError> : null}
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>
                Narrows what the agent may call while this skill is active. The project&apos;s
                own permission matrix still applies on top — a skill can never widen it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <fieldset className="space-y-1.5" disabled={busy}>
                <legend className="text-[12px] font-medium text-fg">Allowed tools</legend>
                {allowedTools.length === 0 ? (
                  <p className="text-[12px] text-muted">
                    Nothing selected — the agent keeps whatever the project already allows.
                  </p>
                ) : null}
                <div className="space-y-1.5">
                  {tools.map((tool) => {
                    const id = `tool-${tool.name}`;
                    return (
                      <div key={tool.name} className="flex items-start gap-2">
                        <Checkbox
                          id={id}
                          checked={allowedTools.includes(tool.name)}
                          onCheckedChange={() =>
                            toggle(allowedTools, tool.name, setAllowedTools)
                          }
                        />
                        <div className="min-w-0">
                          <Label htmlFor={id} className="font-mono text-[12px]">
                            {tool.name}
                          </Label>
                          <p className="text-[11px] leading-snug text-subtle">
                            {tool.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="space-y-1.5 border-t border-line pt-3" disabled={busy}>
                <legend className="text-[12px] font-medium text-fg">Required plugins</legend>
                {plugins.length === 0 ? (
                  <p className="text-[12px] text-muted">No plugins in the catalogue yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {plugins.map((plugin) => {
                      const id = `plugin-${plugin.key}`;
                      return (
                        <div key={plugin.key} className="flex items-center gap-1.5">
                          <Checkbox
                            id={id}
                            checked={requiredPlugins.includes(plugin.key)}
                            onCheckedChange={() =>
                              toggle(requiredPlugins, plugin.key, setRequiredPlugins)
                            }
                          />
                          <Label htmlFor={id} className="text-[12px]">
                            {plugin.name}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                )}
                <FieldHint>
                  Karo warns before a run when a required plugin is not installed.
                </FieldHint>
              </fieldset>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Slash commands</CardTitle>
          <CardDescription>
            Each command becomes a `/name` entry in the chat composer for everyone who installs
            this skill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {commands.length === 0 ? (
            <p className="rounded-md border border-dashed border-line bg-surface-2 px-3 py-3 text-[12px] text-muted">
              No commands yet. A skill works without them — commands are shortcuts for the tasks
              you run most.
            </p>
          ) : null}

          {commands.map((command, index) => (
            <div
              key={command.uid}
              className="space-y-2 rounded-md border border-line bg-surface-2 p-3"
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                <div>
                  <Label htmlFor={`cmd-name-${command.uid}`} className="text-[12px]">
                    Command
                  </Label>
                  <Input
                    id={`cmd-name-${command.uid}`}
                    mono
                    inputSize="sm"
                    value={command.name}
                    placeholder="review-pr"
                    disabled={busy}
                    onChange={(event) =>
                      setCommands((current) =>
                        current.map((row) =>
                          row.uid === command.uid ? { ...row, name: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`cmd-desc-${command.uid}`} className="text-[12px]">
                    Description
                  </Label>
                  <Input
                    id={`cmd-desc-${command.uid}`}
                    inputSize="sm"
                    value={command.description}
                    placeholder="Review the current diff and report findings"
                    disabled={busy}
                    onChange={(event) =>
                      setCommands((current) =>
                        current.map((row) =>
                          row.uid === command.uid
                            ? { ...row, description: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={`Remove command ${command.name || index + 1}`}
                    onClick={() =>
                      setCommands((current) => current.filter((row) => row.uid !== command.uid))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div>
                <Label htmlFor={`cmd-prompt-${command.uid}`} className="text-[12px]">
                  Prompt sent to the agent
                </Label>
                <Textarea
                  id={`cmd-prompt-${command.uid}`}
                  rows={3}
                  value={command.prompt}
                  placeholder="Review every file in the current diff. Report correctness, security and coverage problems with file and line."
                  disabled={busy}
                  onChange={(event) =>
                    setCommands((current) =>
                      current.map((row) =>
                        row.uid === command.uid ? { ...row, prompt: event.target.value } : row,
                      ),
                    )
                  }
                />
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            size="xs"
            iconLeft={<Plus />}
            disabled={busy}
            onClick={() =>
              setCommands((current) => [
                ...current,
                { uid: nextUid(), name: '', description: '', prompt: '' },
              ])
            }
          >
            Add command
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration the installer supplies</CardTitle>
          <CardDescription>
            Rendered as a form when someone configures this skill. Fields marked secret are
            encrypted and never shown again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {envFields.length === 0 ? (
            <p className="rounded-md border border-dashed border-line bg-surface-2 px-3 py-3 text-[12px] text-muted">
              No configuration. Add a field if the skill needs an API key, a base URL or a
              project identifier.
            </p>
          ) : null}

          {envFields.map((field, index) => (
            <div
              key={field.uid}
              className="grid gap-2 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div>
                <Label htmlFor={`env-key-${field.uid}`} className="text-[12px]">
                  Variable
                </Label>
                <Input
                  id={`env-key-${field.uid}`}
                  mono
                  inputSize="sm"
                  value={field.key}
                  placeholder="LINEAR_API_KEY"
                  disabled={busy}
                  onChange={(event) =>
                    setEnvFields((current) =>
                      current.map((row) =>
                        row.uid === field.uid ? { ...row, key: event.target.value } : row,
                      ),
                    )
                  }
                />
              </div>
              <div>
                <Label htmlFor={`env-label-${field.uid}`} className="text-[12px]">
                  Label
                </Label>
                <Input
                  id={`env-label-${field.uid}`}
                  inputSize="sm"
                  value={field.label}
                  placeholder="Linear API key"
                  disabled={busy}
                  onChange={(event) =>
                    setEnvFields((current) =>
                      current.map((row) =>
                        row.uid === field.uid ? { ...row, label: event.target.value } : row,
                      ),
                    )
                  }
                />
              </div>
              <div className="flex items-end justify-between gap-3 sm:justify-end">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5">
                    <Switch
                      id={`env-required-${field.uid}`}
                      checked={field.required}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        setEnvFields((current) =>
                          current.map((row) =>
                            row.uid === field.uid ? { ...row, required: checked } : row,
                          ),
                        )
                      }
                    />
                    <Label htmlFor={`env-required-${field.uid}`} className="text-[12px]">
                      Required
                    </Label>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Switch
                      id={`env-secret-${field.uid}`}
                      checked={field.secret}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        setEnvFields((current) =>
                          current.map((row) =>
                            row.uid === field.uid ? { ...row, secret: checked } : row,
                          ),
                        )
                      }
                    />
                    <Label htmlFor={`env-secret-${field.uid}`} className="text-[12px]">
                      Secret
                    </Label>
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`Remove field ${field.key || index + 1}`}
                  onClick={() =>
                    setEnvFields((current) => current.filter((row) => row.uid !== field.uid))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="sm:col-span-3">
                <Label htmlFor={`env-desc-${field.uid}`} className="text-[12px]">
                  Help text
                </Label>
                <Input
                  id={`env-desc-${field.uid}`}
                  inputSize="sm"
                  value={field.description}
                  placeholder="Create one under Settings → API in Linear. Read-only is enough."
                  disabled={busy}
                  onChange={(event) =>
                    setEnvFields((current) =>
                      current.map((row) =>
                        row.uid === field.uid
                          ? { ...row, description: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            size="xs"
            iconLeft={<Plus />}
            disabled={busy}
            onClick={() =>
              setEnvFields((current) => [
                ...current,
                {
                  uid: nextUid(),
                  key: '',
                  label: '',
                  required: true,
                  secret: false,
                  description: '',
                },
              ])
            }
          >
            Add field
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {editing ? (
          <Badge variant="outline" size="sm" className="mr-auto">
            Editing {skill.key}
          </Badge>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => router.push('/app/skills')}
        >
          Cancel
        </Button>
        <Button type="button" size="sm" loading={busy} onClick={() => void save()}>
          {editing ? 'Save skill' : 'Create skill'}
        </Button>
      </div>
    </div>
  );
}
