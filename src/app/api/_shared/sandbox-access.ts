import 'server-only';

import { eq } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { requireApiTeamPermission, requireApiUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import {
  projects,
  sandboxes,
  type Project,
  type Sandbox,
  type Team,
  type TeamRole,
  type User,
} from '@/lib/db/schema';
import type { Permission } from '@/lib/rbac/permissions';

/**
 * Resolves a sandbox and the caller's right to act on it.
 *
 * A sandbox always belongs to a team and usually to a project, so authorisation
 * runs against the owning team's membership. "Not yours" and "does not exist"
 * both produce a 404 — a 403 on a sandbox id would confirm that the id is real,
 * which is an enumeration oracle across teams.
 */
export type SandboxAccess = {
  sandbox: Sandbox;
  project: Project | null;
  team: Team;
  role: TeamRole;
  user: User;
};

export async function requireSandboxAccess(
  sandboxId: string,
  permission: Permission,
): Promise<SandboxAccess> {
  const { user } = await requireApiUser();

  const rows = await db
    .select({ sandbox: sandboxes, project: projects })
    .from(sandboxes)
    .leftJoin(projects, eq(sandboxes.projectId, projects.id))
    .where(eq(sandboxes.id, sandboxId))
    .limit(1);

  const row = rows[0];
  if (!row) throw notFound();

  try {
    const access = await requireApiTeamPermission(row.sandbox.teamId, permission);
    return {
      sandbox: row.sandbox,
      project: row.project,
      team: access.team,
      role: access.role,
      user,
    };
  } catch (error) {
    // The team guard 404s when the caller is not a member; re-word it so the
    // copy names the sandbox the caller actually asked for.
    if (error instanceof NotFoundError) throw notFound();
    throw error;
  }
}

function notFound(): NotFoundError {
  return new NotFoundError('Sandbox not found.', {
    title: 'Sandbox not found',
    description:
      'It was destroyed, or it belongs to a team you are not a member of. Create a new sandbox to keep working.',
  });
}
