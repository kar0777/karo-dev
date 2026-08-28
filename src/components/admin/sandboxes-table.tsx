'use client';

import { Boxes, CircleStop, Trash2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import type { AdminSandboxRow } from '@/app/admin/_data/sandboxes';
import { Money } from '@/components/admin/primitives';
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
import { StatusDot } from '@/components/ui/dot';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { SegmentedControl } from '@/components/ui/segmented';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import { formatBytes, formatDuration, formatRelativeTime } from '@/lib/utils';

/** The whole fleet, with the two operator actions that exist for it. */

const STATUS_DOT: Record<string, 'live' | 'idle' | 'sleeping' | 'error' | 'pending' | 'off'> = {
  creating: 'pending',
  starting: 'pending',
  running: 'live',
  sleeping: 'sleeping',
  stopping: 'pending',
  stopped: 'off',
  failed: 'error',
  destroyed: 'off',
};

type PendingAction = { sandbox: AdminSandboxRow; action: 'stop' | 'destroy' };

export function SandboxesTable({
  sandboxes,
  providers,
  filters,
}: {
  sandboxes: AdminSandboxRow[];
  providers: string[];
  filters: { status: string; provider: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = React.useState<PendingAction | null>(null);

  function push(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === 'all') params.delete(key);
      else params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          aria-label="Sandbox status"
          value={filters.status}
          options={[
            { value: 'live', label: 'Live' },
            { value: 'running', label: 'Running' },
            { value: 'sleeping', label: 'Sleeping' },
            { value: 'failed', label: 'Failed' },
            { value: 'all', label: 'All' },
          ]}
          onValueChange={(value) => push({ status: value })}
        />

        {providers.length > 1 ? (
          <SegmentedControl
            size="sm"
            aria-label="Sandbox provider"
            value={filters.provider}
            options={[
              { value: 'all', label: 'Any provider' },
              ...providers.map((provider) => ({ value: provider, label: provider })),
            ]}
            onValueChange={(value) => push({ provider: value })}
          />
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {sandboxes.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Boxes}
            title="No sandboxes match this filter"
            description="Nothing on the platform is in this state right now. Switch the filter to “All” to see stopped and destroyed machines too."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => push({ status: 'all', provider: null })}
              >
                Show all
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sandbox</TableHead>
                <TableHead className="hidden md:table-cell">Team</TableHead>
                <TableHead className="hidden lg:table-cell">Project</TableHead>
                <TableHead className="hidden sm:table-cell">Provider</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="hidden xl:table-cell">Uptime</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sandboxes.map((sandbox) => {
                const terminal = sandbox.status === 'destroyed';
                return (
                  <TableRow key={sandbox.id}>
                    <TableCell className="max-w-[14rem]">
                      <span className="block truncate font-medium text-fg">{sandbox.name}</span>
                      <span className="block truncate font-mono text-[11px] text-subtle">
                        {sandbox.id}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-[10rem] truncate text-muted md:table-cell">
                      {sandbox.teamName}
                    </TableCell>
                    <TableCell className="hidden max-w-[10rem] truncate text-muted lg:table-cell">
                      {sandbox.projectName ?? '—'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" size="sm">
                        {sandbox.provider}
                      </Badge>
                    </TableCell>
                    <TableCell className="karo-numeric whitespace-nowrap text-muted">
                      {sandbox.cpuCores} vCPU · {formatBytes(sandbox.memoryMb * 1024 * 1024, 0)}
                    </TableCell>
                    <TableCell className="karo-numeric hidden text-muted xl:table-cell">
                      {sandbox.status === 'running'
                        ? formatDuration(sandbox.uptimeSeconds * 1000)
                        : sandbox.lastActiveAt
                          ? formatRelativeTime(sandbox.lastActiveAt)
                          : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money microUsd={sandbox.lifetimeChargedMicroUsd} />
                      <span className="block text-[11px] text-subtle">
                        cost <Money microUsd={sandbox.lifetimeUpstreamMicroUsd} />
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <StatusDot status={STATUS_DOT[sandbox.status] ?? 'idle'} label={null} />
                        <span className="text-[12px] text-muted">{sandbox.status}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Force-stop ${sandbox.name}`}
                          title="Force-stop"
                          disabled={terminal || sandbox.status === 'stopped'}
                          onClick={() => setPending({ sandbox, action: 'stop' })}
                        >
                          <CircleStop />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-danger"
                          aria-label={`Force-destroy ${sandbox.name}`}
                          title="Force-destroy"
                          disabled={terminal}
                          onClick={() => setPending({ sandbox, action: 'destroy' })}
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <ForceActionDialog
        pending={pending}
        onClose={() => setPending(null)}
        onDone={() => {
          setPending(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function ForceActionDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: PendingAction | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Every confirmation starts from an empty reason box. The reset is adjusted
  // during render rather than from an effect so the dialog never paints a frame
  // carrying the reason typed for a different sandbox — which an operator could
  // then submit against the wrong machine.
  const [seenPending, setSeenPending] = React.useState(pending);
  if (pending !== seenPending) {
    setSeenPending(pending);
    if (pending) setReason('');
  }

  if (!pending) return null;
  const destroying = pending.action === 'destroy';

  async function submit() {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ providerError: string | null }>('/api/admin/sandboxes', {
        method: 'POST',
        json: {
          sandboxId: pending.sandbox.id,
          action: pending.action,
          reason: reason.trim() || undefined,
        },
      });

      if (result.providerError) {
        toast.warning('Row forced, provider did not respond', {
          description: `${result.providerError} The sandbox is marked ${destroying ? 'destroyed' : 'stopped'} so the team stops being billed.`,
        });
      } else {
        toast.success(destroying ? 'Sandbox destroyed' : 'Sandbox stopped', {
          description: pending.sandbox.name,
        });
      }
      onDone();
    } catch (caught) {
      const described = describeError(caught);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {destroying ? 'Force-destroy this sandbox' : 'Force-stop this sandbox'}
          </DialogTitle>
          <DialogDescription>
            {destroying
              ? 'The machine and everything on its disk are released. Files that were only ever inside the sandbox and never written to the project are lost. Work already synced to the project is safe.'
              : 'The machine is stopped immediately. Anything running inside it is killed; the workspace is kept and the sandbox can be started again by its team.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-fg">
            {pending.sandbox.name}
            <span className="block text-[11px] text-subtle">
              {pending.sandbox.teamName}
              {pending.sandbox.projectName ? ` · ${pending.sandbox.projectName}` : ''}
            </span>
          </p>

          <Field>
            <FieldLabel htmlFor="force-reason">Reason</FieldLabel>
            <Textarea
              id="force-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Runaway process consuming the host — incident INC-204"
            />
            <FieldHint>Optional, but it is what the team sees in their audit log.</FieldHint>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={busy} onClick={submit}>
            {destroying ? 'Destroy sandbox' : 'Stop sandbox'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
