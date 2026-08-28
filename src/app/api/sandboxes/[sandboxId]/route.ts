import { routeParam, serializeSandbox } from '@/app/api/_shared/route-helpers';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { destroySandbox } from '@/lib/sandbox/service';

/**
 * `/api/sandboxes/[sandboxId]` — inspect and destroy one machine.
 *
 * Destroying is irreversible and frees a plan slot immediately, so it needs
 * `sandbox.destroy` rather than the softer `sandbox.stop`. Files are safe: the
 * workspace lives in `project_files`, and the next sandbox is seeded from it.
 */

export const dynamic = 'force-dynamic';

export const GET = defineHandler({ auth: 'required' }, async ({ params }) => {
  const sandboxId = routeParam(params, 'sandboxId');
  const access = await requireSandboxAccess(sandboxId, 'sandbox.read');

  return json({
    sandbox: serializeSandbox(access.sandbox),
    project: access.project
      ? { id: access.project.id, name: access.project.name, slug: access.project.slug }
      : null,
    role: access.role,
  });
});

export const DELETE = defineHandler({ auth: 'required' }, async ({ params, user }) => {
  const sandboxId = routeParam(params, 'sandboxId');
  const access = await requireSandboxAccess(sandboxId, 'sandbox.destroy');

  const sandbox = await destroySandbox(access.sandbox.id, {
    userId: user.id,
    reason: 'manual',
  });

  return json({
    sandbox: serializeSandbox(sandbox),
    destroyed: true,
    // Reassure the caller before they panic about the code they were writing.
    filesRetained: true,
  });
});
