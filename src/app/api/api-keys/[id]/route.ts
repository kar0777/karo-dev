import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { CUSTOM_PROVIDER_KEY, toApiKeyView } from '@/lib/account/api-keys';
import { pathParam } from '@/lib/account/route-params';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { encryptSecret, fingerprint, last4 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { userApiKeys } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';
import { assertSafeOutboundUrl } from '@/lib/ssrf';

/**
 * A single BYOK credential. `PATCH` covers rename, enable/disable and
 * *replace* — a rotated upstream key keeps its label, its history and the
 * projects that reference the provider rather than forcing a delete-and-re-add.
 */

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    baseUrl: z.string().trim().max(300).nullable().optional(),
    apiKey: z.string().trim().min(8, 'That key looks too short').max(400).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

async function loadOwnKey(userId: string, id: string) {
  const rows = await db
    .select()
    .from(userApiKeys)
    .where(and(eq(userApiKeys.id, id), eq(userApiKeys.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError('That API key does not exist.', {
      title: 'Key not found',
      description:
        'It was already deleted, or it belongs to another account. Reload the page to see your current keys.',
    });
  }
  return row;
}

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: patchSchema,
    audit: { action: AUDIT_ACTIONS.apikeyUpdate, resourceType: 'api_key' },
  },
  async ({ user, body, params, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'apikey.manage');

    const id = pathParam(params, 'id');
    const existing = await loadOwnKey(user.id, id);

    let baseUrl = existing.baseUrl;
    if (body.baseUrl !== undefined) {
      const trimmed = body.baseUrl?.trim() ?? '';
      if (!trimmed && existing.providerKey === CUSTOM_PROVIDER_KEY) {
        throw new ValidationError(
          'A custom endpoint needs its base URL.',
          [{ path: 'baseUrl', message: 'Enter the base URL', code: 'base_url_required' }],
          {
            title: 'Base URL is required',
            description:
              'This key points at an OpenAI-compatible endpoint, so Karo needs an address to call.',
          },
        );
      }
      baseUrl = trimmed ? assertSafeOutboundUrl(trimmed).toString() : null;
    }

    const replaced = body.apiKey !== undefined;

    const updated = await db
      .update(userApiKeys)
      .set({
        ...(body.label === undefined ? {} : { label: body.label }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        ...(body.baseUrl === undefined ? {} : { baseUrl }),
        ...(replaced && body.apiKey
          ? {
              keyCiphertext: encryptSecret(body.apiKey),
              keyLast4: last4(body.apiKey),
              keyFingerprint: fingerprint(body.apiKey),
              // A new secret has proved nothing yet.
              lastVerifiedAt: null,
              lastVerifyError: null,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(userApiKeys.id, id))
      .returning();

    const row = updated[0];
    if (!row) throw new NotFoundError('That API key does not exist.');

    setAudit({
      teamId: team.id,
      resourceId: row.id,
      severity: replaced ? 'notice' : 'info',
      summary: replaced ? `API key "${row.label}" replaced` : `API key "${row.label}" updated`,
      metadata: { replaced, fields: Object.keys(body) },
    });

    return json({ key: toApiKeyView(row) });
  },
);

export const DELETE = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.apikeyDelete, resourceType: 'api_key' },
  },
  async ({ user, params, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'apikey.manage');

    const id = pathParam(params, 'id');
    const existing = await loadOwnKey(user.id, id);

    await db.delete(userApiKeys).where(eq(userApiKeys.id, id));

    setAudit({
      teamId: team.id,
      resourceId: id,
      severity: 'notice',
      summary: `API key "${existing.label}" deleted`,
      metadata: { providerKey: existing.providerKey, keyLast4: existing.keyLast4 },
    });

    return json({ ok: true });
  },
);
