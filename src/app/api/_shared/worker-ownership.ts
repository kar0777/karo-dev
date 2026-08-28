import 'server-only';

import { and, eq, ne } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { byosWorkers } from '@/lib/db/schema';

/**
 * Resolves a client-supplied BYOS `workerId` against the acting team.
 *
 * Three routes accept a worker id from a request body — creating a sandbox,
 * creating a project and patching a project — and none of them used to check who
 * owns it. Since a worker is a real machine that Karo executes shell commands
 * on, an unchecked id let one team pin its sandboxes to **another team's server**
 * and then run arbitrary commands there through `/api/sandboxes/[id]/exec`.
 *
 * A worker belonging to someone else is reported as *not found* rather than
 * forbidden: confirming that an id exists but belongs to another team is an
 * enumeration oracle, and the caller has no legitimate way to tell the
 * difference.
 */
export async function assertWorkerBelongsToTeam(
  workerId: string | null | undefined,
  teamId: string,
): Promise<void> {
  if (!workerId) return;

  const [row] = await db
    .select({ id: byosWorkers.id })
    .from(byosWorkers)
    .where(
      and(
        eq(byosWorkers.id, workerId),
        eq(byosWorkers.teamId, teamId),
        // A revoked worker is no longer a valid target even for its owner.
        ne(byosWorkers.status, 'revoked'),
      ),
    )
    .limit(1);

  if (!row) {
    throw new NotFoundError('That server is not registered to this team.');
  }
}
