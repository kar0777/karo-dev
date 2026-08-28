import { routeParam, serializeSandbox } from '@/app/api/_shared/route-helpers';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { restartSandbox } from '@/lib/sandbox/service';

/**
 * `POST /api/sandboxes/[sandboxId]/restart` — stop, then start.
 *
 * The stop half closes and meters the current compute window, so a restart is
 * billed as two windows rather than one continuous run. That is deliberate: the
 * processes really did stop, and a usage chart that pretended otherwise would
 * hide the gap.
 */

export const dynamic = 'force-dynamic';

export const POST = defineHandler({ auth: 'required' }, async ({ params, user }) => {
  const sandboxId = routeParam(params, 'sandboxId');
  const access = await requireSandboxAccess(sandboxId, 'sandbox.stop');

  const sandbox = await restartSandbox(access.sandbox.id, {
    userId: user.id,
    reason: 'restart',
  });

  return json({ sandbox: serializeSandbox(sandbox), restarted: true });
});
