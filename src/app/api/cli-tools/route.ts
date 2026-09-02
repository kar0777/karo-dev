import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { sandboxCliInstalls } from '@/lib/db/schema';
import { listEnabledCliTools } from '@/lib/cli-tools/service';

/**
 * `GET /api/cli-tools` — the installable CLI agent catalogue.
 *
 * Signed-in users get the enabled tools with their vendor install commands and
 * license/auth posture. Pass `?sandboxId=` to also include the last probed
 * install state for that machine, so the workspace can show "installed v2.1"
 * without the client running version checks itself.
 */

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  sandboxId: z.string().trim().max(64).optional(),
});

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default', query: querySchema },
  async ({ query }) => {
    const tools = await listEnabledCliTools();

    let installs: (typeof sandboxCliInstalls.$inferSelect)[] = [];
    if (query.sandboxId) {
      const access = await requireSandboxAccess(query.sandboxId, 'terminal.use');
      installs = await db
        .select()
        .from(sandboxCliInstalls)
        .where(eq(sandboxCliInstalls.sandboxId, access.sandbox.id));
    }

    const installByTool = new Map(installs.map((row) => [row.toolId, row]));

    return json({
      tools: tools.map((tool) => ({
        id: tool.id,
        slug: tool.slug,
        name: tool.name,
        vendor: tool.vendor,
        description: tool.description,
        license: tool.license,
        licenseKind: tool.licenseKind,
        licenseUrl: tool.licenseUrl,
        docsUrl: tool.docsUrl,
        authKind: tool.authKind,
        authNote: tool.authNote,
        apiKeyEnvVar: tool.apiKeyEnvVar,
        installCommands: tool.installCommands,
        launchCommand: tool.launchCommand,
        install: installByTool.get(tool.id)
          ? {
              status: installByTool.get(tool.id)!.status,
              version: installByTool.get(tool.id)!.version,
              lastCheckedAt: installByTool.get(tool.id)!.lastCheckedAt,
            }
          : null,
      })),
    });
  },
);
