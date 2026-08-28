import { routeParam, serializeSandbox } from '@/app/api/_shared/route-helpers';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { startSandbox } from '@/lib/sandbox/service';

/**
 * `POST /api/sandboxes/[sandboxId]/start` — wake a sleeping machine.
 *
 * Idempotent: starting a sandbox that is already running returns it unchanged
 * rather than erroring, because the UI fires this on "run a command" as well as
 * on the explicit button and neither should ever produce a red toast.
 */

export const dynamic = 'force-dynamic';

export const POST = defineHandler({ auth: 'required' }, async ({ params, user }) => {
  const sandboxId = routeParam(params, 'sandboxId');
  const access = await requireSandboxAccess(sandboxId, 'sandbox.create');

  const wasRunning = access.sandbox.status === 'running';
  const sandbox = await startSandbox(access.sandbox.id, { userId: user.id, reason: 'manual' });

  return json({ sandbox: serializeSandbox(sandbox), alreadyRunning: wasRunning });
});
