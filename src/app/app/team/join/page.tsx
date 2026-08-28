export const dynamic = 'force-dynamic';

import { eq } from 'drizzle-orm';
import { Ban, CalendarX, Link2Off, MailX, TicketX, UserCheck, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { firstParam } from '@/components/auth/next-path';
import { JoinTeamForm } from '@/components/settings/join-team-form';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { INVITATION_TTL_DAYS } from '@/lib/account/team';
import { requireUser } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import {
  invitations,
  teamMembers,
  teams,
  users,
  type Invitation,
  type Team,
} from '@/lib/db/schema';
import { loadBillingContext } from '@/lib/usage/metering';
import { formatDate, pluralize } from '@/lib/utils';

/**
 * Invitation accept screen — the landing page for the link `invitationUrl()`
 * emails to every invitee.
 *
 * The validity rules here are the same ones `POST /api/invitations/accept`
 * enforces, read from the same rows: the token is looked up by its SHA-256, and
 * every state that endpoint would reject renders an explanation instead of a
 * Join button. The one deliberate difference is ordering — membership is
 * checked before the invitation status, because a link clicked twice is the
 * common case and "you are already in this team" explains it better than
 * "already used". Both are dead ends, so the two can never disagree about
 * whether joining is offered.
 *
 * The page never writes. The endpoint flips a lapsed invitation to `expired`
 * when the link is actually used; a render must stay read-only.
 */

const PATH = '/app/team/join';

export const metadata: Metadata = {
  title: 'Join a team',
  description: 'Accept an invitation and add this account to the team that invited you.',
};

/** Matches the accept endpoint's body schema, so the two agree on what a token is. */
function normalizeToken(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length < 10 || trimmed.length > 400) return null;
  return trimmed;
}

/** Kept out of the component body — the React Compiler rules reject `Date.now()` there. */
function hasLapsed(expiresAt: Date): boolean {
  return expiresAt.getTime() < Date.now();
}

type InvitationRow = {
  invitation: Invitation;
  team: Team;
  inviterName: string;
  inviterEmail: string;
};

/**
 * The endpoint's lookup, verbatim, plus the inviter so the card can name them.
 * Only the SHA-256 of the token is on file, which is why an unknown hash cannot
 * be told apart from a link that was reissued.
 */
async function findInvitation(token: string): Promise<InvitationRow | null> {
  const [row] = await db
    .select({
      invitation: invitations,
      team: teams,
      inviterName: users.name,
      inviterEmail: users.email,
    })
    .from(invitations)
    .innerJoin(teams, eq(teams.id, invitations.teamId))
    .innerJoin(users, eq(users.id, invitations.invitedById))
    .where(eq(invitations.tokenHash, sha256(token)))
    .limit(1);

  return row ?? null;
}

/** Every outcome shares the same chrome, so the branches below only vary the body. */
function JoinScreen({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Join a team"
        description="Invitation links open here. Accepting adds the account you are signed in with to the team named in the invitation."
        breadcrumbs={[
          { label: 'Karo', href: '/app' },
          { label: 'Team', href: '/app/team' },
          { label: 'Join' },
        ]}
      />
      {children}
    </div>
  );
}

/** Every dead end offers the same way out, rather than each spelling one out. */
function BackToKaro() {
  return (
    <Button asChild variant="secondary" size="sm">
      <Link href="/app">Back to Karo</Link>
    </Button>
  );
}

export default async function JoinTeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = firstParam(params.token);
  const token = normalizeToken(raw);

  // `requireUser()` rebuilds `?next=` from request headers, and Karo has no
  // middleware to stamp the pathname — on a cold visit it falls back to `/app`
  // and the token is dropped. Invitees arrive here signed out from a mail
  // client almost every time, so the redirect is issued here with the token
  // still attached; the login screen reads it back through `safeNextPath`.
  const active = await getSession();
  if (!active) {
    const returnTo = token ? `${PATH}?token=${encodeURIComponent(token)}` : PATH;
    redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  }

  // Suspension handling and the session shape stay with the shared guard. The
  // read above is memoised per request, so this costs no extra query.
  const { user } = await requireUser();

  // `?token=` with nothing after it is the same failure as no `token` at all —
  // a mail client wrapped or truncated the URL — so it gets the advice that
  // actually helps rather than "not found".
  if (raw === null || raw.trim() === '') {
    return (
      <JoinScreen>
        <ErrorState
          icon={Link2Off}
          code="missing_token"
          title="This link is missing its token"
          description="An invitation carries a one-time token in the query string, and this address arrived without it. Open the link straight from the invitation email instead of retyping it, or ask the team to send a new one."
          secondaryAction={<BackToKaro />}
        />
      </JoinScreen>
    );
  }

  // A token outside the shape the endpoint accepts could only ever be rejected,
  // so it takes the same route as one that is genuinely not on file.
  const row = token === null ? null : await findInvitation(token);

  if (token === null || row === null) {
    return (
      <JoinScreen>
        <ErrorState
          icon={MailX}
          code="invitation_not_found"
          title="Invitation not found"
          description="This link does not match any invitation. Karo stores only a hash of each token, so a link that was revoked or reissued stops working the moment a newer one is sent. Ask the team for a fresh invitation."
          secondaryAction={<BackToKaro />}
        />
      </JoinScreen>
    );
  }

  const { invitation, team } = row;

  // One roster read answers both questions the endpoint asks separately:
  // whether this account is in the team already, and whether a seat is left.
  const members = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, team.id));

  if (members.some((member) => member.userId === user.id)) {
    return (
      <JoinScreen>
        <EmptyState
          icon={UserCheck}
          title={`You are already in ${team.name}`}
          description={`${user.email} is a member of this team, so there is nothing left to accept. If Karo is showing another workspace, switch with the team picker at the top of the sidebar.`}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/team">Open team</Link>
            </Button>
          }
        />
      </JoinScreen>
    );
  }

  if (invitation.status === 'accepted') {
    const usedOn = invitation.acceptedAt ? ` on ${formatDate(invitation.acceptedAt)}` : '';
    return (
      <JoinScreen>
        <ErrorState
          icon={TicketX}
          code="invitation_accepted"
          title="Invitation already used"
          description={`This link was already used to join ${team.name}${usedOn}, and each invitation is good for one account. Ask a team admin for a new invitation if you still need access.`}
          secondaryAction={<BackToKaro />}
        />
      </JoinScreen>
    );
  }

  if (invitation.status === 'revoked') {
    return (
      <JoinScreen>
        <ErrorState
          icon={Ban}
          code="invitation_revoked"
          title="Invitation no longer valid"
          description={`${team.name} revoked this invitation, which takes the link out of use immediately. Ask them to send a new one if you were expecting to join.`}
          secondaryAction={<BackToKaro />}
        />
      </JoinScreen>
    );
  }

  // The status column is set to `expired` lazily, so the timestamp is the real
  // test — a row can still read `pending` well past its expiry.
  if (invitation.status === 'expired' || hasLapsed(invitation.expiresAt)) {
    return (
      <JoinScreen>
        <ErrorState
          icon={CalendarX}
          code="invitation_expired"
          title="Invitation expired"
          description={`Invitations are valid for ${INVITATION_TTL_DAYS} days, and this one lapsed on ${formatDate(invitation.expiresAt)}. Ask a team admin to resend it — that issues a fresh link and leaves your place in the team unchanged.`}
          secondaryAction={<BackToKaro />}
        />
      </JoinScreen>
    );
  }

  // Loaded only once the invitation is otherwise acceptable: this reads the
  // plan of a team the visitor is not in yet, and it materialises the team's
  // usage period as a side effect. Neither belongs on a dead-end render.
  const billing = await loadBillingContext(team.id);
  const seats = billing.plan.maxTeamMembers;

  if (members.length >= seats) {
    return (
      <JoinScreen>
        <ErrorState
          icon={Users}
          code="seats_exhausted"
          title="The team is full"
          description={`${team.name} is on the ${billing.plan.name} plan, which includes ${seats} ${pluralize(seats, 'seat')} — all of them are taken. Ask an owner to upgrade the plan or free a seat, then open this link again. The invitation stays valid until ${formatDate(invitation.expiresAt)}.`}
          secondaryAction={<BackToKaro />}
        />
      </JoinScreen>
    );
  }

  return (
    <JoinScreen>
      <JoinTeamForm
        token={token}
        teamName={team.name}
        teamAvatarColor={team.avatarColor}
        role={invitation.role}
        invitedEmail={invitation.email}
        invitedByName={row.inviterName || row.inviterEmail}
        currentEmail={user.email}
        expiresAt={invitation.expiresAt.toISOString()}
      />
    </JoinScreen>
  );
}
