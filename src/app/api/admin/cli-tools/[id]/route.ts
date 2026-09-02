import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { routeParam } from '@/app/api/_shared/route-helpers';
import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { cliTools } from '@/lib/db/schema';

/** Update or retire one CLI tool in the installable-agent catalogue. */

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  vendor: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  license: z.string().trim().max(80).optional(),
  licenseKind: z.enum(['free', 'proprietary']).optional(),
  licenseUrl: z.string().trim().url().max(500).nullable().optional(),
  docsUrl: z.string().trim().url().max(500).nullable().optional(),
  authKind: z.enum(['login', 'api_key', 'none']).optional(),
  authNote: z.string().trim().max(300).optional(),
  apiKeyEnvVar: z.string().trim().max(80).nullable().optional(),
  apiKeyProviderKey: z.string().trim().max(40).nullable().optional(),
  binName: z.string().trim().min(1).max(80).optional(),
  versionArg: z.string().trim().max(40).optional(),
  installCommands: z
    .object({
      sandbox: z.string().trim().min(1).max(2_000),
      macos: z.string().trim().max(2_000),
      linux: z.string().trim().max(2_000),
      windows: z.string().trim().max(2_000),
    })
    .optional(),
  launchCommand: z.string().trim().max(300).optional(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

function resolveId(params: Record<string, string | string[] | undefined>): string {
  return routeParam(params, 'id');
}

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: patchSchema,
    audit: { action: AUDIT_ACTIONS.adminCliToolUpdate, resourceType: 'cli_tool' },
  },
  async ({ params, body, user, setAudit }) => {
    await requireApiPlatformAdmin();

    const id = resolveId(params);
    const [current] = await db.select().from(cliTools).where(eq(cliTools.id, id)).limit(1);
    if (!current) throw new NotFoundError('That CLI tool does not exist.');

    await db
      .update(cliTools)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(cliTools.id, id));

    setAudit({
      resourceId: id,
      summary: `Updated CLI tool ${current.name} (${current.slug})`,
      metadata: { slug: current.slug, changes: body, actorId: user.id },
    });

    const [updated] = await db.select().from(cliTools).where(eq(cliTools.id, id)).limit(1);
    return json({ tool: updated });
  },
);

export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.adminCliToolDelete, resourceType: 'cli_tool' },
  },
  async ({ params, user, setAudit }) => {
    await requireApiPlatformAdmin();

    const id = resolveId(params);
    const [current] = await db.select().from(cliTools).where(eq(cliTools.id, id)).limit(1);
    if (!current) throw new NotFoundError('That CLI tool does not exist.');

    await db.delete(cliTools).where(eq(cliTools.id, id));

    setAudit({
      resourceId: id,
      summary: `Removed CLI tool ${current.name} (${current.slug})`,
      metadata: { slug: current.slug, actorId: user.id },
    });

    return json({ ok: true });
  },
);
