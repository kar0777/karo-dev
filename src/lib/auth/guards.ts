import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { and, asc, eq } from 'drizzle-orm';

import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/lib/api/errors';
import { getSession, type ActiveSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import {
  projects,
  teamMembers,
  teams,
  type Project,
  type Session,
  type Team,
  type TeamMember,
  type TeamRole,
  type User,
} from '@/lib/db/schema';
import { assertCan, isPlatformAdmin, type Permission } from '@/lib/rbac/permissions';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';

/**
 * Access guards.
 *
 * Two flavours of the same checks:
 *  · **page guards** (`requireUser`, `requireProjectAccess`, …) redirect or
 *    404, because that is what a Server Component render should do;
 *  · **API guards** (`requireApiUser`, `requireApiTeamPermission`, …) throw
 *    `ApiError`s, which `defineHandler` turns into a JSON envelope.
 *
 * Missing-resource and no-access collapse into the *same* 404 on purpose.
 * A 403 on `/app/projects/prj_x` confirms that `prj_x` exists, which is an
 * enumeration oracle across teams.
 */

const LOGIN_PATH = '/login';

/**
 * Best-effort current path for the `?next=` round trip. Karo enforces auth in
 * layouts rather than middleware (per the architecture rules), so there is no
 * middleware to stamp a pathname header — we read whatever the runtime happens
 * to provide and fall back to the app root.
 */
async function currentPathname(): Promise<string> {
  try {
    const headerList = await headers();
    for (const name of ['x-karo-pathname', 'x-invoke-path', 'x-pathname', 'x-matched-path']) {
      const value = headerList.get(name);
      if (value && value.startsWith('/')) return value;
    }

    const nextUrl = headerList.get('next-url');
    if (nextUrl && nextUrl.startsWith('/')) return nextUrl;

    const referer = headerList.get('referer');
    if (referer) {
      const parsed = new URL(referer);
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    /* headers() is unavailable outside a request scope */
  }
  return '/app';
}

/* ------------------------------------------------------------------ *
 *  User guards
 * ------------------------------------------------------------------ */

/** Redirects to the sign-in screen when signed out. */
export async function requireUser(): Promise<ActiveSession> {
  const active = await getSession();

  if (!active) {
    const next = await currentPathname();
    redirect(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
  }

  if (active.user.isSuspended) {
    redirect(`${LOGIN_PATH}?error=account_suspended`);
  }

  return active;
}

/**
 * Whether this install demands a confirmed address at all. Off by default, and
 * off in the seed, so a demo stays frictionless.
 */
export async function isEmailVerificationEnforced(): Promise<boolean> {
  return getSetting(
    SETTING_KEYS.authRequireEmailVerification,
    settingDefault(SETTING_KEYS.authRequireEmailVerification),
  );
}

/**
 * The email-verification verdict for one account, and the single source of
 * truth behind both enforcement points: `defineHandler` refuses unsafe methods,
 * and the app layout swaps the page for a blocking state with a resend button.
 *
 * When the toggle is on an unverified user keeps every read and loses every
 * write. These are the ways *out*, and they have to stay open — a gate with no
 * escape hatch is a lock-out, and the account that most needs one is the person
 * who mistyped their own address at sign-up:
 *
 *  · `/verify-email` — the confirmation screen. It lives outside `/app`, so the
 *    app layout's gate cannot reach it.
 *  · `POST /api/auth/verify-email` and `…/resend` — spend a link, ask for a new
 *    one. Both sit under the `/api/auth/` prefix `defineHandler` leaves open.
 *  · `POST /api/auth/logout` — sign out. Same prefix.
 *  · `/app/settings` and `/api/settings/*` — the account's own profile,
 *    password, sessions and preferences. This is where a wrong address is
 *    corrected: saving a new one re-issues the confirmation link to it. None of
 *    these meter usage or touch team data.
 *  · `/app/billing` and `PATCH /api/billing/controls` — the spending cap and the
 *    automatic top-up switch. Automatic top-up charges from a scheduler that
 *    holds no session, so the gate never reaches it; refusing the switch would
 *    block stopping the money while the money kept going. Buying credit and
 *    changing plan stay closed.
 *
 * A platform admin gets no carve-out: `/api/admin/*` writes are refused like
 * everyone else's, the toggle itself included. Exempting the one role that can
 * turn the gate on is the one role it would then never apply to — but it does
 * mean an unverified admin has to confirm before switching it back off. The
 * seeded demo and admin accounts are created with `emailVerifiedAt` set, so
 * turning the toggle on cannot strand an operator inside their own demo.
 */
export async function isBlockedByEmailVerification(user: User): Promise<boolean> {
  // The settings read is skipped outright for confirmed accounts — that is the
  // common path, and it runs on every unsafe API request.
  if (user.emailVerifiedAt) return false;

  return isEmailVerificationEnforced();
}

/**
 * `/admin` returns 404 rather than 403 for everyone else, so the console is not
 * discoverable by probing.
 */
export async function requirePlatformAdmin(): Promise<ActiveSession> {
  const active = await getSession();
  if (!active || active.user.isSuspended || !isPlatformAdmin(active.user.platformRole)) {
    notFound();
  }
  return active;
}

/** API flavour: throws `UnauthorizedError` instead of redirecting. */
export async function requireApiUser(): Promise<ActiveSession> {
  const active = await getSession();
  if (!active) throw new UnauthorizedError();
  if (active.user.isSuspended) {
    throw new ForbiddenError('This account is suspended.', {
      title: 'Account suspended',
      description:
        'This account has been suspended by a platform administrator. Contact support to restore access.',
    });
  }
  return active;
}

/** API flavour of `requirePlatformAdmin`. Still reports 404, never 403. */
export async function requireApiPlatformAdmin(): Promise<ActiveSession> {
  const active = await getSession();
  if (!active || active.user.isSuspended || !isPlatformAdmin(active.user.platformRole)) {
    throw new NotFoundError('Not found.');
  }
  return active;
}

/* ------------------------------------------------------------------ *
 *  Team resolution
 * ------------------------------------------------------------------ */

export type ActiveTeam = {
  team: Team;
  membership: TeamMember;
  role: TeamRole;
};

type MembershipRow = { team: Team; membership: TeamMember };

async function listMemberships(userId: string): Promise<MembershipRow[]> {
  return db
    .select({ team: teams, membership: teamMembers })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.createdAt));
}

/**
 * Resolves which team a request operates on: the explicitly requested one when
 * the user is a member of it, otherwise their default team, otherwise their
 * personal team, otherwise the oldest team they belong to.
 */
export async function getActiveTeam(
  userId: string,
  requestedTeamId?: string | null,
): Promise<ActiveTeam> {
  const rows = await listMemberships(userId);
  if (rows.length === 0) {
    throw new NotFoundError('No team found for this account.', {
      title: 'No workspace yet',
      description:
        'This account has no team. Sign out and back in to have your personal workspace recreated.',
    });
  }

  const pick = (() => {
    if (requestedTeamId) {
      const requested = rows.find((r) => r.team.id === requestedTeamId);
      // Requesting a team you are not in is indistinguishable from it not
      // existing — do not fall back silently, that would hide a real bug.
      if (!requested) {
        throw new NotFoundError('Team not found.');
      }
      return requested;
    }
    return rows.find((r) => r.team.isPersonal) ?? rows[0]!;
  })();

  return { team: pick.team, membership: pick.membership, role: pick.membership.role };
}

/** All teams the user belongs to — for the team switcher. */
export async function listUserTeams(userId: string): Promise<ActiveTeam[]> {
  const rows = await listMemberships(userId);
  return rows.map((r) => ({ team: r.team, membership: r.membership, role: r.membership.role }));
}

async function resolveMembership(userId: string, teamId: string): Promise<ActiveTeam> {
  const rows = await db
    .select({ team: teams, membership: teamMembers })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError('Team not found.');

  return { team: row.team, membership: row.membership, role: row.membership.role };
}

export type TeamAccess = ActiveTeam & { user: User; session: Session };

/**
 * Page flavour: redirects when signed out, throws `PermissionError` when the
 * user is a member but lacks the permission.
 */
export async function requireTeamPermission(
  teamId: string,
  permission: Permission,
): Promise<TeamAccess> {
  const { user, session } = await requireUser();
  const access = await resolveMembership(user.id, teamId);
  assertCan(access.role, permission);
  return { ...access, user, session };
}

/** API flavour: throws `UnauthorizedError` / `PermissionError`. */
export async function requireApiTeamPermission(
  teamId: string,
  permission: Permission,
): Promise<TeamAccess> {
  const { user, session } = await requireApiUser();
  const access = await resolveMembership(user.id, teamId);
  assertCan(access.role, permission);
  return { ...access, user, session };
}

/* ------------------------------------------------------------------ *
 *  Project access
 * ------------------------------------------------------------------ */

export type ProjectAccess = {
  project: Project;
  team: Team;
  membership: TeamMember;
  role: TeamRole;
  user: User;
  session: Session;
};

/**
 * Loads the project, its team and the caller's membership in one round trip.
 * The inner join on `team_members` is what makes "not yours" and "not there"
 * produce the identical 404.
 */
async function loadProjectAccess(
  userId: string,
  projectId: string,
): Promise<{ project: Project; team: Team; membership: TeamMember }> {
  const rows = await db
    .select({ project: projects, team: teams, membership: teamMembers })
    .from(projects)
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, userId)),
    )
    .where(eq(projects.id, projectId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Project not found.', {
      title: 'Project not found',
      description:
        'This project does not exist, or it belongs to a team you are not a member of. Ask a team admin to invite you.',
    });
  }
  return row;
}

/** Page flavour: redirects when signed out. */
export async function requireProjectAccess(
  projectId: string,
  permission: Permission = 'project.read',
): Promise<ProjectAccess> {
  const { user, session } = await requireUser();
  const row = await loadProjectAccess(user.id, projectId);
  assertCan(row.membership.role, permission);
  return { ...row, role: row.membership.role, user, session };
}

/** API flavour: throws instead of redirecting. */
export async function requireApiProjectAccess(
  projectId: string,
  permission: Permission = 'project.read',
): Promise<ProjectAccess> {
  const { user, session } = await requireApiUser();
  const row = await loadProjectAccess(user.id, projectId);
  assertCan(row.membership.role, permission);
  return { ...row, role: row.membership.role, user, session };
}
