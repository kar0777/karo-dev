'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Link2, MailPlus, Send, Trash2, TriangleAlert } from 'lucide-react';

import type { InvitationView, SeatUsage } from '@/lib/account/team';
import { apiFetch, describeError } from '@/lib/client/api';
import type { TeamRole } from '@/lib/db/schema';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/rbac/permissions';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
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
  Meter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '@/components/ui';

export type InvitationsPanelProps = {
  invitations: InvitationView[];
  seats: SeatUsage;
  planName: string;
  canInvite: boolean;
  /** Roles the signed-in member is allowed to hand out. */
  invitableRoles: TeamRole[];
};

type IssuedLink = { email: string; url: string; resent: boolean };

export function InvitationsPanel({
  invitations,
  seats,
  planName,
  canInvite,
  invitableRoles,
}: InvitationsPanelProps) {
  const router = useRouter();
  const [issued, setIssued] = React.useState<IssuedLink | null>(null);

  const blockedReason = !canInvite
    ? 'Your role cannot invite people. Ask an owner or admin.'
    : seats.atLimit
      ? `Every seat on the ${planName} plan is taken.`
      : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Seats</CardTitle>
          <CardDescription>
            A pending invitation holds a seat until it is accepted or revoked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Meter
            label={`${planName} plan`}
            value={seats.used + seats.pending}
            max={seats.limit}
            caption={`${seats.used + seats.pending} of ${seats.limit} used`}
            tone={seats.atLimit ? 'danger' : undefined}
          />
          <p className="text-[12px] text-muted">
            <span className="karo-numeric text-fg">{seats.used}</span> member
            {seats.used === 1 ? '' : 's'} ·{' '}
            <span className="karo-numeric text-fg">{seats.pending}</span> pending invitation
            {seats.pending === 1 ? '' : 's'} ·{' '}
            <span className="karo-numeric text-fg">{seats.remaining}</span> free
          </p>

          {seats.atLimit ? (
            <Alert variant="warning" icon={<TriangleAlert />}>
              <AlertTitle>No seats left</AlertTitle>
              <AlertDescription>
                Revoke a pending invitation, remove a member, or move to a plan with more seats
                to keep growing the team.{' '}
                <Link href="/app/billing" className="font-medium text-primary hover:underline">
                  Compare plans
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <InviteForm
        disabledReason={blockedReason}
        invitableRoles={invitableRoles}
        onIssued={(link) => {
          setIssued(link);
          router.refresh();
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>
            Each link works once and expires after seven days. Karo stores only a hash of the
            token, so an existing link cannot be shown again — resend to issue a fresh one.
          </CardDescription>
        </CardHeader>

        <CardContent className={invitations.length === 0 ? undefined : 'space-y-2'}>
          {invitations.length === 0 ? (
            <EmptyState
              icon={MailPlus}
              size="sm"
              title="Nobody is waiting to join"
              description="Invite a teammate above and their invitation appears here until they accept it."
            />
          ) : (
            invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                canManage={canInvite}
                onResent={(link) => {
                  setIssued(link);
                  router.refresh();
                }}
              />
            ))
          )}
        </CardContent>
      </Card>

      <LinkDialog issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Invite form
 * ------------------------------------------------------------------ */

function InviteForm({
  disabledReason,
  invitableRoles,
  onIssued,
}: {
  disabledReason: string | null;
  invitableRoles: TeamRole[];
  onIssued: (link: IssuedLink) => void;
}) {
  const fallbackRole: TeamRole = invitableRoles.includes('developer')
    ? 'developer'
    : (invitableRoles[0] ?? 'viewer');

  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<TeamRole>(fallbackRole);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabledReason) return;

    if (!email.trim().includes('@')) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await apiFetch<{ inviteUrl: string }>('/api/team/invitations', {
        method: 'POST',
        json: { email: email.trim(), role },
      });
      onIssued({ email: email.trim(), url: result.inviteUrl, resent: false });
      setEmail('');
      toast.success('Invitation sent', {
        description: `${email.trim()} can join as ${ROLE_LABELS[role]}.`,
      });
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a teammate</CardTitle>
        <CardDescription>
          They get an email with a one-time link. You can copy the link from the dialog if their
          mail is slow.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-start">
            <Field>
              <FieldLabel htmlFor="invite-email" required>
                Email address
              </FieldLabel>
              <Input
                id="invite-email"
                type="email"
                value={email}
                autoComplete="off"
                placeholder="teammate@company.com"
                disabled={Boolean(disabledReason)}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Select
                value={role}
                disabled={Boolean(disabledReason)}
                onValueChange={(value) => setRole(value as TeamRole)}
              >
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {invitableRoles.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="sm:pt-[1.6rem]">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="submit"
                        loading={busy}
                        disabled={Boolean(disabledReason)}
                        iconLeft={<Send />}
                      >
                        Send invitation
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {disabledReason ? <TooltipContent>{disabledReason}</TooltipContent> : null}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {error ? (
            <FieldError>{error}</FieldError>
          ) : (
            <FieldHint>{ROLE_DESCRIPTIONS[role]}</FieldHint>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  Pending row
 * ------------------------------------------------------------------ */

function InvitationRow({
  invitation,
  canManage,
  onResent,
}: {
  invitation: InvitationView;
  canManage: boolean;
  onResent: (link: IssuedLink) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<'resend' | 'revoke' | null>(null);

  async function resend() {
    setBusy('resend');
    try {
      const result = await apiFetch<{ inviteUrl: string }>(
        `/api/team/invitations/${invitation.id}`,
        { method: 'POST' },
      );
      onResent({ email: invitation.email, url: result.inviteUrl, resent: true });
      toast.success('New link issued', {
        description: `The previous link to ${invitation.email} no longer works.`,
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
      await apiFetch(`/api/team/invitations/${invitation.id}`, { method: 'DELETE' });
      toast.success('Invitation revoked', {
        description: `The link sent to ${invitation.email} stops working immediately.`,
      });
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-fg">{invitation.email}</span>
          <Badge size="sm" variant="outline">
            {ROLE_LABELS[invitation.role]}
          </Badge>
          {invitation.expired ? (
            <Badge size="sm" variant="warning">
              Expired
            </Badge>
          ) : null}
        </div>
        <p className="text-[12px] text-muted" title={formatDateTime(invitation.expiresAt)}>
          Invited by {invitation.invitedByName} ·{' '}
          {invitation.expired
            ? `expired ${formatRelativeTime(invitation.expiresAt)}`
            : `expires ${formatRelativeTime(invitation.expiresAt)}`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<Link2 />}
          loading={busy === 'resend'}
          disabled={!canManage || busy !== null}
          onClick={resend}
        >
          Resend &amp; copy link
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Revoke the invitation to ${invitation.email}`}
          className="text-danger hover:bg-danger-soft hover:text-danger"
          disabled={!canManage || busy !== null}
          onClick={revoke}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  The one-time link
 * ------------------------------------------------------------------ */

function LinkDialog({ issued, onClose }: { issued: IssuedLink | null; onClose: () => void }) {
  if (!issued) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {issued.resent ? 'New invitation link' : `Invitation sent to ${issued.email}`}
          </DialogTitle>
          <DialogDescription>
            We emailed this link. Copy it here if you would rather send it yourself — it is the
            only time Karo can show it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-muted">Accept link</span>
            <CopyButton value={issued.url} label="Copy link" variant="secondary" size="xs" />
          </div>
          <code className="block overflow-x-auto rounded-md border border-line bg-bg-inset px-3 py-2 font-mono text-[12px] break-all text-fg">
            {issued.url}
          </code>
          <p className="text-[12px] leading-relaxed text-muted">
            Anyone with this link can join the team as the signed-in account, once. It expires
            in seven days, and resending replaces it.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
