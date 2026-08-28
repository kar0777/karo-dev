'use client';

import { Boxes, CircleStop, ExternalLink, Moon, Play, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { SANDBOX_STATUS_META } from '@/components/app/meta';
import {
  Badge,
  Button,
  EmptyState,
  Meter,
  SegmentedControl,
  StatusDot,
  toast,
} from '@/components/ui';
import { WORKER_STATUS_COPY, type WorkerLiveStatus } from '@/lib/account/byos-shared';
import { apiFetch, describeError } from '@/lib/client/api';
import type { SandboxStatus } from '@/lib/db/schema';
import {
  formatBytes,
  formatDuration,
  formatHours,
  formatMicroUsd,
  formatRelativeTime,
} from '@/lib/utils';

/**
 * The team's machines, with the lifecycle controls that act on them.
 *
 * Every action here goes through `/api/sandboxes/[sandboxId]/…`, which meters
 * the compute window it closes. That is why each toast reports what was billed
 * rather than a bare "done": stopping a sandbox settles money, and the number
 * should be in front of the person who caused it.
 */

export type SandboxFilter = 'current' | 'all';

export type TeamSandboxView = {
  id: string;
  name: string;
  status: SandboxStatus;
  statusMessage: string | null;
  /** Human name of the provider, from `PROVIDER_META` on the server. */
  providerLabel: string;
  /** False for the simulator and own-server machines: metered, never charged. */
  providerBilled: boolean;
  projectId: string | null;
  projectName: string | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  cpuPercent: number;
  memoryUsedMb: number;
  diskUsedMb: number;
  processCount: number;
  computeMultiplier: number;
  autoSleepMinutes: number;
  networkPolicy: string;
  allowDocker: boolean;
  /** Seconds the currently open compute window has been running; 0 if stopped. */
  uptimeSeconds: number;
  totalActiveSeconds: number;
  periodComputeHours: number;
  periodChargedMicroUsd: number;
  periodWindows: number;
  previewUrls: readonly { port: string; url: string }[];
  worker: { name: string; status: WorkerLiveStatus } | null;
  lastActiveAt: string | null;
};

export type SandboxesViewProps = {
  sandboxes: readonly TeamSandboxView[];
  filter: SandboxFilter;
  /**
   * Destroyed rows the team still has. Distinguishes "you have never had a
   * machine" from "every machine you had is gone" — the empty state must not
   * assert a destruction that never happened.
   */
  destroyedCount: number;
  /** The query hit its row cap, so older machines are missing from the list. */
  truncated: boolean;
  /** `sandbox.create` — the permission the start route itself enforces. */
  canStart: boolean;
  /** `sandbox.stop` — covers stop, sleep and restart. */
  canStop: boolean;
};

type Action = 'start' | 'stop' | 'sleep' | 'restart';

const STATUS_BADGE: Record<
  SandboxStatus,
  'primary' | 'info' | 'warning' | 'danger' | 'neutral'
> = {
  creating: 'warning',
  starting: 'warning',
  running: 'primary',
  sleeping: 'info',
  stopping: 'warning',
  stopped: 'neutral',
  failed: 'danger',
  destroyed: 'neutral',
};

const STARTABLE: readonly SandboxStatus[] = ['sleeping', 'stopped', 'failed'];
const STOPPABLE: readonly SandboxStatus[] = ['creating', 'starting', 'running'];
const RESTARTABLE: readonly SandboxStatus[] = ['running', 'sleeping'];

export function SandboxesView({
  sandboxes,
  filter,
  destroyedCount,
  truncated,
  canStart,
  canStop,
}: SandboxesViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(next: SandboxFilter) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next === 'current') params.delete('status');
    else params.set('status', next);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SegmentedControl<SandboxFilter>
          size="sm"
          aria-label="Which sandboxes to show"
          value={filter}
          options={[
            { value: 'current', label: 'Current' },
            { value: 'all', label: 'All', title: 'Includes machines that have been destroyed' },
          ]}
          onValueChange={push}
        />

        {!canStart && !canStop ? (
          <p className="text-[12px] text-subtle">
            Your role can see the machines but not start or stop them. A Developer or above can.
          </p>
        ) : null}
      </div>

      {sandboxes.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={
            filter === 'current' && destroyedCount > 0
              ? 'No machines allocated'
              : 'This team has never had a sandbox'
          }
          description={
            filter === 'current' && destroyedCount > 0
              ? `Every machine this team allocated has been destroyed (${destroyedCount} of them). Open a project and send the agent a message to have a fresh one provisioned, seeded from that project’s files.`
              : 'A sandbox is provisioned the first time the agent needs a shell or the filesystem in one of your projects. Open a project and send a message to get one.'
          }
          action={
            <Button asChild size="sm">
              <Link href="/app/projects">Open projects</Link>
            </Button>
          }
          secondaryAction={
            // Only offered when switching would actually reveal something.
            filter === 'current' && destroyedCount > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => push('all')}>
                Show destroyed machines
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <ul className="space-y-2.5">
            {sandboxes.map((sandbox) => (
              <li key={sandbox.id}>
                <SandboxCard
                  sandbox={sandbox}
                  canStart={canStart}
                  canStop={canStop}
                  onDone={() => router.refresh()}
                />
              </li>
            ))}
          </ul>

          {truncated ? (
            <p className="text-[12px] text-subtle">
              Showing the {sandboxes.length} most recently updated machines. Older ones are not
              listed here, but the tiles above still count every one of them.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  One machine
 * ------------------------------------------------------------------ */

function SandboxCard({
  sandbox,
  canStart,
  canStop,
  onDone,
}: {
  sandbox: TeamSandboxView;
  canStart: boolean;
  canStop: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState<Action | null>(null);
  const meta = SANDBOX_STATUS_META[sandbox.status];
  const running = sandbox.status === 'running';

  async function run(action: Action) {
    setBusy(action);
    try {
      if (action === 'start') {
        const result = await apiFetch<{ alreadyRunning: boolean }>(
          `/api/sandboxes/${sandbox.id}/start`,
          { method: 'POST' },
        );
        if (result.alreadyRunning) {
          toast.info(`${sandbox.name} was already running`, {
            description: 'No new compute window was opened, so nothing extra was billed.',
          });
        } else {
          toast.success(`${sandbox.name} is running`, {
            description: `Compute is metered from now until it stops, or sleeps after ${sandbox.autoSleepMinutes} minutes without a command.`,
          });
        }
      } else if (action === 'restart') {
        // The route stops before it starts, but it only *meters* something if a
        // window was actually open. A sleeping machine has none, so claiming the
        // previous run was billed would be a charge the user never incurred.
        const hadOpenWindow = running;
        await apiFetch(`/api/sandboxes/${sandbox.id}/restart`, { method: 'POST' });
        toast.success(`${sandbox.name} restarted`, {
          description: hadOpenWindow
            ? 'The run that was open has been metered and closed, and a new compute window is open. Processes inside the machine did not survive.'
            : 'It was not running, so nothing was metered for the state it was in. A new compute window is open from now.',
        });
      } else {
        const sleep = action === 'sleep';
        const result = await apiFetch<{ billedSeconds: number }>(
          `/api/sandboxes/${sandbox.id}/stop`,
          { method: 'POST', json: { sleep } },
        );
        // A machine that was already down has no open window, so there is
        // nothing to report as billed — saying "0ms" would read as a rounding
        // artefact rather than "you were not charged".
        const settled =
          result.billedSeconds > 0
            ? `${formatDuration(result.billedSeconds * 1000)} of compute was metered and that charge is now final.`
            : 'No compute window was open, so nothing was billed.';
        toast.success(sleep ? `${sandbox.name} is asleep` : `${sandbox.name} stopped`, {
          description: sleep
            ? `${settled} The machine wakes by itself on the next command.`
            : `${settled} Files already synced to the project are kept.`,
        });
      }
      onDone();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(null);
    }
  }

  const facts = [
    // CPU is a plain figure rather than a meter: providers disagree on the
    // denominator — Docker reports it per-core, Daytona clamps it at 100 — so a
    // bar would need a ceiling that is only right for some machines.
    running ? `${Math.round(sandbox.cpuPercent)}% CPU` : null,
    running ? `${sandbox.processCount} processes` : null,
    `${sandbox.computeMultiplier.toFixed(2)}× compute rate`,
    `sleeps after ${sandbox.autoSleepMinutes} min idle`,
    sandbox.networkPolicy === 'none' ? 'no network access' : `${sandbox.networkPolicy} network`,
    sandbox.allowDocker ? 'Docker allowed' : null,
    sandbox.totalActiveSeconds > 0
      ? `${formatDuration(sandbox.totalActiveSeconds * 1000)} run in total`
      : null,
    sandbox.providerBilled ? null : 'metered, not billed',
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={meta.dot} label={null} />
            <span className="truncate text-[13px] font-medium text-fg">{sandbox.name}</span>
            <Badge size="sm" variant={STATUS_BADGE[sandbox.status]}>
              {meta.label}
            </Badge>
            <Badge size="sm" variant="outline">
              {sandbox.providerLabel}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {sandbox.statusMessage ?? meta.detail}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {canStart && STARTABLE.includes(sandbox.status) ? (
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<Play />}
              loading={busy === 'start'}
              disabled={busy !== null}
              onClick={() => run('start')}
            >
              Start
            </Button>
          ) : null}

          {canStop && STOPPABLE.includes(sandbox.status) ? (
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<CircleStop />}
              loading={busy === 'stop'}
              disabled={busy !== null}
              onClick={() => run('stop')}
            >
              Stop
            </Button>
          ) : null}

          {canStop && running ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Put to sleep — stops billing, wakes on the next command"
              aria-label={`Put ${sandbox.name} to sleep`}
              loading={busy === 'sleep'}
              disabled={busy !== null}
              onClick={() => run('sleep')}
            >
              <Moon />
            </Button>
          ) : null}

          {canStop && RESTARTABLE.includes(sandbox.status) ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Restart — billed as two compute windows, not one"
              aria-label={`Restart ${sandbox.name}`}
              loading={busy === 'restart'}
              disabled={busy !== null}
              onClick={() => run('restart')}
            >
              <RotateCcw />
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="karo-numeric mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[12px] sm:grid-cols-4">
        <Detail label="Project">
          {sandbox.projectId && sandbox.projectName ? (
            <Link
              href={`/app/projects/${sandbox.projectId}`}
              className="rounded-sm text-fg transition-colors duration-150 ease-[var(--k-ease)] hover:text-primary"
            >
              {sandbox.projectName}
            </Link>
          ) : (
            <span className="text-muted">Not attached to a project</span>
          )}
        </Detail>

        <Detail label="Size">
          {sandbox.cpuCores} vCPU · {formatBytes(sandbox.memoryMb * 1024 * 1024, 0)} ·{' '}
          {sandbox.diskGb} GB disk
        </Detail>

        <Detail label={running ? 'Uptime' : 'Last active'}>
          {running
            ? formatDuration(sandbox.uptimeSeconds * 1000)
            : sandbox.lastActiveAt
              ? formatRelativeTime(sandbox.lastActiveAt)
              : 'Never used'}
        </Detail>

        <Detail
          label="Compute this period"
          title={
            running
              ? `${sandbox.periodWindows} closed ${sandbox.periodWindows === 1 ? 'run' : 'runs'} so far. The window open right now is priced when it stops.`
              : `${sandbox.periodWindows} closed ${sandbox.periodWindows === 1 ? 'run' : 'runs'} since the period started.`
          }
        >
          {formatHours(sandbox.periodComputeHours)}
          <span className="ml-1.5 text-ember">
            {formatMicroUsd(sandbox.periodChargedMicroUsd)}
          </span>
        </Detail>
      </dl>

      {running ? (
        <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <Meter
            label="Memory"
            value={sandbox.memoryUsedMb}
            max={sandbox.memoryMb}
            caption={`${formatBytes(sandbox.memoryUsedMb * 1024 * 1024, 0)} / ${formatBytes(
              sandbox.memoryMb * 1024 * 1024,
              0,
            )}`}
          />
          <Meter
            label="Disk"
            value={sandbox.diskUsedMb}
            max={sandbox.diskGb * 1024}
            caption={`${formatBytes(sandbox.diskUsedMb * 1024 * 1024, 1)} / ${formatBytes(
              sandbox.diskGb * 1024 * 1024 * 1024,
              0,
            )}`}
          />
        </div>
      ) : null}

      {sandbox.previewUrls.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-[11px] tracking-wide text-subtle uppercase">Preview</span>
          {sandbox.previewUrls.map((preview) =>
            running ? (
              <Button
                key={preview.port}
                asChild
                variant="secondary"
                size="xs"
                iconRight={<ExternalLink />}
              >
                <a href={preview.url} target="_blank" rel="noreferrer noopener">
                  Port {preview.port}
                </a>
              </Button>
            ) : (
              <span key={preview.port} className="karo-numeric text-[11px] text-muted">
                Port {preview.port} — serves again once the machine is running
              </span>
            ),
          )}
        </div>
      ) : null}

      {sandbox.worker ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
          <StatusDot
            size="sm"
            status={WORKER_STATUS_COPY[sandbox.worker.status].dot}
            label={null}
          />
          Runs on {sandbox.worker.name} —{' '}
          {WORKER_STATUS_COPY[sandbox.worker.status].label.toLowerCase()}.
        </p>
      ) : null}

      <p className="karo-numeric mt-2 text-[11px] text-subtle">{facts.join(' · ')}</p>
    </div>
  );
}

function Detail({
  label,
  children,
  title,
}: {
  label: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="truncate text-fg" title={title}>
        {children}
      </dd>
    </div>
  );
}
