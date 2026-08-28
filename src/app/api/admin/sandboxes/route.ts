import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { loadSandboxFleet, loadSandboxStats } from '@/app/admin/_data/sandboxes';
import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { sandboxes } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { getProvider, SandboxError, type SandboxProviderKey } from '@/lib/sandbox';

/**
 * The sandbox fleet, across every team.
 *
 * Force-stop and force-destroy are operator actions of last resort, so the
 * database row is always brought to a consistent state even when the provider
 * call fails: a machine that cannot be reached is worse than useless if Karo
 * keeps billing for it.
 */

const log = createLogger('admin:sandboxes');

const PROVIDER_KEYS: SandboxProviderKey[] = [
  'mock',
  'local-docker',
  'daytona',
  'remote-docker',
  'external',
];

function providerKeyOf(value: string): SandboxProviderKey {
  return (PROVIDER_KEYS as string[]).includes(value) ? (value as SandboxProviderKey) : 'mock';
}

const querySchema = z.object({
  status: z.string().trim().max(30).optional(),
  provider: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const bodySchema = z.object({
  sandboxId: z.string().trim().min(1).max(80),
  action: z.enum(['stop', 'destroy']),
  reason: z.string().trim().max(500).optional(),
});

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default', query: querySchema },
  async ({ query }) => {
    await requireApiPlatformAdmin();
    const [rows, stats] = await Promise.all([
      loadSandboxFleet({ status: query.status, provider: query.provider, limit: query.limit }),
      loadSandboxStats(),
    ]);
    return json({ sandboxes: rows, stats });
  },
);

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: { action: AUDIT_ACTIONS.sandboxStop, resourceType: 'sandbox', severity: 'warning' },
  },
  async ({ body, setAudit, req, user }) => {
    await requireApiPlatformAdmin();

    const rows = await db
      .select()
      .from(sandboxes)
      .where(eq(sandboxes.id, body.sandboxId))
      .limit(1);
    const sandbox = rows[0];
    if (!sandbox) throw new NotFoundError('That sandbox does not exist.');

    const provider = getProvider(providerKeyOf(sandbox.provider));
    const externalId = sandbox.externalId ?? sandbox.id;
    const now = new Date();

    let providerError: string | null = null;
    try {
      if (body.action === 'stop') await provider.stopSandbox(externalId);
      else await provider.destroySandbox(externalId);
    } catch (error) {
      // The row is still moved to a terminal state — an unreachable machine
      // must not keep accruing compute charges against a team.
      providerError =
        error instanceof SandboxError || error instanceof Error
          ? error.message
          : 'Unknown provider error';
      log.warn('Force action failed at the provider; forcing the row anyway', {
        sandboxId: sandbox.id,
        action: body.action,
        error,
      });
    }

    await db
      .update(sandboxes)
      .set(
        body.action === 'stop'
          ? {
              status: 'stopped',
              statusMessage: providerError
                ? `Force-stopped by a platform admin. Provider reported: ${providerError}`
                : 'Force-stopped by a platform admin.',
              stoppedAt: now,
              updatedAt: now,
            }
          : {
              status: 'destroyed',
              statusMessage: providerError
                ? `Force-destroyed by a platform admin. Provider reported: ${providerError}`
                : 'Force-destroyed by a platform admin.',
              stoppedAt: sandbox.stoppedAt ?? now,
              destroyedAt: now,
              updatedAt: now,
            },
      )
      .where(eq(sandboxes.id, sandbox.id));

    // The concrete action depends on the branch taken, and `setAudit` cannot
    // change the configured action key — so this route writes its own event.
    setAudit({ record: false });
    await recordAudit({
      action: body.action === 'stop' ? AUDIT_ACTIONS.sandboxStop : AUDIT_ACTIONS.sandboxDestroy,
      actorType: 'user',
      userId: user.id,
      teamId: sandbox.teamId,
      resourceType: 'sandbox',
      resourceId: sandbox.id,
      severity: 'warning',
      summary: `Platform admin force-${body.action === 'stop' ? 'stopped' : 'destroyed'} sandbox "${sandbox.name}"`,
      metadata: {
        provider: sandbox.provider,
        teamId: sandbox.teamId,
        reason: body.reason ?? null,
        providerError,
      },
      request: req,
    });

    return json({
      ok: true,
      providerError,
      status: body.action === 'stop' ? 'stopped' : 'destroyed',
    });
  },
);
