import { and, eq } from 'drizzle-orm';

import {
  INSTALL_TOKEN_TTL_MS,
  buildInstallCommand,
  mintInstallToken,
  toWorkerView,
} from '@/lib/account/byos';
import { pathParam } from '@/lib/account/route-params';
import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { byosWorkers } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';
import { drainWorker } from '@/lib/sandbox/worker-bus';

/**
 * Rotate a server's credentials.
 *
 * The existing worker token stops working the moment this returns, so the
 * machine must run the install command again with the new one-time token. That
 * is the whole recovery path for "the token leaked" and for "the install token
 * expired before I got to the server".
 */
export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: 'worker.rotate', resourceType: 'worker' },
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
          'It was removed, or it belongs to another team. Reload the page to see the current list.',
      });
    }

    const installToken = mintInstallToken();
    const now = new Date();

    const updated = await db
      .update(byosWorkers)
      .set({
        status: 'pending',
        installTokenHash: installToken.tokenHash,
        installTokenExpiresAt: installToken.expiresAt,
        workerTokenHash: null,
        tokenRotatedAt: now,
        revokedAt: null,
        lastHeartbeatAt: null,
        registeredAt: null,
        updatedAt: now,
      })
      .where(eq(byosWorkers.id, id))
      .returning();

    await drainWorker(
      id,
      'This server’s token was rotated. Re-run the install command with the new token to reconnect it.',
    );

    setAudit({
      teamId: team.id,
      resourceId: id,
      severity: 'notice',
      summary: `Token rotated for server "${existing.name}"`,
      metadata: { expiresAt: installToken.expiresAt.toISOString() },
    });

    return json({
      worker: toWorkerView(updated[0] ?? existing),
      installToken: installToken.token,
      installCommand: buildInstallCommand(installToken.token),
      expiresAt: installToken.expiresAt.toISOString(),
      expiresInMinutes: Math.round(INSTALL_TOKEN_TTL_MS / 60_000),
    });
  },
);
