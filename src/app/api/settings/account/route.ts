import { and, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, ForbiddenError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { recordAudit } from '@/lib/audit';
import { destroySession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import {
  byosWorkers,
  installedPlugins,
  installedSkills,
  mcpServers,
  projects,
  sandboxes,
  teamMembers,
  teams,
  users,
} from '@/lib/db/schema';

/**
 * Delete an account.
 *
 * Most of the graph cascades from `users`, but six tables reference the creator
 * with `ON DELETE RESTRICT` on purpose — a project must never lose the record of
 * who made it. So deletion has two jobs before the row can go:
 *
 *  1. **Teams the user owns are deleted**, which cascades everything inside them.
 *     A shared team with other members is refused instead: silently deleting
 *     four colleagues' projects is not a reasonable reading of "delete my
 *     account".
 *  2. **Work created inside teams the user merely belongs to is reassigned** to
 *     that team's owner, so the team keeps functioning.
 */

const bodySchema = z.object({
  /** The account's own email address, typed by hand. */
  confirmation: z.string().min(1, 'Type your email address to confirm').max(254),
});

export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'auth.reset',
    body: bodySchema,
  },
  async ({ user, body, req }) => {
    if (body.confirmation.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new ValidationError(
        'The confirmation does not match your email address.',
        [
          {
            path: 'confirmation',
            message: 'Type your email address exactly as it appears above',
            code: 'confirmation_mismatch',
          },
        ],
        {
          title: 'Confirmation does not match',
          description:
            'Deleting an account cannot be undone, so it needs your exact email address. Nothing has been removed.',
        },
      );
    }

    if (user.isDemo) {
      throw new ForbiddenError('The shared demo account cannot be deleted.', {
        title: 'Demo account is protected',
        description:
          'This account is the public demo everyone signs into. Register a normal account if you want one you can delete.',
      });
    }

    const ownedTeams = await db.select().from(teams).where(eq(teams.ownerId, user.id));
    const ownedTeamIds = ownedTeams.map((team) => team.id);

    // A shared team must be handed over first — refuse rather than destroy it.
    if (ownedTeamIds.length > 0) {
      const others = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(and(inArray(teamMembers.teamId, ownedTeamIds), ne(teamMembers.userId, user.id)));

      if (others.length > 0) {
        const blocked = new Set(others.map((row) => row.teamId));
        const names = ownedTeams
          .filter((team) => blocked.has(team.id))
          .map((team) => team.name);

        throw new ConflictError(
          `You still own ${names.length === 1 ? 'a team' : 'teams'} with other members: ${names.join(', ')}.`,
          {
            title: 'Hand over your teams first',
            description:
              'Deleting your account would delete these teams and everything in them. Remove the other members, or ask a platform administrator to transfer ownership, then try again.',
            details: { teams: names },
          },
        );
      }
    }

    const memberships = await db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id));

    const foreignTeamIds = memberships
      .map((row) => row.teamId)
      .filter((teamId) => !ownedTeamIds.includes(teamId));

    // Written before the delete: the `users` foreign key is `ON DELETE SET
    // NULL`, so the entry survives the account with its metadata intact, but an
    // insert *after* the row is gone would violate the constraint outright.
    await recordAudit({
      action: 'user.delete',
      actorType: 'user',
      userId: user.id,
      resourceType: 'user',
      resourceId: user.id,
      severity: 'critical',
      summary: 'Account deleted',
      metadata: {
        email: user.email,
        deletedTeams: ownedTeamIds.length,
        reassignedInTeams: foreignTeamIds.length,
      },
      request: req,
    });

    await db.transaction(async (tx) => {
      if (ownedTeamIds.length > 0) {
        await tx.delete(teams).where(inArray(teams.id, ownedTeamIds));
      }

      for (const teamId of foreignTeamIds) {
        const [team] = await tx
          .select({ ownerId: teams.ownerId })
          .from(teams)
          .where(eq(teams.id, teamId))
          .limit(1);
        if (!team) continue;

        const successor = team.ownerId;

        await tx
          .update(projects)
          .set({ createdById: successor, updatedAt: new Date() })
          .where(and(eq(projects.teamId, teamId), eq(projects.createdById, user.id)));

        await tx
          .update(sandboxes)
          .set({ createdById: successor, updatedAt: new Date() })
          .where(and(eq(sandboxes.teamId, teamId), eq(sandboxes.createdById, user.id)));

        await tx
          .update(mcpServers)
          .set({ createdById: successor, updatedAt: new Date() })
          .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.createdById, user.id)));

        await tx
          .update(installedSkills)
          .set({ installedById: successor, updatedAt: new Date() })
          .where(
            and(eq(installedSkills.teamId, teamId), eq(installedSkills.installedById, user.id)),
          );

        await tx
          .update(installedPlugins)
          .set({ installedById: successor, updatedAt: new Date() })
          .where(
            and(
              eq(installedPlugins.teamId, teamId),
              eq(installedPlugins.installedById, user.id),
            ),
          );

        await tx
          .update(byosWorkers)
          .set({ createdById: successor, updatedAt: new Date() })
          .where(and(eq(byosWorkers.teamId, teamId), eq(byosWorkers.createdById, user.id)));
      }

      await tx.delete(users).where(eq(users.id, user.id));
    });

    await destroySession();

    return json({ ok: true, deletedTeams: ownedTeamIds.length });
  },
);
