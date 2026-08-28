import 'server-only';

import { and, asc, desc, eq, gt } from 'drizzle-orm';

import { readPreferences, type AvatarColor } from '@/lib/account/preferences';
import { db } from '@/lib/db';
import { invitations, teamMembers, users, type TeamRole } from '@/lib/db/schema';

/**
 * Team roster loading, shared by the page render and the JSON API so the two
 * can never disagree about who is in the team or how many seats are left.
 */

export type MemberView = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  avatarColor: AvatarColor;
  joinedAt: string;
  isOwner: boolean;
};

export type InvitationView = {
  id: string;
  email: string;
  role: TeamRole;
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

export async function listMembers(teamId: string, ownerId: string): Promise<MemberView[]> {
  const rows = await db
    .select({
      membershipId: teamMembers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: teamMembers.role,
      joinedAt: teamMembers.createdAt,
      onboardingState: users.onboardingState,
    })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.createdAt));

  return rows.map((row) => ({
    membershipId: row.membershipId,
    userId: row.userId,
    name: row.name || row.email.split('@')[0] || 'Teammate',
    email: row.email,
    role: row.role,
    avatarColor: readPreferences(row.onboardingState).avatarColor,
    joinedAt: row.joinedAt.toISOString(),
    isOwner: row.userId === ownerId,
  }));
}

/** Pending, unexpired invitations. Expired rows are shown so they can be cleared. */
export async function listPendingInvitations(teamId: string): Promise<InvitationView[]> {
  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      inviterName: users.name,
      inviterEmail: users.email,
    })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.invitedById))
    .where(and(eq(invitations.teamId, teamId), eq(invitations.status, 'pending')))
    .orderBy(desc(invitations.createdAt));

  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    invitedByName: row.inviterName || row.inviterEmail,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() < now,
  }));
}

export type SeatUsage = {
  used: number;
  pending: number;
  limit: number;
  remaining: number;
  atLimit: boolean;
};

/**
 * A pending invitation holds a seat. Otherwise a two-seat team could invite
 * five people and only discover the limit when the fifth clicks accept.
 */
export async function countSeats(teamId: string, limit: number): Promise<SeatUsage> {
  const [members, pending] = await Promise.all([
    db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.teamId, teamId)),
    db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.teamId, teamId),
          eq(invitations.status, 'pending'),
          gt(invitations.expiresAt, new Date()),
        ),
      ),
  ]);

  const used = members.length;
  const held = used + pending.length;

  return {
    used,
    pending: pending.length,
    limit,
    remaining: Math.max(0, limit - held),
    atLimit: held >= limit,
  };
}

export const INVITATION_TTL_DAYS = 7;

export function invitationExpiry(): Date {
  return new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Absolute accept URL. Returned once per token — the token itself is hashed. */
export function invitationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/app/team/join?token=${encodeURIComponent(token)}`;
}
