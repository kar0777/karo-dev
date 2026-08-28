'use client';

import {
  Activity,
  ChevronRight,
  Cpu,
  ExternalLink,
  HardDrive,
  MemoryStick,
  Play,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { StatusDot, type StatusDotStatus } from '@/components/ui/dot';
import { Meter } from '@/components/ui/meter';
import { SegmentedControl } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AGENT_MODES, AGENT_MODE_META, AGENT_PERMISSION_META } from '@/lib/agent/policy';
import type { AgentPermissionKey } from '@/lib/agent/policy';
import type { AgentMode, SandboxStatus } from '@/lib/db/schema';
import {
  cn,
  formatCompactNumber,
  formatMicroUsd,
  formatRelativeTime,
  pluralize,
} from '@/lib/utils';

import { useWorkspace } from './workspace-context';

/**
 * The right rail: the machine, the money and the permissions.
 *
 * Everything here answers "what is this run costing me and what is it allowed
 * to do" — the two questions a cloud agent must never make you hunt for.
 */

const SANDBOX_DOT: Record<SandboxStatus, StatusDotStatus> = {
  creating: 'pending',
  starting: 'pending',
  running: 'live',
  sleeping: 'sleeping',
  stopping: 'pending',
  stopped: 'off',
  failed: 'error',
  destroyed: 'off',
};

const SANDBOX_LABEL: Record<SandboxStatus, string> = {
  creating: 'Creating',
  starting: 'Starting',
  running: 'Running',
  sleeping: 'Asleep',
  stopping: 'Stopping',
  stopped: 'Stopped',
  failed: 'Failed',
  destroyed: 'Destroyed',
};

function Section({
  title,
  icon,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b border-line">
      <div className="flex items-center gap-1.5 px-3 py-2">
        <CollapsibleTrigger className="group/sec flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight
            aria-hidden="true"
            className="size-3 shrink-0 text-subtle transition-transform duration-150 group-data-[state=open]/sec:rotate-90"
          />
          <span aria-hidden="true" className="shrink-0 text-subtle">
            {icon}
          </span>
          <span className="truncate text-[11px] font-medium tracking-wide text-subtle uppercase">
            {title}
          </span>
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>
        <div className="px-3 pb-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SandboxCard() {
  const { sandbox, sandboxBusy, startSandbox, stopSandbox, restartSandbox, data } =
    useWorkspace();

  if (!sandbox) {
    return (
      <div>
        <p className="text-[12px] leading-relaxed text-muted">
          No machine is attached to this project. The agent can read and reason about the code,
          but cannot run anything until you give it one.
        </p>
        {data.capabilities.canCreateSandbox ? (
          <Button size="sm" variant="secondary" className="mt-2 w-full" asChild>
            <Link href="/app/sandboxes">Create a sandbox</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  const running = sandbox.status === 'running';
  const memoryPercent = sandbox.memoryMb > 0 ? sandbox.memoryUsedMb / sandbox.memoryMb : 0;
  const diskLimitMb = sandbox.diskGb * 1024;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <StatusDot status={SANDBOX_DOT[sandbox.status]} label={null} />
        <span className="truncate text-[12.5px] font-medium text-fg">{sandbox.name}</span>
        <Badge variant={running ? 'primary' : 'neutral'} size="sm" className="ml-auto">
          {SANDBOX_LABEL[sandbox.status]}
        </Badge>
      </div>

      <p className="karo-numeric text-[11.5px] text-subtle">
        {sandbox.cpuCores} vCPU · {sandbox.memoryMb} MB · {sandbox.diskGb} GB ·{' '}
        {sandbox.provider}
      </p>

      {sandbox.statusMessage ? (
        <p className="text-[11.5px] leading-snug text-muted">{sandbox.statusMessage}</p>
      ) : null}

      <div className="flex gap-1.5">
        {running ? (
          <Button
            size="xs"
            variant="secondary"
            className="flex-1"
            loading={sandboxBusy}
            iconLeft={<Square />}
            onClick={stopSandbox}
            disabled={!data.capabilities.canManageSandbox}
          >
            Stop
          </Button>
        ) : (
          <Button
            size="xs"
            variant="primary"
            className="flex-1"
            loading={sandboxBusy}
            iconLeft={<Play />}
            onClick={startSandbox}
            disabled={!data.capabilities.canManageSandbox}
          >
            Start
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          loading={sandboxBusy}
          iconLeft={<RefreshCw />}
          onClick={restartSandbox}
          disabled={!data.capabilities.canManageSandbox}
        >
          Restart
        </Button>
      </div>

      {running ? (
        <div className="space-y-2 border-t border-line pt-2.5">
          <Meter
            value={sandbox.cpuPercent}
            max={100}
            label={
              <span className="inline-flex items-center gap-1">
                <Cpu aria-hidden="true" className="size-3" /> CPU
              </span>
            }
            caption={`${Math.round(sandbox.cpuPercent)}%`}
            aria-label="CPU usage"
          />
          <Meter
            value={sandbox.memoryUsedMb}
            max={sandbox.memoryMb}
            label={
              <span className="inline-flex items-center gap-1">
                <MemoryStick aria-hidden="true" className="size-3" /> Memory
              </span>
            }
            caption={`${sandbox.memoryUsedMb} / ${sandbox.memoryMb} MB`}
            tone={memoryPercent > 0.9 ? 'danger' : undefined}
            aria-label="Memory usage"
          />
          <Meter
            value={sandbox.diskUsedMb}
            max={diskLimitMb}
            label={
              <span className="inline-flex items-center gap-1">
                <HardDrive aria-hidden="true" className="size-3" /> Disk
              </span>
            }
            caption={`${(sandbox.diskUsedMb / 1024).toFixed(1)} / ${sandbox.diskGb} GB`}
            aria-label="Disk usage"
          />
          <p className="karo-numeric text-[11px] text-subtle">
            {sandbox.processCount} {pluralize(sandbox.processCount, 'process', 'processes')} ·
            sleeps after {sandbox.autoSleepMinutes} min idle
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PermissionSummary() {
  const { data, mode } = useWorkspace();
  const entries = Object.entries(data.project.permissions) as Array<
    [AgentPermissionKey, boolean]
  >;
  const granted = entries.filter(([, value]) => value);
  const capped = mode === 'ask' || mode === 'plan';

  return (
    <div className="space-y-2">
      <p className="text-[12px] leading-relaxed text-muted">
        {granted.length} of {entries.length} agent permissions are granted for this project.
        {capped
          ? ` ${AGENT_MODE_META[mode].label} mode narrows them further — nothing is written or executed.`
          : ''}
      </p>
      <ul className="flex flex-wrap gap-1">
        {granted.slice(0, 8).map(([key]) => (
          <li key={key}>
            <Badge
              variant={AGENT_PERMISSION_META[key].risk === 'high' ? 'ember' : 'neutral'}
              size="sm"
            >
              {AGENT_PERMISSION_META[key].label}
            </Badge>
          </li>
        ))}
      </ul>
      <Button size="xs" variant="ghost" className="w-full justify-start" asChild>
        <Link href="/app/settings">
          Change agent permissions
          <ExternalLink className="ml-auto size-3" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

const ACTIVITY_TONE = {
  info: 'text-muted',
  success: 'text-primary',
  warning: 'text-warning-soft-fg',
  error: 'text-danger',
} as const;

export function RightRail() {
  const { data, modelId, setModelId, mode, setMode, sessionUsage, activity, sandbox } =
    useWorkspace();

  const modeOptions = React.useMemo(
    () =>
      AGENT_MODES.map((value) => ({
        value,
        label: AGENT_MODE_META[value].label,
        title: AGENT_MODE_META[value].description,
      })),
    [],
  );

  const activeModel = data.models.find((model) => model.id === modelId) ?? null;
  const connectedMcp = data.mcpServers.filter((server) => server.status === 'connected').length;
  const enabledSkills = data.skills.filter((skill) => skill.isEnabled);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface">
      <Section title="Agent" icon={<Sparkles className="size-3.5" />}>
        <div className="space-y-2.5">
          <div>
            <label
              htmlFor="right-rail-model"
              className="mb-1 block text-[11.5px] font-medium text-muted"
            >
              Model
            </label>
            <Select value={modelId ?? undefined} onValueChange={setModelId}>
              <SelectTrigger id="right-rail-model" size="sm">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {data.models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeModel ? (
              <p className="karo-numeric mt-1 text-[11px] text-subtle">
                {formatCompactNumber(activeModel.contextWindow)} context ·{' '}
                {formatMicroUsd(activeModel.inputMicroUsdPerMtok)} /{' '}
                {formatMicroUsd(activeModel.outputMicroUsdPerMtok)} per Mtok
              </p>
            ) : null}
          </div>

          <div>
            <span
              className="mb-1 block text-[11.5px] font-medium text-muted"
              id="right-rail-mode"
            >
              Mode
            </span>
            <SegmentedControl<AgentMode>
              options={modeOptions}
              value={mode}
              onValueChange={setMode}
              size="sm"
              fullWidth
              aria-labelledby="right-rail-mode"
            />
            <p className="mt-1 text-[11px] leading-snug text-subtle">
              {AGENT_MODE_META[mode].description}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Machine" icon={<Cpu className="size-3.5" />}>
        <SandboxCard />
      </Section>

      <Section title="Session cost" icon={<Activity className="size-3.5" />}>
        <dl className="space-y-1.5 text-[12px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Weighted tokens</dt>
            <dd className="karo-numeric font-medium text-fg">
              {formatCompactNumber(sessionUsage.weightedTokens)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Charged this session</dt>
            <dd className="karo-numeric font-medium text-ember-soft-fg">
              {formatMicroUsd(sessionUsage.chargedMicroUsd, { precise: true })}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Responses</dt>
            <dd className="karo-numeric text-fg">{sessionUsage.messages}</dd>
          </div>
        </dl>

        {data.quota.includedWeightedTokens > 0 ? (
          <Meter
            className="mt-2.5"
            value={data.quota.weightedTokensUsed}
            max={data.quota.includedWeightedTokens}
            label={`${data.quota.planName} allowance`}
            caption={`${formatCompactNumber(data.quota.weightedTokensUsed)} / ${formatCompactNumber(data.quota.includedWeightedTokens)}`}
          />
        ) : (
          <p className="karo-numeric mt-2.5 text-[11.5px] text-muted">
            Pay-as-you-go balance {formatMicroUsd(data.quota.balanceMicroUsd)}
          </p>
        )}
        <Button size="xs" variant="ghost" className="mt-1.5 w-full justify-start" asChild>
          <Link href="/app/usage">
            Full usage breakdown
            <ExternalLink className="ml-auto size-3" aria-hidden="true" />
          </Link>
        </Button>
      </Section>

      <Section
        title="MCP connections"
        icon={<Plug className="size-3.5" />}
        defaultOpen={false}
        action={
          <Badge variant={connectedMcp > 0 ? 'primary' : 'neutral'} size="sm">
            {connectedMcp}/{data.mcpServers.length}
          </Badge>
        }
      >
        {data.mcpServers.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted">
            No MCP servers connected. Add one to give the agent tools from your own systems.
          </p>
        ) : (
          <ul className="space-y-1">
            {data.mcpServers.map((server) => (
              <li key={server.id} className="flex items-center gap-2 text-[12px]">
                <StatusDot
                  status={
                    server.status === 'connected'
                      ? 'live'
                      : server.status === 'error'
                        ? 'error'
                        : server.status === 'connecting'
                          ? 'pending'
                          : 'off'
                  }
                  size="sm"
                  label={null}
                />
                <span className="min-w-0 flex-1 truncate text-fg">{server.name}</span>
                <span className="karo-numeric shrink-0 text-[11px] text-subtle">
                  {server.toolCount} {pluralize(server.toolCount, 'tool')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button size="xs" variant="ghost" className="mt-1.5 w-full justify-start" asChild>
          <Link href="/app/mcp">
            Manage MCP servers
            <ExternalLink className="ml-auto size-3" aria-hidden="true" />
          </Link>
        </Button>
      </Section>

      <Section
        title="Skills"
        icon={<Sparkles className="size-3.5" />}
        defaultOpen={false}
        action={
          <Badge variant="neutral" size="sm">
            {enabledSkills.length}
          </Badge>
        }
      >
        {enabledSkills.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted">
            No skills installed. Skills teach the agent a repeatable procedure and can add their
            own slash commands.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {enabledSkills.map((skill) => (
              <li key={skill.id}>
                <p className="truncate text-[12px] font-medium text-fg">{skill.name}</p>
                <p className="karo-truncate-2 text-[11px] leading-snug text-muted">
                  {skill.description}
                </p>
                {skill.commands.length > 0 ? (
                  <p className="mt-0.5 font-mono text-[10.5px] text-subtle">
                    {skill.commands.map((command) => `/${command.name}`).join(' ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <Button size="xs" variant="ghost" className="mt-1.5 w-full justify-start" asChild>
          <Link href="/app/skills">
            Browse skills
            <ExternalLink className="ml-auto size-3" aria-hidden="true" />
          </Link>
        </Button>
      </Section>

      <Section
        title="Permissions"
        icon={<ShieldCheck className="size-3.5" />}
        defaultOpen={false}
      >
        <PermissionSummary />
      </Section>

      <Section title="Activity" icon={<Activity className="size-3.5" />} defaultOpen={false}>
        {activity.length === 0 ? (
          <p className="text-[12px] text-muted">
            Nothing yet. Runs, approvals and machine events show up here as they happen.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {activity.slice(0, 30).map((entry) => (
              <li key={entry.id} className="text-[11.5px] leading-snug">
                <span className={cn('font-medium', ACTIVITY_TONE[entry.level])}>
                  {entry.message}
                </span>
                {entry.detail ? (
                  <span className="block text-subtle">{entry.detail}</span>
                ) : null}
                <time
                  className="karo-numeric block text-[10.5px] text-subtle"
                  dateTime={entry.at}
                >
                  {formatRelativeTime(entry.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {sandbox ? (
        <p className="px-3 py-2 text-[10.5px] text-subtle">
          Machine id <code className="font-mono">{sandbox.id}</code>
        </p>
      ) : null}
    </div>
  );
}
