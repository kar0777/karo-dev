'use client';

import {
  ArrowLeft,
  ArrowRight,
  EyeOff,
  Search,
  ShieldCheck,
  ShieldMinus,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import type { AdminUserDetail, AdminUserRow } from '@/app/admin/_data/users';
import { PlanBadge, SeverityBadge } from '@/components/admin/primitives';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Field, FieldError, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  formatCompactNumber,
  formatDate,
  formatDateTime,
  formatHours,
  formatMicroUsd,
  formatRelativeTime,
} from '@/lib/utils';

/**
 * The user administration table.
 *
 * Filters live in the URL (server-rendered result set); only the detail drawer
 * and the two mutations are client work. That keeps the table usable on a slow
 * connection and makes any view linkable in a support thread.
 */

export type UsersTableProps = {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageCount: number;
  query: { q: string; status: string; role: string };
  currentAdminId: string;
};

type PendingAction = {
  user: AdminUserRow;
  action: 'suspend' | 'unsuspend' | 'promote' | 'demote';
};

const ACTION_COPY: Record<
  PendingAction['action'],
  { title: string; description: string; confirm: string; needsReason: boolean }
> = {
  suspend: {
    title: 'Suspend this account',
    description:
      'The user is signed out of every session immediately and cannot sign back in. Their data, projects and sandboxes are untouched.',
    confirm: 'Suspend account',
    needsReason: true,
  },
  unsuspend: {
    title: 'Restore this account',
    description: 'The user can sign in again straight away. Nothing else changes.',
    confirm: 'Restore account',
    needsReason: false,
  },
  promote: {
    title: 'Grant platform admin',
    description:
      'This gives full access to this console: every team, every plan, every price and the audit log.',
    confirm: 'Grant admin',
    needsReason: false,
  },
  demote: {
    title: 'Remove platform admin',
    description:
      'The user keeps their teams and projects but loses access to the admin console.',
    confirm: 'Remove admin',
    needsReason: false,
  },
};

export function UsersTable({
  rows,
  total,
  page,
  pageCount,
  query,
  currentAdminId,
}: UsersTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = React.useState(query.q);
  const [pending, startTransition] = React.useTransition();

  const [selected, setSelected] = React.useState<AdminUserRow | null>(null);
  const [confirm, setConfirm] = React.useState<PendingAction | null>(null);

  // The search box is a local draft, but the URL is the source of truth: a back
  // navigation or "Clear filters" has to pull the box back in line. Adjusting
  // during render rather than in an effect means the box never paints the old
  // term next to a result set that has already changed underneath it.
  const [seenQuery, setSeenQuery] = React.useState(query.q);
  if (query.q !== seenQuery) {
    setSeenQuery(query.q);
    setTerm(query.q);
  }

  const push = React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          push({ q: term.trim(), page: '1' });
        }}
      >
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <Input
            id="admin-user-search"
            aria-label="Search users by email or name"
            placeholder="Search email or name"
            className="pl-8"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>

        <SegmentedControl
          size="sm"
          aria-label="Account status"
          value={query.status}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
          ]}
          onValueChange={(value) => push({ status: value === 'all' ? null : value, page: '1' })}
        />

        <SegmentedControl
          size="sm"
          aria-label="Platform role"
          value={query.role}
          options={[
            { value: 'all', label: 'Any role' },
            { value: 'user', label: 'Users' },
            { value: 'admin', label: 'Admins' },
          ]}
          onValueChange={(value) => push({ role: value === 'all' ? null : value, page: '1' })}
        />

        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Search
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Search}
            title="No accounts match these filters"
            description="Clear the search term or widen the status filter. Search matches on email address and display name."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => push({ q: null, status: null, role: null, page: '1' })}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="hidden md:table-cell">Team</TableHead>
                <TableHead className="hidden lg:table-cell">Plan</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Signed up</TableHead>
                <TableHead className="hidden xl:table-cell">Last seen</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-8" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-[18rem]">
                    <button
                      type="button"
                      className="block w-full rounded-sm text-left"
                      onClick={() => setSelected(row)}
                    >
                      <span className="block truncate font-medium text-fg">
                        {row.name || row.email}
                      </span>
                      <span className="block truncate text-[11px] text-subtle">
                        {row.email}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="hidden max-w-[12rem] truncate text-muted md:table-cell">
                    {row.teamName ?? '—'}
                    {row.teamCount > 1 ? (
                      <span className="ml-1 text-[11px] text-subtle">+{row.teamCount - 1}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <PlanBadge tier={row.planTier} name={row.planName} />
                  </TableCell>
                  <TableCell>
                    {row.platformRole === 'admin' ? (
                      <Badge variant="ember" size="sm">
                        <ShieldCheck className="size-3" aria-hidden="true" />
                        Admin
                      </Badge>
                    ) : (
                      <span className="text-muted">User</span>
                    )}
                  </TableCell>
                  <TableCell className="karo-numeric hidden text-muted sm:table-cell">
                    {formatDate(row.createdAt)}
                  </TableCell>
                  <TableCell className="hidden text-muted xl:table-cell">
                    {row.lastSeenAt ? formatRelativeTime(row.lastSeenAt) : 'Never'}
                  </TableCell>
                  <TableCell>
                    {row.isSuspended ? (
                      <Badge variant="danger" size="sm">
                        Suspended
                      </Badge>
                    ) : row.isDemo ? (
                      <Badge variant="info" size="sm">
                        Demo
                      </Badge>
                    ) : (
                      <Badge variant="success" size="sm">
                        Active
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Open details for ${row.email}`}
                      onClick={() => setSelected(row)}
                    >
                      <ArrowRight />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          {total === 0
            ? 'No accounts'
            : `Showing ${rows.length} of ${total} account${total === 1 ? '' : 's'} · page ${page} of ${pageCount}`}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1 || pending}
            onClick={() => push({ page: String(page - 1) })}
            iconLeft={<ArrowLeft />}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= pageCount || pending}
            onClick={() => push({ page: String(page + 1) })}
            iconRight={<ArrowRight />}
          >
            Next
          </Button>
        </div>
      </div>

      <UserDrawer
        user={selected}
        currentAdminId={currentAdminId}
        onClose={() => setSelected(null)}
        onAction={(action) => {
          if (selected) setConfirm({ user: selected, action });
        }}
      />

      <ConfirmActionDialog
        pending={confirm}
        onClose={() => setConfirm(null)}
        onDone={() => {
          setConfirm(null);
          setSelected(null);
          startTransition(() => router.refresh());
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Detail drawer
 * ------------------------------------------------------------------ */

function UserDrawer({
  user,
  currentAdminId,
  onClose,
  onAction,
}: {
  user: AdminUserRow | null;
  currentAdminId: string;
  onClose: () => void;
  onAction: (action: PendingAction['action']) => void;
}) {
  const [detail, setDetail] = React.useState<AdminUserDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(user !== null);

  // The drawer stays mounted across accounts, so selecting a different user has
  // to drop the loaded detail and go back to the skeleton. That happens during
  // render rather than in the effect below, because an effect would let the panel
  // paint one account's spend, teams and audit trail under another account's
  // email for a frame. Closing the drawer (user becomes null) leaves the state
  // alone so the exit animation does not show a half-emptied panel; the effect
  // keeps only the fetch, which is genuine external synchronisation.
  const [seenUser, setSeenUser] = React.useState(user);
  if (user !== seenUser) {
    setSeenUser(user);
    if (user) {
      setLoading(true);
      setError(null);
      setDetail(null);
    }
  }

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;

    apiFetch<AdminUserDetail>(`/api/admin/users/${user.id}`)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((caught) => {
        if (!cancelled) setError(describeError(caught).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const isSelf = user?.id === currentAdminId;

  return (
    <Sheet open={user !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="right" className="w-[min(34rem,calc(100vw-1.5rem))] p-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle className="truncate">{user?.name || user?.email || 'Account'}</SheetTitle>
          <p className="truncate text-[12px] text-muted">{user?.email}</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {loading ? (
            <div className="flex flex-col gap-3 py-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : error ? (
            <Alert variant="danger" className="mt-4">
              <AlertTitle>Could not load this account</AlertTitle>
              <AlertDescription>
                {error} Close the panel and try again — the table itself is unaffected.
              </AlertDescription>
            </Alert>
          ) : detail ? (
            <div className="flex flex-col gap-5 py-4">
              <section className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-4">
                <Figure
                  label="Weighted tokens"
                  value={formatCompactNumber(detail.totals.weightedTokens)}
                />
                <Figure
                  label="Spend"
                  value={formatMicroUsd(detail.totals.lifetimeSpentMicroUsd)}
                />
                <Figure label="Compute" value={formatHours(detail.totals.computeHours)} />
                <Figure label="Runs" value={formatCompactNumber(detail.totals.runs)} />
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-medium tracking-wide text-subtle uppercase">
                  Teams
                </h3>
                {detail.teams.length === 0 ? (
                  <p className="text-[12px] text-muted">This account belongs to no team.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {detail.teams.map((team) => (
                      <li key={team.teamId} className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-fg">
                            {team.name}
                          </span>
                          <span className="block truncate text-[11px] text-subtle">
                            {team.role} · {team.projectCount} project
                            {team.projectCount === 1 ? '' : 's'}
                          </span>
                        </span>
                        <PlanBadge tier={team.planTier} name={team.planName} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-medium tracking-wide text-subtle uppercase">
                  Recent runs
                </h3>
                {detail.recentRuns.length === 0 ? (
                  <p className="text-[12px] text-muted">No agent runs yet.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {detail.recentRuns.map((run) => (
                      <li key={run.id} className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                          {run.title}
                        </span>
                        <Badge
                          variant={
                            run.status === 'succeeded'
                              ? 'success'
                              : run.status === 'failed'
                                ? 'danger'
                                : 'neutral'
                          }
                          size="sm"
                        >
                          {run.status}
                        </Badge>
                        <span className="karo-numeric shrink-0 text-[11px] text-subtle">
                          {formatMicroUsd(run.chargedMicroUsd)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-medium tracking-wide text-subtle uppercase">
                  Audit trail
                </h3>
                {detail.auditTrail.length === 0 ? (
                  <p className="text-[12px] text-muted">Nothing recorded for this account.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {detail.auditTrail.map((entry) => (
                      <li key={entry.id} className="flex items-start gap-2 px-3 py-2">
                        <SeverityBadge severity={entry.severity} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-fg">
                            {entry.summary}
                          </span>
                          <span className="block text-[11px] text-subtle">
                            {formatDateTime(entry.createdAt)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <Alert variant="info" icon={<EyeOff className="size-4" />}>
                <AlertTitle>Impersonation is not available</AlertTitle>
                <AlertDescription>
                  Karo deliberately has no way for an operator to sign in as a user. Silent
                  impersonation would give staff access to private source code and API keys with
                  no trace the user could see. To debug an account, ask the user to invite you
                  to their team — that is visible to them and recorded in their audit log.
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
        </div>

        {user ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            {isSelf ? (
              <p className="text-[12px] text-muted">
                This is your own account — another platform admin has to make changes to it.
              </p>
            ) : (
              <>
                {user.isSuspended ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<UserRoundCheck />}
                    onClick={() => onAction('unsuspend')}
                  >
                    Restore
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    size="sm"
                    iconLeft={<UserRoundX />}
                    onClick={() => onAction('suspend')}
                  >
                    Suspend
                  </Button>
                )}
                {user.platformRole === 'admin' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<ShieldMinus />}
                    onClick={() => onAction('demote')}
                  >
                    Remove admin
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<ShieldCheck />}
                    onClick={() => onAction('promote')}
                  >
                    Make platform admin
                  </Button>
                )}
              </>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium tracking-wide text-subtle uppercase">
        {label}
      </span>
      <span className="karo-numeric text-[13px] font-semibold text-fg">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Confirmation
 * ------------------------------------------------------------------ */

function ConfirmActionDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: PendingAction | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Every confirmation starts from an empty reason and no error. The reset is
  // adjusted during render rather than from an effect so the dialog never paints
  // a frame carrying the reason typed for a different account — that text goes
  // straight into the audit log, so showing it against the wrong user, even for
  // a frame, is not acceptable.
  const [seenPending, setSeenPending] = React.useState(pending);
  if (pending !== seenPending) {
    setSeenPending(pending);
    if (pending) {
      setReason('');
      setError(null);
    }
  }

  if (!pending) return null;
  const copy = ACTION_COPY[pending.action];

  async function submit() {
    if (!pending) return;
    if (copy.needsReason && reason.trim().length < 4) {
      setError('Give a reason of at least 4 characters — it is stored in the audit log.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ summary: string }>(
        `/api/admin/users/${pending.user.id}`,
        {
          method: 'PATCH',
          json: { action: pending.action, reason: reason.trim() || undefined },
        },
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
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-fg">
            {pending.user.name || pending.user.email}
            <span className="block text-[11px] text-subtle">{pending.user.email}</span>
          </p>

          {copy.needsReason ? (
            <Field>
              <FieldLabel htmlFor="suspend-reason" required>
                Reason
              </FieldLabel>
              <Textarea
                id="suspend-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Abuse report #418 — repeated attempts to escape the sandbox"
              />
              <FieldHint>
                Recorded in the audit log and visible to every platform admin.
              </FieldHint>
              <FieldError>{error}</FieldError>
            </Field>
          ) : error ? (
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
            variant={pending.action === 'suspend' ? 'danger' : 'primary'}
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
