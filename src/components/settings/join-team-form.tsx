'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, MailWarning } from 'lucide-react';

import { AVATAR_COLOR_CLASSES, normalizeAvatarColor } from '@/lib/account/preferences';
import { apiFetch, describeError } from '@/lib/client/api';
import type { TeamRole } from '@/lib/db/schema';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/rbac/permissions';
import { cn, initials } from '@/lib/utils';
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
  FieldError,
  toast,
} from '@/components/ui';

export type JoinTeamFormProps = {
  token: string;
  teamName: string;
  teamAvatarColor: string;
  role: TeamRole;
  invitedEmail: string;
  invitedByName: string;
  /** The signed-in account that will actually be added. */
  currentEmail: string;
  expiresAt: string;
};

export function JoinTeamForm({
  token,
  teamName,
  teamAvatarColor,
  role,
  invitedEmail,
  invitedByName,
  currentEmail,
  expiresAt,
}: JoinTeamFormProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const mismatch = invitedEmail.toLowerCase() !== currentEmail.toLowerCase();
  const color = normalizeAvatarColor(teamAvatarColor);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      await apiFetch('/api/invitations/accept', { method: 'POST', json: { token } });
      toast.success(`You joined ${teamName}`, {
        description: `You have the ${ROLE_LABELS[role]} role.`,
      });
      router.push('/app/team');
      router.refresh();
    } catch (caught) {
      const described = describeError(caught);
      setError(described.message);
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-lg text-[14px] font-semibold',
              AVATAR_COLOR_CLASSES[color].surface,
            )}
          >
            {initials(teamName)}
          </span>
          <div className="min-w-0">
            <CardTitle>Join {teamName}</CardTitle>
            <CardDescription>
              {invitedByName} invited you as {ROLE_LABELS[role]}.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="space-y-2 rounded-md border border-line bg-surface-2 p-3 text-[12.5px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-subtle">Role</dt>
            <dd className="text-right">
              <Badge size="sm" variant="primary">
                {ROLE_LABELS[role]}
              </Badge>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-subtle">Sent to</dt>
            <dd className="truncate text-fg">{invitedEmail}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-subtle">Joining as</dt>
            <dd className="truncate text-fg">{currentEmail}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-subtle">Expires</dt>
            <dd className="karo-numeric text-fg">
              {new Date(expiresAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </dd>
          </div>
        </dl>

        <p className="text-[12.5px] leading-relaxed text-muted">{ROLE_DESCRIPTIONS[role]}</p>

        {mismatch ? (
          <Alert variant="warning" icon={<MailWarning />}>
            <AlertTitle>This invitation was addressed to someone else</AlertTitle>
            <AlertDescription>
              It was sent to {invitedEmail}, but you are signed in as {currentEmail}. Accepting
              adds <span className="font-medium text-fg">{currentEmail}</span> to the team, and
              the team&apos;s audit log records both addresses. Sign in to the other account
              first if that is not what you want.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? <FieldError>{error}</FieldError> : null}

        <div className="flex flex-wrap gap-2">
          <Button loading={busy} onClick={accept} iconRight={<ArrowRight />}>
            Accept invitation
          </Button>
          <Button variant="secondary" asChild>
            <a href="/app">Not now</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
