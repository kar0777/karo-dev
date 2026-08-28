import { and, eq } from 'drizzle-orm';

import { toWorkerView } from '@/lib/account/byos';
import { pathParam } from '@/lib/account/route-params';
import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { byosWorkers } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';
import { drainWorker } from '@/lib/sandbox/worker-bus';

/**
 * Revoke a server.
 *
 * The row is kept rather than deleted so the audit trail still resolves, but
 * both tokens are invalidated and every command waiting on the machine is
 * failed immediately — a revoked worker must not be able to finish work it had
 * already been handed.
 */
export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.workerRevoke, resourceType: 'worker' },
  },
  async ({ user, params, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'worker.manage');

    const id = pathParam(params, 'id');

    const rows = await db
      .select()
      .from(byosWorkers)
      .where(and(eq(byosWorkers.id, id), eq(byosWorkers.teamId, team.id)))
      .limit(1);

    const existing = rows[0];
    if (!existing) {
      throw new NotFoundError('That server is not registered.', {
        title: 'Server not found',
        description:
          'It was already removed, or it belongs to another team. Reload the page to see the current list.',
      });
    }

    const now = new Date();
    const updated = await db
      .update(byosWorkers)
      .set({
        status: 'revoked',
        revokedAt: now,
        // Invalidating both hashes is what actually cuts the machine off.
        workerTokenHash: null,
        installTokenExpiresAt: now,
        updatedAt: now,
      })
      .where(eq(byosWorkers.id, id))
      .returning();

    drainWorker(
      id,
      'This server was revoked in Karo. Run the install command again with a fresh token to reconnect it.',
    );

    setAudit({
      teamId: team.id,
      resourceId: id,
      severity: 'warning',
      summary: `Server "${existing.name}" revoked`,
      metadata: { hostname: existing.hostname },
    });

    return json({ worker: toWorkerView(updated[0] ?? existing) });
  },
);
