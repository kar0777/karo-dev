import { z } from 'zod';

import { routeParam, serializeSandbox } from '@/app/api/_shared/route-helpers';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { stopSandbox } from '@/lib/sandbox/service';

/**
 * `POST /api/sandboxes/[sandboxId]/stop` — stop billing for a machine.
 *
 * Stopping closes the compute window and meters it, so the charge the user sees
 * is final the moment this returns. `sleep: true` marks it as *asleep* instead
 * of stopped, which is the same runtime state but a different promise to the
 * user: an asleep sandbox wakes automatically on the next command.
 */

export const dynamic = 'force-dynamic';

const body = z
  .object({
    sleep: z.boolean().optional(),
    reason: z.string().trim().max(120).optional(),
  })
  .default({});

export const POST = defineHandler(
  { auth: 'required', body },
  async ({ params, body: input, user }) => {
    const sandboxId = routeParam(params, 'sandboxId');
    const access = await requireSandboxAccess(sandboxId, 'sandbox.stop');

    const sandbox = await stopSandbox(access.sandbox.id, {
      userId: user.id,
      sleep: input.sleep ?? false,
      reason: input.reason ?? 'manual',
    });

    return json({
      sandbox: serializeSandbox(sandbox),
      stopped: true,
      billedSeconds: sandbox.totalActiveSeconds - access.sandbox.totalActiveSeconds,
    });
  },
);
