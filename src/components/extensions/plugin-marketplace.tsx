'use client';

import {
  Activity,
  ArrowUpCircle,
  BadgeCheck,
  Container,
  Download,
  KeyRound,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { ConfirmDialog } from '@/components/extensions/confirm-dialog';
import { DynamicIcon } from '@/components/extensions/dynamic-icon';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/dot';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input, InputGroup, InputAddon } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Meter } from '@/components/ui/meter';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import type { PluginCategory } from '@/lib/db/schema';
import type {
  PluginAuditEntryView,
  PluginConfigFieldView,
  PluginView,
} from '@/lib/extensions/types';
import { cn, formatCompactNumber, formatDateTime, formatRelativeTime } from '@/lib/utils';

/**
 * The plugin marketplace.
 *
 * A plugin installs a runtime into the sandbox and contributes tools, so the
 * install flow is deliberately a two-step consent: read what it can reach,
 * then accept. There is no "install with defaults" path.
 */

const CATEGORIES: Array<{ value: PluginCategory | 'all'; label: string }> = [
  { value: 'all', label: 'All plugins' },
  { value: 'development', label: 'Development' },
  { value: 'databases', label: 'Databases' },
  { value: 'deployment', label: 'Deployment' },
  { value: 'browser', label: 'Browser' },
  { value: 'automation', label: 'Automation' },
  { value: 'testing', label: 'Testing' },
  { value: 'ai', label: 'AI' },
  { value: 'communication', label: 'Communication' },
];

const RISK_VARIANT = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
} as const;

const RISK_LABEL = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
} as const;

const PLAN_LABEL: Record<string, string> = {
  payg: 'Pay as you go',
  lite: 'Lite',
  pro: 'Pro',
  scale: 'Scale',
  ultra: 'Ultra',
};

export type PluginMarketplaceProps = {
  plugins: readonly PluginView[];
  auditByPlugin: Record<string, PluginAuditEntryView[]>;
  canManage: boolean;
  limits: { maxPlugins: number; planName: string };
};

export function PluginMarketplace({
  plugins,
  auditByPlugin,
  canManage,
  limits,
}: PluginMarketplaceProps) {
  const [category, setCategory] = React.useState<PluginCategory | 'all'>('all');
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState<PluginView | null>(null);

  const installedCount = plugins.filter((plugin) => plugin.installed !== null).length;
  const atLimit = installedCount >= limits.maxPlugins;

  const filtered = plugins.filter((plugin) => {
    if (category !== 'all' && plugin.category !== category) return false;
    if (query.trim() === '') return true;
    const needle = query.trim().toLowerCase();
    return (
      plugin.name.toLowerCase().includes(needle) ||
      plugin.description.toLowerCase().includes(needle) ||
      plugin.publisher.toLowerCase().includes(needle) ||
      plugin.providedTools.some((tool) => tool.toLowerCase().includes(needle))
    );
  });

  const counts = new Map<string, number>();
  for (const plugin of plugins) {
    counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <Meter
            className="max-w-md"
            value={installedCount}
            max={limits.maxPlugins}
            label="Installed plugins"
            caption={`${installedCount} / ${limits.maxPlugins} on ${limits.planName}`}
          />
          {atLimit ? (
            <p className="mt-2 text-[12px] text-warning-soft-fg">
              Every plugin slot on {limits.planName} is in use. Remove one, or upgrade the plan.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Plugin categories" className="lg:sticky lg:top-4 lg:self-start">
          <ul className="karo-no-scrollbar flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {CATEGORIES.map((entry) => {
              const active = category === entry.value;
              const count =
                entry.value === 'all' ? plugins.length : (counts.get(entry.value) ?? 0);
              return (
                <li key={entry.value} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setCategory(entry.value)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] whitespace-nowrap transition-colors duration-150 ease-[var(--k-ease)]',
                      active
                        ? 'bg-primary-soft font-medium text-primary-soft-fg'
                        : 'text-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    {entry.label}
                    <span className="karo-numeric text-[11px] text-subtle">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-3">
          <InputGroup className="max-w-sm">
            <InputAddon>
              <Search className="size-3.5" aria-hidden="true" />
            </InputAddon>
            <Input
              type="search"
              inputSize="sm"
              value={query}
              aria-label="Search plugins"
              placeholder="Search by name, publisher or tool"
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={Search}
                title="No plugins match"
                description={
                  query.trim() !== ''
                    ? `Nothing in the catalogue matches "${query.trim()}". Clear the search or pick a different category.`
                    : 'This category is empty on your deployment. Pick another category to see what is available.'
                }
                action={
                  query.trim() !== '' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setQuery('')}
                    >
                      Clear search
                    </Button>
                  ) : null
                }
              />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((plugin) => (
                <PluginCard key={plugin.id} plugin={plugin} onOpen={() => setOpen(plugin)} />
              ))}
            </div>
          )}
        </div>
      </div>

      <PluginDetailDialog
        plugin={open}
        audit={open ? (auditByPlugin[open.id] ?? []) : []}
        canManage={canManage}
        atLimit={atLimit}
        planName={limits.planName}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Card
 * ------------------------------------------------------------------ */

function PluginCard({ plugin, onOpen }: { plugin: PluginView; onOpen: () => void }) {
  const installed = plugin.installed;

  return (
    <Card interactive className="flex flex-col">
      <CardHeader>
        <div className="flex items-start gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-primary">
            <DynamicIcon name={plugin.icon} />
          </span>
          <div className="min-w-0 grow">
            <CardTitle className="flex items-center gap-1.5 truncate">
              <span className="truncate">{plugin.name}</span>
              {plugin.isVerified ? (
                <BadgeCheck
                  className="size-3.5 shrink-0 text-primary"
                  aria-label="Verified publisher"
                />
              ) : null}
            </CardTitle>
            <p className="mt-0.5 truncate text-[11px] text-subtle">
              {plugin.publisher} · v{plugin.version}
            </p>
          </div>
        </div>
        <CardDescription className="karo-truncate-2 mt-2">{plugin.description}</CardDescription>
      </CardHeader>

      <CardContent className="grow">
        <div className="flex flex-wrap items-center gap-1.5">
          {installed ? (
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-1.5 py-0.5">
              <StatusDot
                status={
                  !installed.isEnabled
                    ? 'off'
                    : installed.healthStatus === 'connected'
                      ? 'live'
                      : installed.healthStatus === 'error'
                        ? 'error'
                        : 'idle'
                }
                label={null}
                size="sm"
              />
              <span className="text-[11px] text-muted">
                {installed.isEnabled ? 'Installed' : 'Installed · disabled'}
              </span>
            </span>
          ) : null}
          {!plugin.planAllows ? (
            <Badge variant="ember" size="sm">
              Needs {PLAN_LABEL[plugin.minPlanTier] ?? plugin.minPlanTier}
            </Badge>
          ) : null}
          {installed?.updateAvailable ? (
            <Badge variant="info" size="sm">
              Update to v{plugin.version}
            </Badge>
          ) : null}
        </div>
      </CardContent>

      <CardContent className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="karo-numeric text-[11px] text-subtle">
          {formatCompactNumber(plugin.installCount)} installs
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={onOpen}>
          {installed ? 'Manage' : 'Details'}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  Detail dialog
 * ------------------------------------------------------------------ */

/**
 * The form values a plugin's config schema starts with: the installed value if
 * there is one, otherwise the schema default. Secret fields always start blank
 * because the stored secret never reaches the client — `installed.secretKeys`
 * is what tells us one exists.
 */
function initialConfigValues(plugin: PluginView): Record<string, string> {
  return Object.fromEntries(
    (plugin.configSchema ?? []).map((field) => [
      field.key,
      plugin.installed?.config[field.key] ?? (field.secret ? '' : (field.default ?? '')),
    ]),
  );
}

function PluginDetailDialog({
  plugin,
  audit,
  canManage,
  atLimit,
  planName,
  onOpenChange,
}: {
  plugin: PluginView | null;
  audit: readonly PluginAuditEntryView[];
  canManage: boolean;
  atLimit: boolean;
  planName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<'overview' | 'consent'>('overview');
  const [accepted, setAccepted] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    plugin ? initialConfigValues(plugin) : {},
  );
  const [replacing, setReplacing] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState<'install' | 'save' | 'health' | 'update' | null>(null);
  const [healthResult, setHealthResult] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [uninstalling, setUninstalling] = React.useState(false);

  // The dialog stays mounted across plugins, so opening a different one has to
  // rewind the consent wizard and reload the form. The adjustment happens during
  // render rather than in an effect: React re-runs this component with the new
  // state before painting, so the previous plugin's values are never shown and
  // nothing cascades. Closing the dialog (plugin becomes null) leaves the state
  // alone so the exit animation does not show a half-reset form.
  const [seenPlugin, setSeenPlugin] = React.useState(plugin);
  if (plugin !== seenPlugin) {
    setSeenPlugin(plugin);
    if (plugin) {
      setStep('overview');
      setAccepted(false);
      setHealthResult(null);
      setReplacing({});
      setValues(initialConfigValues(plugin));
    }
  }

  if (!plugin) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  const installed = plugin.installed;

  function splitValues(target: PluginView) {
    const config: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const field of target.configSchema ?? []) {
      const value = values[field.key] ?? '';
      if (field.secret) {
        const stored = target.installed?.secretKeys.includes(field.key) ?? false;
        if (!stored || replacing[field.key]) secrets[field.key] = value;
      } else {
        config[field.key] = value;
      }
    }
    return { config, secrets };
  }

  async function install() {
    const { config, secrets } = splitValues(plugin!);
    setBusy('install');
    try {
      await apiFetch(`/api/plugins/${plugin!.id}/install`, {
        method: 'POST',
        json: {
          grantedPermissions: plugin!.permissions.map((permission) => permission.key),
          acceptedPermissions: true,
          config,
          secrets,
        },
      });
      toast.success(`${plugin!.name} installed`, {
        description: 'The agent can use its tools from the next run.',
      });
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(null);
    }
  }

  async function saveConfig(upgrade = false) {
    const { config, secrets } = splitValues(plugin!);
    setBusy(upgrade ? 'update' : 'save');
    try {
      const response = await apiFetch<{ health: { ok: boolean; message: string } }>(
        `/api/plugins/${plugin!.id}/config`,
        { method: 'PATCH', json: { config, secrets, upgrade } },
      );
      setHealthResult(response.health);
      toast.success(upgrade ? `Updated to v${plugin!.version}` : 'Configuration saved');
      router.refresh();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(null);
    }
  }

  async function runHealthCheck() {
    setBusy('health');
    try {
      const response = await apiFetch<{ health: { ok: boolean; message: string } }>(
        `/api/plugins/${plugin!.id}/health`,
        { method: 'POST' },
      );
      setHealthResult(response.health);
      router.refresh();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(null);
    }
  }

  const missingRequired = (plugin.configSchema ?? [])
    .filter((field) => field.required)
    .filter((field) => {
      if (field.secret) {
        const stored = installed?.secretKeys.includes(field.key) ?? false;
        return !(stored && !replacing[field.key]) && (values[field.key] ?? '').trim() === '';
      }
      return (values[field.key] ?? '').trim() === '';
    });

  return (
    <>
      <Dialog open onOpenChange={busy ? undefined : onOpenChange}>
        <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-line px-5 pt-5 pb-4">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-primary">
                <DynamicIcon name={plugin.icon} className="size-4.5" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="flex flex-wrap items-center gap-1.5">
                  {plugin.name}
                  {plugin.isVerified ? (
                    <Badge variant="primary" size="sm">
                      Verified
                    </Badge>
                  ) : null}
                  <Badge variant="outline" size="sm">
                    v{plugin.version}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {plugin.publisher} · {formatCompactNumber(plugin.installCount)} installs
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 px-5 py-4">
              {plugin.key === 'docker' ? (
                <Alert variant="warning" icon={Container}>
                  <AlertTitle>How Docker runs inside Karo</AlertTitle>
                  <AlertDescription>
                    This plugin starts a{' '}
                    <strong>rootless Docker daemon inside your sandbox</strong>. It never has
                    access to the host Docker socket, and{' '}
                    <code className="font-mono">--privileged</code> is refused by the command
                    policy. Images, volumes and containers live in the sandbox filesystem and
                    are destroyed with it — nothing you build here can reach the machines Karo
                    runs on.
                  </AlertDescription>
                </Alert>
              ) : null}

              {step === 'consent' ? (
                <ConsentStep
                  plugin={plugin}
                  accepted={accepted}
                  onAcceptedChange={setAccepted}
                  values={values}
                  onValuesChange={setValues}
                />
              ) : (
                <>
                  <section>
                    <p className="text-[13px] leading-relaxed text-fg">
                      {plugin.longDescription}
                    </p>
                  </section>

                  <section>
                    <h4 className="text-[12px] font-medium text-fg">Permissions it requests</h4>
                    <ul className="mt-1.5 space-y-1.5">
                      {plugin.permissions.map((permission) => (
                        <li
                          key={permission.key}
                          className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-2.5 py-1.5"
                        >
                          <span className="min-w-0 text-[12px] text-fg">
                            {permission.label}
                          </span>
                          <Badge variant={RISK_VARIANT[permission.risk]} size="sm">
                            {RISK_LABEL[permission.risk]}
                          </Badge>
                        </li>
                      ))}
                      {plugin.permissions.length === 0 ? (
                        <li className="text-[12px] text-muted">
                          This plugin requests nothing beyond the sandbox it already runs in.
                        </li>
                      ) : null}
                    </ul>
                  </section>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <section>
                      <h4 className="text-[12px] font-medium text-fg">Tools it provides</h4>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {plugin.providedTools.length === 0 ? (
                          <span className="text-[12px] text-muted">None</span>
                        ) : (
                          plugin.providedTools.map((tool) => (
                            <Badge key={tool} variant="outline" size="sm" className="font-mono">
                              {tool}
                            </Badge>
                          ))
                        )}
                      </div>
                    </section>

                    <section>
                      <h4 className="text-[12px] font-medium text-fg">Slash commands</h4>
                      <div className="mt-1.5 space-y-1">
                        {plugin.providedCommands.length === 0 ? (
                          <span className="text-[12px] text-muted">None</span>
                        ) : (
                          plugin.providedCommands.map((command) => (
                            <p key={command.name} className="text-[12px] text-muted">
                              <code className="font-mono text-primary">/{command.name}</code>{' '}
                              {command.description}
                            </p>
                          ))
                        )}
                      </div>
                    </section>
                  </div>

                  {plugin.configSchema.length > 0 ? (
                    <section>
                      <h4 className="text-[12px] font-medium text-fg">
                        {installed ? 'Configuration' : 'Configuration it will ask for'}
                      </h4>
                      {installed ? (
                        <div className="mt-2 space-y-3">
                          {plugin.configSchema.map((field) => (
                            <ConfigField
                              key={field.key}
                              field={field}
                              value={values[field.key] ?? ''}
                              stored={installed.secretKeys.includes(field.key)}
                              replacing={Boolean(replacing[field.key])}
                              disabled={!canManage || busy !== null}
                              onReplace={() =>
                                setReplacing((current) => ({ ...current, [field.key]: true }))
                              }
                              onChange={(value) =>
                                setValues((current) => ({ ...current, [field.key]: value }))
                              }
                            />
                          ))}
                        </div>
                      ) : (
                        <ul className="mt-1.5 space-y-1">
                          {plugin.configSchema.map((field) => (
                            <li key={field.key} className="text-[12px] text-muted">
                              <code className="font-mono text-fg">{field.key}</code> —{' '}
                              {field.label}
                              {field.required ? ' (required)' : ' (optional)'}
                              {field.secret ? ' · stored encrypted' : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ) : null}

                  {installed ? (
                    <>
                      <Separator />
                      <section className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-[12px] font-medium text-fg">Health</h4>
                          <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            iconLeft={<Activity />}
                            loading={busy === 'health'}
                            onClick={() => void runHealthCheck()}
                          >
                            Run health check
                          </Button>
                        </div>
                        <div
                          className={cn(
                            'rounded-md border px-2.5 py-2 text-[12px]',
                            (healthResult?.ok ?? installed.healthStatus === 'connected')
                              ? 'border-success/30 bg-success-soft text-success-soft-fg'
                              : 'border-danger/30 bg-danger-soft text-danger-soft-fg',
                          )}
                        >
                          {healthResult?.message ??
                            installed.healthMessage ??
                            'Not checked yet — run a health check to see whether a run would work.'}
                          {installed.lastHealthCheckAt && !healthResult ? (
                            <span className="mt-0.5 block text-[11px] opacity-80">
                              Last checked {formatRelativeTime(installed.lastHealthCheckAt)}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-2.5 py-2">
                          <div className="min-w-0">
                            <Label htmlFor="plugin-enabled" className="text-[12px]">
                              Enabled
                            </Label>
                            <p className="text-[11px] text-muted">
                              Disabled plugins stay configured but are not loaded into a run.
                            </p>
                          </div>
                          <Switch
                            id="plugin-enabled"
                            checked={installed.isEnabled}
                            disabled={!canManage || busy !== null}
                            onCheckedChange={async (checked) => {
                              try {
                                await apiFetch(`/api/plugins/${plugin.id}/config`, {
                                  method: 'PATCH',
                                  json: { isEnabled: checked },
                                });
                                router.refresh();
                              } catch (error) {
                                const { title, message } = describeError(error);
                                toast.error(title, { description: message });
                              }
                            }}
                          />
                        </div>
                      </section>

                      <Separator />
                      <section>
                        <h4 className="text-[12px] font-medium text-fg">Audit trail</h4>
                        {audit.length === 0 ? (
                          <p className="mt-1.5 text-[12px] text-muted">
                            Nothing recorded yet beyond the install itself.
                          </p>
                        ) : (
                          <ul className="mt-1.5 space-y-1.5">
                            {audit.map((entry) => (
                              <li key={entry.id} className="text-[12px]">
                                <span className="text-fg">{entry.summary || entry.label}</span>
                                <span className="text-subtle">
                                  {' '}
                                  · {entry.actorName} · {formatDateTime(entry.at)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="flex-wrap border-t border-line px-5 py-3">
            {installed ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mr-auto"
                  iconLeft={<Trash2 />}
                  disabled={!canManage || busy !== null}
                  onClick={() => setUninstalling(true)}
                >
                  Uninstall
                </Button>
                {installed.updateAvailable ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    iconLeft={<ArrowUpCircle />}
                    loading={busy === 'update'}
                    disabled={!canManage || busy !== null}
                    onClick={() => void saveConfig(true)}
                  >
                    Update to v{plugin.version}
                  </Button>
                ) : null}
                {plugin.configSchema.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    loading={busy === 'save'}
                    disabled={!canManage || busy !== null}
                    onClick={() => void saveConfig(false)}
                  >
                    Save configuration
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                    Close
                  </Button>
                )}
              </>
            ) : step === 'overview' ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  size="sm"
                  iconLeft={<Download />}
                  disabled={!canManage || !plugin.planAllows || atLimit}
                  title={
                    !plugin.planAllows
                      ? `${plugin.name} needs a higher plan than ${planName}.`
                      : atLimit
                        ? `The ${planName} plan is at its plugin limit.`
                        : undefined
                  }
                  onClick={() => setStep('consent')}
                >
                  Install
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setStep('overview')}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  size="sm"
                  loading={busy === 'install'}
                  disabled={!accepted || missingRequired.length > 0}
                  title={
                    missingRequired.length > 0
                      ? `Still needed: ${missingRequired.map((field) => field.label).join(', ')}`
                      : undefined
                  }
                  onClick={() => void install()}
                >
                  Accept and install
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={uninstalling}
        onOpenChange={setUninstalling}
        title={`Uninstall ${plugin.name}?`}
        description="Its tools and slash commands disappear from every project, and the configuration you saved — including any encrypted credential — is deleted. Sandboxes already running keep it until they restart."
        confirmLabel="Uninstall"
        onConfirm={async () => {
          try {
            await apiFetch(`/api/plugins/${plugin.id}/uninstall`, { method: 'POST' });
            toast.success(`${plugin.name} removed`);
            onOpenChange(false);
            router.refresh();
          } catch (error) {
            const { title, message } = describeError(error);
            toast.error(title, { description: message });
          }
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Consent step
 * ------------------------------------------------------------------ */

function ConsentStep({
  plugin,
  accepted,
  onAcceptedChange,
  values,
  onValuesChange,
}: {
  plugin: PluginView;
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  values: Record<string, string>;
  onValuesChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const high = plugin.permissions.filter((permission) => permission.risk === 'high');

  return (
    <div className="space-y-4">
      <Alert variant={high.length > 0 ? 'danger' : 'info'} icon={ShieldAlert}>
        <AlertTitle>
          {plugin.name} will be able to do the following inside your sandboxes
        </AlertTitle>
        <AlertDescription>
          {high.length > 0
            ? `${high.length} of these are high risk. Install it only if you trust ${plugin.publisher} with them.`
            : 'Review the list — a plugin runs with everything it declares or not at all.'}
        </AlertDescription>
      </Alert>

      <ul className="space-y-1.5">
        {plugin.permissions.map((permission) => (
          <li
            key={permission.key}
            className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface-2 px-2.5 py-2"
          >
            <div className="min-w-0">
              <p className="text-[12px] text-fg">{permission.label}</p>
              <code className="font-mono text-[11px] text-subtle">{permission.key}</code>
            </div>
            <Badge variant={RISK_VARIANT[permission.risk]} size="sm">
              {RISK_LABEL[permission.risk]}
            </Badge>
          </li>
        ))}
        {plugin.permissions.length === 0 ? (
          <li className="rounded-md border border-line bg-surface-2 px-2.5 py-2 text-[12px] text-muted">
            This plugin requests no permissions beyond the sandbox it runs in.
          </li>
        ) : null}
      </ul>

      {plugin.configSchema.length > 0 ? (
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-[12px] font-medium text-fg">Configuration</p>
          {plugin.configSchema.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              stored={false}
              replacing={false}
              disabled={false}
              onReplace={() => undefined}
              onChange={(value) =>
                onValuesChange((current) => ({ ...current, [field.key]: value }))
              }
            />
          ))}
        </div>
      ) : null}

      <label className="flex items-start gap-2 rounded-md border border-line bg-surface-2 p-3">
        <Checkbox
          checked={accepted}
          onCheckedChange={(checked) => onAcceptedChange(checked === true)}
        />
        <span className="text-[12px] leading-relaxed text-fg">
          I understand what {plugin.name} can reach and I grant it these permissions for this
          team.
        </span>
      </label>
    </div>
  );
}

function ConfigField({
  field,
  value,
  stored,
  replacing,
  disabled,
  onReplace,
  onChange,
}: {
  field: PluginConfigFieldView;
  value: string;
  stored: boolean;
  replacing: boolean;
  disabled: boolean;
  onReplace: () => void;
  onChange: (value: string) => void;
}) {
  const masked = field.secret && stored && !replacing;

  return (
    <Field disabled={disabled}>
      <FieldLabel htmlFor={`plugin-cfg-${field.key}`} required={field.required}>
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
            disabled={disabled}
            onClick={onReplace}
          >
            Replace
          </Button>
        </div>
      ) : (
        <Input
          id={`plugin-cfg-${field.key}`}
          mono
          type={field.secret ? 'password' : 'text'}
          autoComplete="off"
          value={value}
          placeholder={field.default ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.description ? <FieldHint>{field.description}</FieldHint> : null}
    </Field>
  );
}
