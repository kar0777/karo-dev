'use client';

import {
  Download,
  KeyRound,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { ConfirmDialog } from '@/components/extensions/confirm-dialog';
import { DynamicIcon } from '@/components/extensions/dynamic-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Meter } from '@/components/ui/meter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import type { InstalledSkillView, ProjectOptionView, SkillView } from '@/lib/extensions/types';
import { formatRelativeTime, pluralize } from '@/lib/utils';

export type SkillsWorkspaceProps = {
  skills: readonly SkillView[];
  installed: readonly InstalledSkillView[];
  projects: readonly ProjectOptionView[];
  canManage: boolean;
  limits: { maxSkills: number; planName: string };
};

export function SkillsWorkspace({
  skills,
  installed,
  projects,
  canManage,
  limits,
}: SkillsWorkspaceProps) {
  const router = useRouter();
  const [tab, setTab] = React.useState(installed.length > 0 ? 'installed' : 'browse');
  const [installing, setInstalling] = React.useState<SkillView | null>(null);
  const [configuring, setConfiguring] = React.useState<InstalledSkillView | null>(null);
  const [permissionsFor, setPermissionsFor] = React.useState<InstalledSkillView | null>(null);
  const [uninstalling, setUninstalling] = React.useState<InstalledSkillView | null>(null);

  const atLimit = installed.length >= limits.maxSkills;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <Meter
            className="max-w-md"
            value={installed.length}
            max={limits.maxSkills}
            label="Installed skills"
            caption={`${installed.length} / ${limits.maxSkills} on ${limits.planName}`}
          />
          {atLimit ? (
            <p className="mt-2 text-[12px] text-warning-soft-fg">
              Every skill slot on {limits.planName} is in use. Uninstall one, or upgrade the
              plan to add more.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="pill">
          <TabsTrigger value="installed">Installed ({installed.length})</TabsTrigger>
          <TabsTrigger value="browse">Browse ({skills.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4">
          {installed.length === 0 ? (
            <Card>
              <EmptyState
                icon={Sparkles}
                title="No skills installed"
                description="A skill teaches the agent how you want a particular kind of work done — reviewing a diff, writing release notes, wiring a payment flow. Browse the catalogue to install one."
                action={
                  <Button type="button" size="sm" onClick={() => setTab('browse')}>
                    Browse skills
                  </Button>
                }
                secondaryAction={
                  canManage ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href="/app/skills/new">Write your own</Link>
                    </Button>
                  ) : null
                }
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {installed.map((installation) => (
                <InstalledSkillCard
                  key={installation.id}
                  installation={installation}
                  canManage={canManage}
                  onConfigure={() => setConfiguring(installation)}
                  onPermissions={() => setPermissionsFor(installation)}
                  onUninstall={() => setUninstalling(installation)}
                  onToggle={async (enabled) => {
                    try {
                      await apiFetch(`/api/skills/${installation.skillId}`, {
                        method: 'PATCH',
                        json: {
                          kind: 'installation',
                          installationId: installation.id,
                          isEnabled: enabled,
                        },
                      });
                      toast.success(
                        enabled
                          ? `${installation.skill.name} enabled`
                          : `${installation.skill.name} disabled`,
                      );
                      router.refresh();
                    } catch (error) {
                      const { title, message } = describeError(error);
                      toast.error(title, { description: message });
                      router.refresh();
                    }
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="browse" className="mt-4">
          {skills.length === 0 ? (
            <Card>
              <EmptyState
                icon={Sparkles}
                title="The catalogue is empty"
                description="No skills have been seeded on this deployment. Write one yourself, or import an exported document."
                action={
                  canManage ? (
                    <Button asChild size="sm" iconLeft={<Plus />}>
                      <Link href="/app/skills/new">Create a skill</Link>
                    </Button>
                  ) : null
                }
              />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {skills.map((skill) => (
                <BrowseSkillCard
                  key={skill.id}
                  skill={skill}
                  installations={installed.filter((row) => row.skillId === skill.id)}
                  canManage={canManage}
                  atLimit={atLimit}
                  planName={limits.planName}
                  onInstall={() => setInstalling(skill)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <InstallDialog
        skill={installing}
        projects={projects}
        onOpenChange={(open) => {
          if (!open) setInstalling(null);
        }}
        onInstalled={() => {
          setTab('installed');
          router.refresh();
        }}
      />

      <ConfigureDialog
        installation={configuring}
        onOpenChange={(open) => {
          if (!open) setConfiguring(null);
        }}
        onSaved={() => router.refresh()}
      />

      <PermissionsDialog
        installation={permissionsFor}
        onOpenChange={(open) => {
          if (!open) setPermissionsFor(null);
        }}
      />

      <ConfirmDialog
        open={uninstalling !== null}
        onOpenChange={(open) => {
          if (!open) setUninstalling(null);
        }}
        title={`Uninstall ${uninstalling?.skill.name ?? 'this skill'}?`}
        description={
          <>
            The agent stops loading these instructions and the{' '}
            {uninstalling?.skill.slashCommands.length ?? 0}{' '}
            {pluralize(uninstalling?.skill.slashCommands.length ?? 0, 'slash command')} it
            contributes disappear from the composer. Any configuration you saved is deleted.
          </>
        }
        confirmLabel="Uninstall"
        onConfirm={async () => {
          if (!uninstalling) return;
          try {
            await apiFetch(`/api/skills/${uninstalling.skillId}/uninstall`, {
              method: 'POST',
              json: { installationId: uninstalling.id },
            });
            toast.success(`${uninstalling.skill.name} uninstalled`);
            router.refresh();
          } catch (error) {
            const { title, message } = describeError(error);
            toast.error(title, { description: message });
          }
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Cards
 * ------------------------------------------------------------------ */

function BrowseSkillCard({
  skill,
  installations,
  canManage,
  atLimit,
  planName,
  onInstall,
}: {
  skill: SkillView;
  installations: readonly InstalledSkillView[];
  canManage: boolean;
  atLimit: boolean;
  planName: string;
  onInstall: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-primary">
            <DynamicIcon name={skill.icon} />
          </span>
          <div className="min-w-0 grow">
            <CardTitle className="truncate">{skill.name}</CardTitle>
            <p className="mt-0.5 truncate text-[11px] text-subtle">
              {skill.author} · v{skill.version}
            </p>
          </div>
          {skill.isOwnedByTeam ? (
            <Badge variant="primary" size="sm">
              Yours
            </Badge>
          ) : null}
        </div>
        <CardDescription className="karo-truncate-2 mt-2">{skill.description}</CardDescription>
      </CardHeader>

      <CardContent className="grow space-y-2">
        {skill.slashCommands.length > 0 ? (
          <div>
            <p className="text-[11px] tracking-wide text-subtle uppercase">Adds commands</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {skill.slashCommands.map((command) => (
                <Badge key={command.name} variant="outline" size="sm" className="font-mono">
                  /{command.name}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {skill.requiredPlugins.length > 0 ? (
          <div>
            <p className="text-[11px] tracking-wide text-subtle uppercase">Requires plugins</p>
            <p className="mt-0.5 text-[12px] text-muted">{skill.requiredPlugins.join(', ')}</p>
          </div>
        ) : null}
      </CardContent>

      <CardContent className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {installations.length > 0 ? (
          <span className="text-[12px] text-muted">
            Installed for{' '}
            {installations
              .map((row) =>
                row.scope === 'account' ? 'the account' : (row.projectName ?? 'a project'),
              )
              .join(', ')}
          </span>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant={installations.length > 0 ? 'secondary' : 'primary'}
          className="ml-auto"
          disabled={!canManage || atLimit}
          title={atLimit ? `The ${planName} plan is at its skill limit.` : undefined}
          onClick={onInstall}
        >
          {installations.length > 0 ? 'Install elsewhere' : 'Install'}
        </Button>
      </CardContent>
    </Card>
  );
}

function InstalledSkillCard({
  installation,
  canManage,
  onConfigure,
  onPermissions,
  onUninstall,
  onToggle,
}: {
  installation: InstalledSkillView;
  canManage: boolean;
  onConfigure: () => void;
  onPermissions: () => void;
  onUninstall: () => void;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  const { skill } = installation;
  const needsConfig = skill.environmentSchema.filter(
    (field) =>
      field.required &&
      (field.secret
        ? !installation.secretKeys.includes(field.key)
        : !(installation.config[field.key] ?? '').trim()),
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-primary">
          <DynamicIcon name={skill.icon} />
        </span>

        <div className="min-w-0 grow space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-medium text-fg">{skill.name}</h3>
            <Badge variant="outline" size="sm">
              v{installation.version}
            </Badge>
            <Badge variant={installation.scope === 'project' ? 'info' : 'neutral'} size="sm">
              {installation.scope === 'project'
                ? (installation.projectName ?? 'Project')
                : 'Account'}
            </Badge>
            {skill.isOwnedByTeam ? (
              <Badge variant="primary" size="sm">
                Yours
              </Badge>
            ) : null}
          </div>

          <p className="text-[12px] leading-relaxed text-muted">{skill.description}</p>

          {skill.slashCommands.length > 0 ? (
            <div>
              <p className="text-[11px] tracking-wide text-subtle uppercase">
                Slash commands it contributes
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {skill.slashCommands.map((command) => (
                  <span
                    key={command.name}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-1.5 py-0.5"
                  >
                    <code className="font-mono text-[11px] text-primary">/{command.name}</code>
                    <span className="text-[11px] text-muted">{command.description}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-subtle">This skill contributes no slash commands.</p>
          )}

          {needsConfig.length > 0 ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning-soft-fg">
              Needs configuration: {needsConfig.map((field) => field.label).join(', ')}. The
              agent will fail the first time it uses this skill until you fill these in.
            </p>
          ) : null}

          <p className="text-[11px] text-subtle">
            Installed {formatRelativeTime(installation.installedAt)}
            {installation.lastUsedAt
              ? ` · last used ${formatRelativeTime(installation.lastUsedAt)}`
              : ' · not used yet'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`skill-enabled-${installation.id}`} className="text-[12px]">
              Enabled
            </Label>
            <Switch
              id={`skill-enabled-${installation.id}`}
              checked={installation.isEnabled}
              disabled={!canManage}
              onCheckedChange={(checked) => void onToggle(checked)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {skill.environmentSchema.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                iconLeft={<Settings2 />}
                disabled={!canManage}
                onClick={onConfigure}
              >
                Configure
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              iconLeft={<ShieldCheck />}
              onClick={onPermissions}
            >
              Permissions
            </Button>
            <Button asChild variant="ghost" size="xs">
              <a
                href={`/api/skills/${skill.id}/export`}
                download={`${skill.key}.karo-skill.json`}
              >
                <Download />
                Export
              </a>
            </Button>
            {skill.isOwnedByTeam && canManage ? (
              <Button asChild variant="ghost" size="xs">
                <Link href={`/app/skills/${skill.id}/edit`}>
                  <Pencil />
                  Edit
                </Link>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              iconLeft={<Trash2 />}
              disabled={!canManage}
              onClick={onUninstall}
            >
              Uninstall
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  Dialogs
 * ------------------------------------------------------------------ */

function InstallDialog({
  skill,
  projects,
  onOpenChange,
  onInstalled,
}: {
  skill: SkillView | null;
  projects: readonly ProjectOptionView[];
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
}) {
  const [scope, setScope] = React.useState<'account' | 'project'>('account');
  const [projectId, setProjectId] = React.useState<string | null>(projects[0]?.id ?? null);
  const [busy, setBusy] = React.useState(false);

  // The dialog stays mounted between skills, so each new skill has to start from
  // the default scope again. Adjusting during render instead of in an effect means
  // React re-runs this component with the reset state before painting, so the
  // previous skill's choice is never visible and no extra render cascades.
  const [seen, setSeen] = React.useState({ skill, projects });
  if (seen.skill !== skill || seen.projects !== projects) {
    setSeen({ skill, projects });
    if (skill) {
      setScope('account');
      setProjectId(projects[0]?.id ?? null);
    }
  }

  async function install() {
    if (!skill) return;
    setBusy(true);
    try {
      await apiFetch(`/api/skills/${skill.id}/install`, {
        method: 'POST',
        json: { scope, projectId: scope === 'project' ? projectId : null },
      });
      toast.success(`${skill.name} installed`, {
        description:
          skill.environmentSchema.length > 0
            ? 'Configure it next — it needs values before the agent can use it.'
            : 'The agent will load it on the next run.',
      });
      onOpenChange(false);
      onInstalled();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={skill !== null} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install {skill?.name}</DialogTitle>
          <DialogDescription>
            Choose where this skill applies. Account-wide skills load in every project; a
            project-scoped skill only loads in the one you pick.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label id="skill-install-scope">Scope</Label>
            <SegmentedControl
              aria-labelledby="skill-install-scope"
              size="sm"
              fullWidth
              disabled={busy}
              options={[
                { value: 'account', label: 'Whole account' },
                { value: 'project', label: 'One project' },
              ]}
              value={scope}
              onValueChange={(next) => setScope(next as 'account' | 'project')}
            />
          </div>

          {scope === 'project' ? (
            <Field disabled={busy}>
              <FieldLabel htmlFor="skill-install-project" required>
                Project
              </FieldLabel>
              {projects.length === 0 ? (
                <FieldHint>
                  You have no projects yet. Create one first, or install for the whole account.
                </FieldHint>
              ) : (
                <Select value={projectId ?? ''} onValueChange={setProjectId} disabled={busy}>
                  <SelectTrigger id="skill-install-project" size="sm">
                    <SelectValue placeholder="Pick a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ) : null}

          {skill && skill.requiredPlugins.length > 0 ? (
            <p className="rounded-md border border-info/30 bg-info-soft px-2.5 py-1.5 text-[12px] text-info-soft-fg">
              Works best with the {skill.requiredPlugins.join(', ')}{' '}
              {pluralize(skill.requiredPlugins.length, 'plugin')} installed.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            loading={busy}
            disabled={scope === 'project' && !projectId}
            onClick={() => void install()}
          >
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigureDialog({
  installation,
  onOpenChange,
  onSaved,
}: {
  installation: InstalledSkillView | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    installation ? { ...installation.config } : {},
  );
  const [replacing, setReplacing] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);

  // Same shared-dialog reload as InstallDialog: load the installation's stored
  // config during render rather than in an effect, so the form never paints with
  // the previously configured skill's values. Closing (installation becomes null)
  // deliberately leaves the form alone so nothing changes under the exit animation.
  const [seenInstallation, setSeenInstallation] = React.useState(installation);
  if (installation !== seenInstallation) {
    setSeenInstallation(installation);
    if (installation) {
      setValues({ ...installation.config });
      setReplacing({});
    }
  }

  async function save() {
    if (!installation) return;
    const schema = installation.skill.environmentSchema;

    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const field of schema) {
      const value = values[field.key] ?? '';
      if (field.secret) {
        // Only send a secret the user actually typed — otherwise the stored
        // value must survive untouched.
        if (replacing[field.key] || !installation.secretKeys.includes(field.key)) {
          if (value !== '' || replacing[field.key]) secrets[field.key] = value;
        }
      } else {
        config[field.key] = value;
      }
    }

    setBusy(true);
    try {
      await apiFetch(`/api/skills/${installation.skillId}`, {
        method: 'PATCH',
        json: {
          kind: 'installation',
          installationId: installation.id,
          config,
          secrets,
        },
      });
      toast.success(`${installation.skill.name} configured`);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(false);
    }
  }

  const schema = installation?.skill.environmentSchema ?? [];

  return (
    <Dialog open={installation !== null} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure {installation?.skill.name}</DialogTitle>
          <DialogDescription>
            These values are passed to the agent when the skill runs. Secrets are encrypted and
            never shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {schema.map((field) => {
            const stored = installation?.secretKeys.includes(field.key) ?? false;
            const masked = field.secret && stored && !replacing[field.key];
            return (
              <Field key={field.key} disabled={busy}>
                <FieldLabel htmlFor={`skill-cfg-${field.key}`} required={field.required}>
                  {field.label}
                </FieldLabel>
                {masked ? (
                  <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5">
                    <KeyRound className="size-3.5 shrink-0 text-subtle" aria-hidden="true" />
                    <span className="grow font-mono text-[12px] tracking-widest text-muted">
                      ••••••••
                    </span>
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={() =>
                        setReplacing((current) => ({ ...current, [field.key]: true }))
                      }
                    >
                      Replace
                    </Button>
                  </div>
                ) : (
                  <Input
                    id={`skill-cfg-${field.key}`}
                    mono
                    type={field.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                )}
                {field.description ? <FieldHint>{field.description}</FieldHint> : null}
              </Field>
            );
          })}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" loading={busy} onClick={() => void save()}>
            Save configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsDialog({
  installation,
  onOpenChange,
}: {
  installation: InstalledSkillView | null;
  onOpenChange: (open: boolean) => void;
}) {
  const tools = installation?.skill.allowedTools ?? [];

  return (
    <Dialog open={installation !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{installation?.skill.name} permissions</DialogTitle>
          <DialogDescription>
            What this skill may call. The project&apos;s permission matrix still applies on top
            — a skill can only narrow, never widen.
          </DialogDescription>
        </DialogHeader>

        {tools.length === 0 ? (
          <p className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-muted">
            This skill declares no tool restriction, so the agent keeps whatever the project
            already allows.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {tools.map((tool) => (
              <li
                key={tool}
                className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5"
              >
                <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                <code className="font-mono text-[12px] text-fg">{tool}</code>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
