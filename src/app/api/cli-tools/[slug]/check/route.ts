import { z } from 'zod';

import { routeParam } from '@/app/api/_shared/route-helpers';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getCliToolBySlug, probeCliInstall } from '@/lib/cli-tools/service';

/**
 * `POST /api/cli-tools/[slug]/check` — probe a sandbox for an installed tool.
 *
 * Runs `command -v <bin> && <bin> --version` through the sandbox's own exec
 * path (the same policy a user typing it would face) and records the result as
 * this sandbox's install state. Costs one command execution; safe to call
 * after an install finishes or whenever the workspace wants fresh state.
 */

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  sandboxId: z.string().min(1).max(64),
});

export const POST = defineHandler(
  { auth: 'required', rateLimit: 'terminal.command', body: bodySchema },
  async ({ params, body, user }) => {
    const tool = await getCliToolBySlug(routeParam(params, 'slug'));
    const access = await requireSandboxAccess(body.sandboxId, 'terminal.use');

    if (access.sandbox.status !== 'running') {
      // A machine that is not running has nothing to probe; the install state
      // is unknown rather than missing — it may come back with the machine.
      return json({ status: 'unknown', version: null });
    }

    return json(await probeCliInstall(access.sandbox, tool, user));
  },
);
