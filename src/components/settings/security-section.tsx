'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, LogOut, MonitorSmartphone } from 'lucide-react';

import type { SessionView } from '@/lib/account/sessions';
import { apiFetch, describeError } from '@/lib/client/api';
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
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  StatusDot,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/components/ui';

import { MIN_PASSWORD_LENGTH, PasswordStrength, scoreLocally } from './password-strength';

export type SecuritySectionProps = {
  sessions: SessionView[];
  /** False for accounts created through an identity provider with no password. */
  hasPassword: boolean;
};

export function SecuritySection({ sessions, hasPassword }: SecuritySectionProps) {
  return (
    <div className="space-y-4">
      <PasswordCard hasPassword={hasPassword} />
      <SessionsCard sessions={sessions} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Password
 * ------------------------------------------------------------------ */

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);

  const strength = scoreLocally(next);
  const ready = current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && strength.score >= 2;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    if (next !== confirm) {
      setConfirmError('The two passwords do not match.');
      return;
    }
    setConfirmError(null);
    setSaving(true);
    setError(null);

    try {
      const result = await apiFetch<{ signedOutSessions: number }>('/api/settings/password', {
        method: 'POST',
        json: { currentPassword: current, newPassword: next },
      });

      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Password changed', {
        description:
          result.signedOutSessions > 0
            ? `Signed out of ${result.signedOutSessions} other session${result.signedOutSessions === 1 ? '' : 's'}.`
            : 'This device stays signed in.',
      });
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      toast.error(described.title, { description: described.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Changing it signs out every other device. This one stays signed in.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {hasPassword ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field className="max-w-md">
              <FieldLabel htmlFor="current-password" required>
                Current password
              </FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </Field>

            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="new-password" required>
                  New password
                </FieldLabel>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(event) => setNext(event.target.value)}
                  aria-describedby="new-password-strength"
                />
                <PasswordStrength id="new-password-strength" password={next} />
              </Field>

              <Field>
                <FieldLabel htmlFor="confirm-password" required>
                  Confirm new password
                </FieldLabel>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    if (confirmError) setConfirmError(null);
                  }}
                  aria-invalid={confirmError ? true : undefined}
                />
                {confirmError ? (
                  <FieldError>{confirmError}</FieldError>
                ) : (
                  <FieldHint>Type it a second time so a typo cannot lock you out.</FieldHint>
                )}
              </Field>
            </div>

            {error ? <FieldError>{error}</FieldError> : null}

            <Button type="submit" loading={saving} disabled={!ready} iconLeft={<KeyRound />}>
              Change password
            </Button>
          </form>
        ) : (
          <Alert variant="info">
            <AlertTitle>This account has no password</AlertTitle>
            <AlertDescription>
              It signs in through an identity provider. Use the “Forgot password” flow on the
              sign-in screen to set one, then come back here to change it.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  Sessions
 * ------------------------------------------------------------------ */

function SessionsCard({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const others = sessions.filter((session) => !session.isCurrent);

  async function revokeOne(session: SessionView) {
    setBusyId(session.id);
    try {
      await apiFetch(`/api/settings/sessions/${session.id}`, { method: 'DELETE' });
      if (session.isCurrent) {
        toast.success('Signed out', { description: 'Redirecting to the sign-in screen.' });
        window.location.assign('/login');
        return;
      }
      toast.success('Session revoked', {
        description: `${session.deviceLabel} has been signed out.`,
      });
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOthers() {
    setBulkBusy(true);
    try {
      const result = await apiFetch<{ revoked: number }>('/api/settings/sessions', {
        method: 'DELETE',
      });
      toast.success(
        result.revoked === 0
          ? 'Nothing to sign out'
          : `Signed out of ${result.revoked} session${result.revoked === 1 ? '' : 's'}`,
        { description: 'This device stays signed in.' },
      );
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Every browser currently signed in to this account. Revoking one takes effect on its
          next request.
        </CardDescription>
        <div className="mt-2">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<LogOut />}
            loading={bulkBusy}
            disabled={others.length === 0}
            onClick={revokeOthers}
          >
            Sign out everywhere else
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead className="hidden sm:table-cell">IP address</TableHead>
              <TableHead className="hidden md:table-cell">Last used</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <MonitorSmartphone
                      className="size-4 shrink-0 text-subtle"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-fg">
                          {session.deviceLabel}
                        </span>
                        {session.isCurrent ? (
                          <Badge variant="primary" size="sm">
                            <StatusDot status="live" size="sm" label={null} />
                            This device
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-[11px] text-subtle md:hidden">
                        {formatRelativeTime(session.lastUsedAt)}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="karo-numeric hidden text-muted sm:table-cell">
                  {session.ipAddress ?? 'Not recorded'}
                </TableCell>
                <TableCell
                  className="hidden text-muted md:table-cell"
                  title={formatDateTime(session.lastUsedAt)}
                >
                  {formatRelativeTime(session.lastUsedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger-soft hover:text-danger"
                    loading={busyId === session.id}
                    onClick={() => revokeOne(session)}
                  >
                    {session.isCurrent ? 'Sign out' : 'Revoke'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
