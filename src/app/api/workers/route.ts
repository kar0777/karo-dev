import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  INSTALL_TOKEN_TTL_MS,
  buildInstallCommand,
  mintInstallToken,
  toWorkerView,
} from '@/lib/account/byos';
import { ForbiddenError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { byosWorkers } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { assertCan } from '@/lib/rbac/permissions';
import { loadBillingContext } from '@/lib/usage/metering';

/**
 * Bring-Your-Own-Server registration.
 *
 * `POST` mints a one-time installation token and returns it **once**, in
 * plaintext, alongside the ready-to-paste install command. Only its SHA-256 is
 * stored, so this response is the single moment the value exists outside the
 * operator's terminal — the UI says so, loudly.
 */

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the server a name').max(60),
});

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ user }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'sandbox.read');

    const rows = await db
      .select()
      .from(byosWorkers)
      .where(eq(byosWorkers.teamId, team.id))
      .orderBy(desc(byosWorkers.createdAt));

    const now = Date.now();
    return json({ workers: rows.map((row) => toWorkerView(row, now)) });
  },
);

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: createSchema,
    audit: { action: 'worker.create', resourceType: 'worker' },
  },
  async ({ user, body, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'worker.manage');

    const billing = await loadBillingContext(team.id);
    if (!billing.plan.allowOwnServer) {
      throw new ForbiddenError('Your plan cannot connect its own servers.', {
        title: 'Own servers are not on this plan',
        description: `The ${billing.plan.name} plan runs sandboxes on Karo's infrastructure only. Upgrade to run them on hardware you control.`,
      });
    }

    const installToken = mintInstallToken();
    const id = newId(ID_PREFIX.worker);

    const inserted = await db
      .insert(byosWorkers)
      .values({
        id,
        teamId: team.id,
        createdById: user.id,
        name: body.name,
        status: 'pending',
        installTokenHash: installToken.tokenHash,
        installTokenExpiresAt: installToken.expiresAt,
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('Worker insert returned no row');

    setAudit({
      teamId: team.id,
      resourceId: row.id,
      severity: 'notice',
      summary: `Installation token issued for server "${row.name}"`,
      metadata: { expiresAt: installToken.expiresAt.toISOString() },
    });

    return created({
      worker: toWorkerView(row),
      // Shown once. Never retrievable afterwards — only the hash is stored.
      installToken: installToken.token,
      installCommand: buildInstallCommand(installToken.token),
      installCommandWindows: buildInstallCommand(installToken.token, 'powershell'),
      expiresAt: installToken.expiresAt.toISOString(),
      expiresInMinutes: Math.round(INSTALL_TOKEN_TTL_MS / 60_000),
    });
  },
);
