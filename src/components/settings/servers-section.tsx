'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Cpu,
  HardDrive,
  MemoryStick,
  Plus,
  RefreshCw,
  ServerOff,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import { WORKER_STATUS_COPY, type WorkerView } from '@/lib/account/byos-shared';
import { apiFetch, describeError } from '@/lib/client/api';
import { cn, formatBytes, formatDateTime, formatRelativeTime } from '@/lib/utils';
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
  CodeBlock,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  StatusDot,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '@/components/ui';

export type ServersSectionProps = {
  workers: WorkerView[];
  canManage: boolean;
  allowOwnServer: boolean;
  planName: string;
  /** Built by `buildInstallCommand` so this and the token dialog cannot diverge. */
  installCommandExample: string;
  installCommandExampleWindows: string;
};

type IssuedToken = {
  workerName: string;
  token: string;
  command: string;
  commandWindows: string;
  expiresAt: string;
  rotated: boolean;
};

export function ServersSection({
  workers,
  canManage,
  allowOwnServer,
  planName,
  installCommandExample,
  installCommandExampleWindows,
}: ServersSectionProps) {
  const router = useRouter();
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [issued, setIssued] = React.useState<IssuedToken | null>(null);

  function handleIssued(token: IssuedToken) {
    setRegisterOpen(false);
    setIssued(token);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {!allowOwnServer ? (
        <Alert variant="warning">
          <AlertTitle>Own servers are not included in {planName}</AlertTitle>
          <AlertDescription>
            Sandboxes for this team run on Karo&apos;s infrastructure. Upgrade to run them on
            hardware you control — your own VPS, a workstation, or a box behind a firewall.{' '}
            <Link href="/app/billing" className="font-medium text-primary hover:underline">
              Compare plans
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <HowItWorks
        installCommandExample={installCommandExample}
        installCommandExampleWindows={installCommandExampleWindows}
      />

      <Card>
        <CardHeader>
          <CardTitle>Your servers</CardTitle>
          <CardDescription>
            Machines running the Karo worker agent. A server appears here the moment its agent
            completes its first handshake.
          </CardDescription>
          <div className="mt-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      iconLeft={<Plus />}
                      disabled={!canManage || !allowOwnServer}
                      onClick={() => setRegisterOpen(true)}
                    >
                      Register a server
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canManage || !allowOwnServer ? (
                  <TooltipContent>
                    {!allowOwnServer
                      ? `The ${planName} plan does not include your own servers.`
                      : 'Only team owners and admins can register servers.'}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>

        <CardContent className={workers.length === 0 ? undefined : 'space-y-2.5'}>
          {workers.length === 0 ? (
            <EmptyState
              icon={ServerOff}
              size="sm"
              title="No servers connected"
              description="Register a machine to run sandboxes on your own hardware. It needs outbound HTTPS and rootless Docker — nothing else."
            />
          ) : (
            workers.map((worker) => (
              <WorkerRow
                key={worker.id}
                worker={worker}
                canManage={canManage}
                onRotated={(token) => setIssued(token)}
              />
            ))
          )}
        </CardContent>
      </Card>

      <RegisterDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onIssued={handleIssued}
      />

      <TokenDialog
        issued={issued}
        onClose={() => {
          setIssued(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Explanation
 * ------------------------------------------------------------------ */

function HowItWorks({
  installCommandExample,
  installCommandExampleWindows,
}: {
  /** Built by `buildInstallCommand` so this and the token dialog cannot diverge. */
  installCommandExample: string;
  installCommandExampleWindows: string;
}) {
  const steps = [
    {
      title: 'You generate a one-time installation token',
      body: 'It is valid for one hour and can be redeemed once. Karo stores only its SHA-256, so the value is shown to you exactly once and can never be recovered.',
    },
    {
      title: 'The agent trades it for a long-lived worker token',
      body: 'One command downloads the agent from this Karo install — a single dependency-free Node file you can read before running it — installs it as a service on your machine, then registers, reports CPU, memory and disk, and burns the installation token in the same request.',
    },
    {
      title: 'The agent long-polls Karo for work',
      body: 'It holds an outbound HTTPS request open for 25 seconds at a time. Karo never dials in, so your machine needs no public IP, no port forward and no firewall exception.',
    },
    {
      title: 'Commands run in rootless Docker on your machine',
      // The compute is genuinely free here: the BYOS provider declares
      // `computeMultiplier = 0` (lib/sandbox/providers/remote-docker.ts), which
      // zeroes the rate in `calculateComputeMultiplier`. This used to claim the
      // opposite — "metered against your plan like any other sandbox" — which
      // contradicted both the pricing code and the landing page. Model tokens are
      // still billed; it is your hardware, not Karo's models.
      body: 'Each sandbox is a container the agent creates locally. Output streams back over the same outbound connection. Seconds are still metered so you can see the usage, but compute on your own hardware is charged at zero — only the model tokens a run spends are billed.',
    },
    {
      title: 'You can cut it off at any time',
      body: 'Revoke invalidates both tokens immediately and fails every command already in flight. Rotate issues a fresh installation token for the same machine.',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>How the connection works</CardTitle>
        <CardDescription>
          Bring Your Own Server is outbound-only by design. Karo holds no credentials for your
          machine.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="karo-numeric mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[11px] font-medium text-muted"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-fg">{step.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted">
            The install command, for reference
          </p>
          <InstallCommandBlock
            sh={installCommandExample}
            powershell={installCommandExampleWindows}
          />
        </div>

        <Alert variant="primary" icon={<ShieldCheck />}>
          <AlertTitle>Karo never asks for an SSH password or key</AlertTitle>
          <AlertDescription>
            There is no field for one anywhere in this product, and there never will be. Inbound
            SSH would mean Karo holding a credential that grants shell on your machine — a
            single breach here would become a breach of every connected server. The worker dials
            out instead, so the only secret involved is a token you can revoke from this page,
            and it only ever authorises &ldquo;ask Karo for work&rdquo;.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  One server
 * ------------------------------------------------------------------ */

/** How each runtime state reads on the card, and how loudly. */
const RUNTIME_COPY: Record<
  WorkerView['runtime'],
  { label: string; hint: string; tone: 'muted' | 'warning' | 'danger' }
> = {
  docker: { label: 'Docker', hint: '', tone: 'muted' },
  podman: { label: 'Podman', hint: '', tone: 'muted' },
  'dry-run': {
    label: 'Dry run',
    hint: 'the agent is simulating every command. Restart it without --dry-run to run real containers',
    tone: 'warning',
  },
  none: {
    label: 'None detected',
    hint: 'this machine can heartbeat but cannot run sandboxes. Install Docker, then restart the agent',
    tone: 'danger',
  },
  unknown: {
    label: 'Not reported yet',
    hint: 'this agent predates capability reporting. Update it to see what the machine can run',
    tone: 'muted',
  },
};

function WorkerRow({
  worker,
  canManage,
  onRotated,
}: {
  worker: WorkerView;
  canManage: boolean;
  onRotated: (token: IssuedToken) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'rotate' | 'revoke' | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState(false);
  const copy = WORKER_STATUS_COPY[worker.status];

  async function rotate() {
    setBusy('rotate');
    try {
      const result = await apiFetch<{
        installToken: string;
        installCommand: string;
        installCommandWindows: string;
        expiresAt: string;
      }>(`/api/workers/${worker.id}/rotate`, { method: 'POST' });

      onRotated({
        workerName: worker.name,
        token: result.installToken,
        command: result.installCommand,
        commandWindows: result.installCommandWindows,
        expiresAt: result.expiresAt,
        rotated: true,
      });
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setBusy('revoke');
    try {
      await apiFetch(`/api/workers/${worker.id}`, { method: 'DELETE' });
      setConfirmRevoke(false);
      toast.success(`${worker.name} revoked`, {
        description: 'Its tokens no longer work and queued commands were failed.',
      });
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(null);
    }
  }

  const specs: Array<{ icon: React.ReactNode; value: string }> = [];
  if (worker.cpuCores) {
    specs.push({
      icon: <Cpu className="size-3.5" aria-hidden="true" />,
      value: `${worker.cpuCores} vCPU`,
    });
  }
  if (worker.memoryMb) {
    specs.push({
      icon: <MemoryStick className="size-3.5" aria-hidden="true" />,
      value: formatBytes(worker.memoryMb * 1024 * 1024, 0),
    });
  }
  if (worker.diskGb) {
    specs.push({
      icon: <HardDrive className="size-3.5" aria-hidden="true" />,
      value: `${worker.diskGb} GB disk`,
    });
  }

  const runtime = RUNTIME_COPY[worker.runtime];

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={copy.dot} label={null} />
            <span className="truncate text-[13px] font-medium text-fg">{worker.name}</span>
            <Badge
              size="sm"
              variant={
                worker.status === 'online'
                  ? 'success'
                  : worker.status === 'revoked'
                    ? 'danger'
                    : worker.status === 'pending'
                      ? 'info'
                      : 'neutral'
              }
            >
              {copy.label}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">{copy.hint}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<RefreshCw />}
            loading={busy === 'rotate'}
            disabled={!canManage || busy !== null}
            onClick={rotate}
          >
            Rotate token
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Revoke ${worker.name}`}
            className="text-danger hover:bg-danger-soft hover:text-danger"
            disabled={!canManage || busy !== null || worker.status === 'revoked'}
            onClick={() => setConfirmRevoke(true)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      <dl className="karo-numeric mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[12px] sm:grid-cols-4">
        <Detail label="Hostname" value={worker.hostname ?? 'Not reported yet'} />
        <Detail
          label="Platform"
          value={
            worker.platform
              ? `${worker.platform}${worker.arch ? ` · ${worker.arch}` : ''}`
              : 'Not reported yet'
          }
        />
        <Detail label="Agent version" value={worker.agentVersion ?? '—'} />
        <Detail
          label="Last heartbeat"
          value={worker.lastHeartbeatAt ? formatRelativeTime(worker.lastHeartbeatAt) : 'Never'}
          title={worker.lastHeartbeatAt ? formatDateTime(worker.lastHeartbeatAt) : undefined}
        />
      </dl>

      {/*
        A server with no container runtime heartbeats normally and reads as
        Online, then fails every sandbox scheduled onto it. Saying so here is
        the difference between a two-minute fix and a support ticket.
      */}
      <p
        className={cn(
          'mt-2 text-[12px] leading-relaxed',
          runtime.tone === 'danger'
            ? 'text-danger'
            : runtime.tone === 'warning'
              ? 'text-warning-soft-fg'
              : 'text-muted',
        )}
      >
        <span className="font-medium text-fg">Container runtime:</span> {runtime.label}
        {runtime.hint ? ` — ${runtime.hint}` : ''}
      </p>

      {specs.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted">
          {specs.map((spec) => (
            <span key={spec.value} className="inline-flex items-center gap-1">
              {spec.icon}
              <span className="karo-numeric">{spec.value}</span>
            </span>
          ))}
        </div>
      ) : null}

      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {worker.name}?</DialogTitle>
            <DialogDescription>
              Its worker token stops working immediately and every command waiting on the
              machine fails with a clear error. Projects targeting this server will need another
              runtime until you reconnect it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmRevoke(false)}>
              Keep it connected
            </Button>
            <Button variant="danger" loading={busy === 'revoke'} onClick={revoke}>
              Revoke server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-subtle uppercase">{label}</dt>
      <dd className="truncate text-fg" title={title ?? value}>
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Register
 * ------------------------------------------------------------------ */

function RegisterDialog({
  open,
  onOpenChange,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: (token: IssuedToken) => void;
}) {
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Adjusted during render rather than from an effect so the reopened dialog
  // paints an empty field straight away instead of the previous server name.
  const [seenOpen, setSeenOpen] = React.useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    // Only on the way in — clearing while the dialog animates closed would be
    // visible to the user.
    if (open) {
      setName('');
      setError(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the server a name you will recognise in a list.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await apiFetch<{
        installToken: string;
        installCommand: string;
        installCommandWindows: string;
        expiresAt: string;
      }>('/api/workers', { method: 'POST', json: { name: trimmed } });

      onIssued({
        workerName: trimmed,
        token: result.installToken,
        command: result.installCommand,
        commandWindows: result.installCommandWindows,
        expiresAt: result.expiresAt,
        rotated: false,
      });
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Register a server</DialogTitle>
            <DialogDescription>
              Karo generates a one-time installation token. Run the command it gives you on the
              machine, and the server connects itself.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Field>
              <FieldLabel htmlFor="worker-name" required>
                Server name
              </FieldLabel>
              <Input
                id="worker-name"
                value={name}
                maxLength={60}
                autoFocus
                placeholder="build-box-01"
                onChange={(event) => setName(event.target.value)}
                aria-invalid={error ? true : undefined}
              />
              {error ? (
                <FieldError>{error}</FieldError>
              ) : (
                <FieldHint>
                  Only for your own reference. The agent reports the real hostname once it
                  connects.
                </FieldHint>
              )}
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Generate install command
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 *  The one-time reveal
 * ------------------------------------------------------------------ */

function TokenDialog({ issued, onClose }: { issued: IssuedToken | null; onClose: () => void }) {
  const [acknowledged, setAcknowledged] = React.useState(false);

  // Each issued token has to be acknowledged on its own, so the checkbox
  // resets whenever `issued` changes — notably when Rotate token replaces the
  // token while this dialog is already up. Adjusting during render instead of
  // from an effect means the new token is never shown with the previous one's
  // box still ticked and Done already enabled.
  const [seenIssued, setSeenIssued] = React.useState(issued);
  if (issued !== seenIssued) {
    setSeenIssued(issued);
    if (issued) setAcknowledged(false);
  }

  if (!issued) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {issued.rotated
              ? `New token for ${issued.workerName}`
              : `${issued.workerName} is ready to connect`}
          </DialogTitle>
          <DialogDescription>
            Run this one command on the machine. It installs the agent as a service that keeps
            running after you close the terminal and comes back after a reboot — no root needed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Alert variant="danger" icon={<TriangleAlert />}>
            <AlertTitle>You will not see this token again</AlertTitle>
            <AlertDescription>
              Karo stores only its SHA-256 hash, so this dialog is the one and only place the
              value exists. Copy it now — if you lose it, use Rotate token to issue a new one.
              This token expires {formatRelativeTime(issued.expiresAt)}.
            </AlertDescription>
          </Alert>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-muted">Installation token</span>
              <CopyButton
                value={issued.token}
                label="Copy token"
                variant="secondary"
                size="xs"
              />
            </div>
            <code className="block overflow-x-auto rounded-md border border-line bg-bg-inset px-3 py-2 font-mono text-[12.5px] break-all text-fg">
              {issued.token}
            </code>
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-muted">Install command</p>
            <InstallCommandBlock sh={issued.command} powershell={issued.commandWindows} />
          </div>

          <p className="text-[12px] leading-relaxed text-muted">
            The machine — Linux, macOS with Docker Desktop, or Windows 10/11 with Docker Desktop
            and Node — needs outbound HTTPS to Karo. It does{' '}
            <span className="font-medium text-fg">not</span> need a public IP, an open port, or
            any inbound access at all. On Linux the agent lands in a systemd user service (
            <code className="font-mono text-[11.5px] text-fg">
              journalctl --user -u karo-worker -f
            </code>{' '}
            for logs), on macOS in a LaunchAgent logging to{' '}
            <code className="font-mono text-[11.5px] text-fg">~/.karo/log/worker.log</code>.
            Re-running the command is safe — it refreshes the agent and re-registers.
          </p>

          <label className="flex items-start gap-2 text-[13px] text-fg">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--k-primary)]"
            />
            I have copied the token or run the command
          </label>
        </div>

        <DialogFooter>
          <Button
            variant={acknowledged ? 'primary' : 'secondary'}
            iconRight={<ArrowRight />}
            disabled={!acknowledged}
            onClick={onClose}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 *  Install command, per operating system
 * ------------------------------------------------------------------ */

/** The same one-time token, wrapped for bash (Linux, macOS) or PowerShell (Windows). */
function InstallCommandBlock({ sh, powershell }: { sh: string; powershell: string }) {
  const [target, setTarget] = React.useState<'sh' | 'powershell'>('sh');

  return (
    <div>
      <div className="mb-1.5 flex gap-1.5" role="group" aria-label="Server operating system">
        {(
          [
            ['sh', 'Linux / macOS'],
            ['powershell', 'Windows'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            size="xs"
            variant={target === value ? 'primary' : 'secondary'}
            onClick={() => setTarget(value)}
            aria-pressed={target === value}
          >
            {label}
          </Button>
        ))}
      </div>
      <CodeBlock
        language={target === 'sh' ? 'bash' : 'powershell'}
        code={target === 'sh' ? sh : powershell}
        filename={target === 'sh' ? 'run on your server' : 'run in PowerShell'}
      />
    </div>
  );
}
