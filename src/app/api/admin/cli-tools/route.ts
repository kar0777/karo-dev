import { asc } from 'drizzle-orm';
import { z } from 'zod';

import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { cliTools } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * `GET|POST /api/admin/cli-tools` — manage the installable CLI agent catalogue.
 *
 * The seeds ship the vendor-documented install commands; this endpoint lets an
 * operator add a private/unlisted tool, fix a changed install command, or turn
 * a tool off platform-wide without a deploy.
 */

export const dynamic = 'force-dynamic';

const installCommandsSchema = z.object({
  sandbox: z.string().trim().min(1).max(2_000),
  macos: z.string().trim().max(2_000),
  linux: z.string().trim().max(2_000),
  windows: z.string().trim().max(2_000),
});

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and dashes.'),
  name: z.string().trim().min(1).max(80),
  vendor: z.string().trim().max(80).default(''),
  description: z.string().trim().max(500).default(''),
  license: z.string().trim().max(80).default(''),
  licenseKind: z.enum(['free', 'proprietary']).default('free'),
  licenseUrl: z.string().trim().url().max(500).nullable().optional(),
  docsUrl: z.string().trim().url().max(500).nullable().optional(),
  authKind: z.enum(['login', 'api_key', 'none']).default('none'),
  authNote: z.string().trim().max(300).default(''),
  apiKeyEnvVar: z.string().trim().max(80).nullable().optional(),
  apiKeyProviderKey: z.string().trim().max(40).nullable().optional(),
  binName: z.string().trim().min(1).max(80),
  versionArg: z.string().trim().max(40).default('--version'),
  installCommands: installCommandsSchema,
  launchCommand: z.string().trim().max(300).default(''),
  isEnabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});

export const GET = defineHandler({ auth: 'required', rateLimit: 'api.default' }, async () => {
  await requireApiPlatformAdmin();

  const rows = await db
    .select()
    .from(cliTools)
    .orderBy(asc(cliTools.sortOrder), asc(cliTools.name));

  return json({ tools: rows });
});

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: createSchema,
    audit: { action: AUDIT_ACTIONS.adminCliToolCreate, resourceType: 'cli_tool' },
  },
  async ({ body, user, setAudit }) => {
    await requireApiPlatformAdmin();

    const [row] = await db
      .insert(cliTools)
      .values({
        ...body,
        licenseUrl: body.licenseUrl ?? null,
        docsUrl: body.docsUrl ?? null,
        apiKeyEnvVar: body.apiKeyEnvVar ?? null,
        apiKeyProviderKey: body.apiKeyProviderKey ?? null,
        id: newId(ID_PREFIX.cliTool),
      })
      .returning();

    setAudit({
      resourceId: row!.id,
      summary: `Added CLI tool ${body.name} (${body.slug})`,
      metadata: { slug: body.slug, actorId: user.id },
    });

    return created({ tool: row });
  },
);
