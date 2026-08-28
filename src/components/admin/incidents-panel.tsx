'use client';

import { CheckCheck, Eye, RotateCcw, ShieldCheck, Siren, Stethoscope } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { AdminPanel } from '@/components/admin/primitives';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
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
import { formatDateTime, formatDuration, formatRelativeTime } from '@/lib/utils';

/**
 * Incident review and status transitions.
 *
 * Every mutation goes through `/api/admin/incidents/[incidentId]`, which appends
 * to the timeline and audits the change — so the note field here is not a
 * comment box, it is the postmortem record, and the dialog says so before the
 * operator commits. Durations arrive pre-computed from the server; recomputing
 * them from the clock during render would make this component impure and would
 * disagree with the figures in the header tiles.
 */

export type IncidentStatus = 'open' | 'investigating' | 'monitoring' | 'resolved';
export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4';

export type AdminIncidentRow = {
  id: string;
  title: string;
  description: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  component: string;
  affectedTeams: number;
  timeline: ReadonlyArray<{ at: string; author: string; note: string }>;
  detectedAt: string;
  resolvedAt: string | null;
  /** Detection to resolution, or detection to page render while still open. */
  elapsedMs: number;
};

/**
 * Deliberately the same mapping the overview banner uses: sev3 and sev4 are both
 * neutral there, and an incident that changes colour between two admin pages
 * would be read as a different incident.
 */
const SEVERITY_VARIANT: Record<IncidentSeverity, 'danger' | 'warning' | 'neutral'> = {
  sev1: 'danger',
  sev2: 'warning',
  sev3: 'neutral',
  sev4: 'neutral',
};

const STATUS_VARIANT: Record<IncidentStatus, 'danger' | 'warning' | 'info' | 'success'> = {
  open: 'danger',
  investigating: 'warning',
  monitoring: 'info',
  resolved: 'success',
};

const TRANSITION_COPY: Record<
  IncidentStatus,
  {
    title: string;
    description: string;
    confirm: string;
    notePlaceholder: string;
    destructive: boolean;
  }
> = {
  investigating: {
    title: 'Acknowledge this incident',
    description:
      'Marks the incident as owned. It stays in the open count and keeps the sidebar badge lit, so the change is a signal to other operators rather than a way to quieten one.',
    confirm: 'Acknowledge',
    notePlaceholder:
      'Paging the on-call for the sandbox fleet; suspect the image rollout at 14:02.',
    destructive: false,
  },
  monitoring: {
    title: 'Move to monitoring',
    description:
      'Says the mitigation is in place and you are watching for recurrence. The incident is still counted as open.',
    confirm: 'Move to monitoring',
    notePlaceholder: 'Rolled back to the previous base image. Error rate back under 0.1%.',
    destructive: false,
  },
  resolved: {
    title: 'Resolve this incident',
    description:
      'Stamps the resolution time, drops the incident out of the open count and clears the sidebar badge. The duration recorded here is what the mean-time-to-resolve figure is computed from.',
    confirm: 'Resolve',
    notePlaceholder:
      'Root cause was a missing timeout in the wake path. Fix shipped in 2026.7.3.',
    destructive: false,
  },
  open: {
    title: 'Reopen this incident',
    description:
      'Clears the resolution time and puts the incident back into the open count. Use this when the same failure returns rather than filing a second incident, so the timeline stays in one place.',
    confirm: 'Reopen',
    notePlaceholder: 'Same failure returned at 03:10 on two of the six workers.',
    destructive: true,
  },
};

type Pending = { incident: AdminIncidentRow; status: IncidentStatus };

export type IncidentsPanelProps = {
  open: readonly AdminIncidentRow[];
  resolved: readonly AdminIncidentRow[];
  /** Attributed as the timeline author on anything committed from this page. */
  adminName: string;
  /** True when the open list was truncated at the same cap the sidebar uses. */
  openTruncated: boolean;
  /** That cap, so the truncation warning cannot quote a stale number. */
  openCap: number;
};

export function IncidentsPanel({
  open,
  resolved,
  adminName,
  openTruncated,
  openCap,
}: IncidentsPanelProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState<Pending | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <AdminPanel
        title="Open incidents"
        description="Everything not yet resolved, worst severity first. This is exactly the set the sidebar badge counts; the overview banner runs the same query but shows at most ten."
      >
        {open.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing is broken right now"
            description="No incident is open. When one is filed it appears here immediately, lights the sidebar badge and shows a banner on the overview until it is resolved."
          />
        ) : (
          <ul className="divide-y divide-line">
            {open.map((incident) => (
              <li key={incident.id}>
                <OpenIncident
                  incident={incident}
                  onTransition={(status) => setPending({ incident, status })}
                />
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>

      {openTruncated ? (
        <Alert variant="warning" icon={<Siren className="size-4" />}>
          <AlertDescription>
            At least {openCap} incidents are open. This list and the sidebar badge run the same
            capped query, so treat both numbers as a floor rather than a count, and resolve or
            merge some before reading either as the size of the problem.
          </AlertDescription>
        </Alert>
      ) : null}

      <AdminPanel
        title="Resolved history"
        description="Most recently resolved first, with the duration each one was open. Reopen an incident instead of filing a second one when the same failure returns."
      >
        {resolved.length === 0 ? (
          <EmptyState
            size="sm"
            title="No resolved incidents yet"
            description="Once an incident is resolved it moves here with its detection time, resolution time and total duration."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Incident</TableHead>
                <TableHead className="hidden sm:table-cell">Surface</TableHead>
                <TableHead className="hidden lg:table-cell">Detected</TableHead>
                <TableHead className="hidden md:table-cell">Resolved</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Teams</TableHead>
                <TableHead className="w-8" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {resolved.map((incident) => (
                <TableRow key={incident.id}>
                  <TableCell>
                    <Badge variant={SEVERITY_VARIANT[incident.severity]} size="sm">
                      {incident.severity.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[22rem]">
                    <span className="block truncate font-medium text-fg">{incident.title}</span>
                    {incident.description ? (
                      <span className="block truncate text-[11px] text-subtle">
                        {incident.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" size="sm">
                      {incident.component}
                    </Badge>
                  </TableCell>
                  <TableCell className="karo-numeric hidden text-muted lg:table-cell">
                    {formatDateTime(incident.detectedAt)}
                  </TableCell>
                  <TableCell className="karo-numeric hidden text-muted md:table-cell">
                    {incident.resolvedAt ? formatDateTime(incident.resolvedAt) : '—'}
                  </TableCell>
                  <TableCell className="karo-numeric text-right">
                    {/* No resolution time means no duration to report; a figure
                        measured against the current clock would read as if the
                        incident were still running. */}
                    {incident.resolvedAt ? formatDuration(incident.elapsedMs) : '—'}
                  </TableCell>
                  <TableCell className="karo-numeric hidden text-right text-muted xl:table-cell">
                    {incident.affectedTeams}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reopen ${incident.title}`}
                      title="Reopen"
                      onClick={() => setPending({ incident, status: 'open' })}
                    >
                      <RotateCcw />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AdminPanel>

      <TransitionDialog
        pending={pending}
        adminName={adminName}
        onClose={() => setPending(null)}
        onDone={() => {
          setPending(null);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  One open incident
 * ------------------------------------------------------------------ */

function OpenIncident({
  incident,
  onTransition,
}: {
  incident: AdminIncidentRow;
  onTransition: (status: IncidentStatus) => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_VARIANT[incident.severity]} size="sm">
          {incident.severity.toUpperCase()}
        </Badge>
        <Badge variant={STATUS_VARIANT[incident.status]} size="sm">
          {incident.status}
        </Badge>
        <h3 className="min-w-0 flex-1 text-[13px] font-medium text-fg">{incident.title}</h3>
        <Badge variant="outline" size="sm">
          {incident.component}
        </Badge>
      </div>

      {incident.description ? (
        <p className="max-w-3xl text-[12.5px] leading-relaxed text-muted">
          {incident.description}
        </p>
      ) : null}

      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-subtle">
        <div className="flex items-center gap-1.5">
          <dt>Detected</dt>
          <dd className="karo-numeric text-muted">
            {formatDateTime(incident.detectedAt)} ({formatRelativeTime(incident.detectedAt)})
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt>Open for</dt>
          <dd className="karo-numeric font-medium text-fg">
            {formatDuration(incident.elapsedMs)}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt>Affected teams</dt>
          <dd className="karo-numeric text-muted">{incident.affectedTeams}</dd>
        </div>
      </dl>

      {incident.timeline.length > 0 ? (
        <ol className="flex flex-col gap-1.5 border-l border-line-accent pl-3">
          {incident.timeline.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="text-[12px] leading-snug">
              <span className="text-fg">{entry.note}</span>
              <span className="karo-numeric ml-1.5 text-[11px] text-subtle">
                {entry.author} · {formatDateTime(entry.at)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[11px] text-subtle">
          No timeline entries yet. The next status change records one.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {incident.status === 'open' ? (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Stethoscope />}
            onClick={() => onTransition('investigating')}
          >
            Acknowledge
          </Button>
        ) : null}
        {incident.status !== 'monitoring' ? (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Eye />}
            onClick={() => onTransition('monitoring')}
          >
            Monitoring
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Stethoscope />}
            onClick={() => onTransition('investigating')}
          >
            Back to investigating
          </Button>
        )}
        <Button size="sm" iconLeft={<CheckCheck />} onClick={() => onTransition('resolved')}>
          Resolve
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Confirmation
 * ------------------------------------------------------------------ */

function TransitionDialog({
  pending,
  adminName,
  onClose,
  onDone,
}: {
  pending: Pending | null;
  adminName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Each confirmation starts from an empty note. The reset happens during render
  // rather than in an effect because the note is written verbatim into the public
  // timeline of whichever incident is showing — carrying one incident's note into
  // another's dialog, even for a single frame, invites the wrong paste.
  const [seenPending, setSeenPending] = React.useState(pending);
  if (pending !== seenPending) {
    setSeenPending(pending);
    if (pending) {
      setNote('');
      setError(null);
    }
  }

  if (!pending) return null;
  const copy = TRANSITION_COPY[pending.status];

  async function submit() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ summary: string }>(
        `/api/admin/incidents/${pending.incident.id}`,
        { method: 'PATCH', json: { status: pending.status, note: note.trim() || undefined } },
      );
      toast.success(copy.confirm, { description: result.summary });
      onDone();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-fg">
            {pending.incident.title}
            <span className="block text-[11px] text-subtle">
              {pending.incident.severity.toUpperCase()} · {pending.incident.component} · open
              for {formatDuration(pending.incident.elapsedMs)}
            </span>
          </p>

          <Field>
            <FieldLabel htmlFor="incident-note" aside="Optional">
              Timeline note
            </FieldLabel>
            <Textarea
              id="incident-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={copy.notePlaceholder}
            />
            <FieldHint>
              Appended to the incident timeline as {adminName || 'you'} and kept for the
              postmortem. Left empty, Karo records the transition itself.
            </FieldHint>
          </Field>

          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={copy.destructive ? 'danger' : 'primary'}
            size="sm"
            loading={busy}
            onClick={submit}
          >
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
