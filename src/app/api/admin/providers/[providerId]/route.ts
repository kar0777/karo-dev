import { eq, ne } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { getProviderByKey } from '@/lib/ai';
import { db } from '@/lib/db';
import { providers } from '@/lib/db/schema';
import { assertSafeOutboundUrl } from '@/lib/ssrf';

/**
 * Provider configuration and connectivity checks.
 *
 * The credential itself lives in the environment, never in this table and never
 * in a response body — an operator can see *that* a key is configured, not what
 * it is. Base URLs are pushed through the SSRF guard because an admin typo (or
 * a compromised admin session) must not be able to point the platform's model
 * traffic at an internal address.
 */

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  baseUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value === '' ? null : (value ?? null)))
    .nullable(),
  catalogUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value === '' ? null : (value ?? null)))
    .nullable(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  computeMultiplier: z.number().min(0.01).max(100).optional(),
});

const actionSchema = z.object({ action: z.literal('test') });

function paramProviderId(params: Record<string, string | string[] | undefined>): string {
  const value = params.providerId;
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new ValidationError('A provider id is required.');
  return id;
}

async function loadProvider(id: string) {
  const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
  const provider = rows[0];
  if (!provider) throw new NotFoundError('That provider does not exist.');
  return provider;
}

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: { action: 'admin.provider_update', resourceType: 'provider', severity: 'notice' },
  },
  async ({ body, params, setAudit }) => {
    await requireApiPlatformAdmin();
    const providerId = paramProviderId(params);
    const current = await loadProvider(providerId);

    for (const url of [body.baseUrl, body.catalogUrl]) {
      if (!url) continue;
      try {
        assertSafeOutboundUrl(url);
      } catch (error) {
        throw new ValidationError(
          error instanceof Error ? error.message : 'That URL is not allowed.',
          [
            {
              path: 'baseUrl',
              message: 'Blocked by the outbound request policy.',
              code: 'ssrf',
            },
          ],
          {
            title: 'That address is not reachable',
            description:
              'Provider URLs must be public HTTPS endpoints. Private, loopback and link-local addresses are rejected.',
          },
        );
      }
    }

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, next] of Object.entries(body)) {
      const previous = (current as Record<string, unknown>)[key];
      if (JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null)) {
        changed[key] = { from: previous ?? null, to: next ?? null };
      }
    }

    if (Object.keys(changed).length === 0) {
      setAudit({ record: false });
      return json({ provider: current, changed: {} });
    }

    const [updated] = await db
      .update(providers)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(providers.id, providerId))
      .returning();

    // Exactly one provider is the default; promoting one demotes the others.
    if (body.isDefault === true) {
      await db
        .update(providers)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(ne(providers.id, providerId));
    }

    setAudit({
      resourceId: providerId,
      summary: `Updated provider "${current.name}": ${Object.keys(changed).join(', ')}`,
      metadata: { changed },
    });

    return json({ provider: updated, changed });
  },
);

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: actionSchema,
    audit: { action: 'admin.provider_test', resourceType: 'provider' },
  },
  async ({ params, setAudit }) => {
    await requireApiPlatformAdmin();
    const providerId = paramProviderId(params);
    const provider = await loadProvider(providerId);
    const adapter = getProviderByKey(provider.key);
    const now = new Date();

    if (!adapter.isConfigured()) {
      await db
        .update(providers)
        .set({
          healthStatus: 'disconnected',
          lastSyncError: 'No credential is configured for this provider.',
          updatedAt: now,
        })
        .where(eq(providers.id, providerId));

      setAudit({
        resourceId: providerId,
        summary: `Connection test for "${provider.name}": no credential`,
        severity: 'warning',
      });

      return json({
        ok: false,
        status: 'disconnected',
        detail:
          'No API key is configured for this provider. Set its environment variable and restart the server — keys are never stored in the database.',
      });
    }

    try {
      const catalogue = await adapter.listModels();
      const detail =
        catalogue === null
          ? 'Connected. This provider does not expose a model catalogue, so sync is unavailable.'
          : `Connected. The key can reach ${catalogue.length} model${catalogue.length === 1 ? '' : 's'}.`;

      await db
        .update(providers)
        .set({ healthStatus: 'connected', lastSyncError: null, updatedAt: now })
        .where(eq(providers.id, providerId));

      setAudit({
        resourceId: providerId,
        summary: `Connection test for "${provider.name}": connected`,
        metadata: { modelCount: catalogue?.length ?? null },
      });

      return json({
        ok: true,
        status: 'connected',
        detail,
        modelCount: catalogue?.length ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await db
        .update(providers)
        .set({ healthStatus: 'error', lastSyncError: message, updatedAt: now })
        .where(eq(providers.id, providerId));

      setAudit({
        resourceId: providerId,
        summary: `Connection test for "${provider.name}" failed`,
        severity: 'warning',
        metadata: { message },
      });

      return json({
        ok: false,
        status: 'error',
        detail: `${message} Check the base URL and that the key is still valid upstream.`,
      });
    }
  },
);
