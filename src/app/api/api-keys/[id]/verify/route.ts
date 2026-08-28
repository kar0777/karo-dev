import { and, eq } from 'drizzle-orm';

import { toApiKeyView } from '@/lib/account/api-keys';
import { pathParam } from '@/lib/account/route-params';
import { getProviderByKey } from '@/lib/ai';
import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { tryDecryptSecret } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { userApiKeys } from '@/lib/db/schema';
import { assertCan } from '@/lib/rbac/permissions';

/**
 * "Test connection".
 *
 * Decrypts the stored key in memory, asks the provider adapter to verify it,
 * and writes only the *outcome* back. The plaintext never leaves this function
 * and never appears in the response, the audit entry or a log line.
 */
export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    audit: { action: AUDIT_ACTIONS.apikeyUpdate, resourceType: 'api_key' },
  },
  async ({ user, params, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'apikey.manage');

    const id = pathParam(params, 'id');

    const rows = await db
      .select()
      .from(userApiKeys)
      .where(and(eq(userApiKeys.id, id), eq(userApiKeys.userId, user.id)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new NotFoundError('That API key does not exist.', {
        title: 'Key not found',
        description: 'It was deleted, or it belongs to another account. Reload the page.',
      });
    }

    const plaintext = tryDecryptSecret(row.keyCiphertext);

    // A key encrypted under a rotated ENCRYPTION_KEY is unrecoverable; say so
    // instead of reporting a provider failure that never happened.
    if (!plaintext) {
      const updated = await db
        .update(userApiKeys)
        .set({
          lastVerifyError:
            'Karo could not decrypt this key. Its encryption key changed — replace the key to fix it.',
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(userApiKeys.id, id))
        .returning();

      setAudit({
        teamId: team.id,
        resourceId: id,
        severity: 'warning',
        summary: `API key "${row.label}" could not be decrypted`,
      });

      return json({
        ok: false,
        detail:
          'Karo could not decrypt this key. The server encryption key changed since it was saved — use Replace to enter it again.',
        key: toApiKeyView(updated[0] ?? row),
      });
    }

    const provider = getProviderByKey(row.providerKey);
    const result = await provider.verifyCredentials(plaintext, row.baseUrl ?? undefined);

    const updated = await db
      .update(userApiKeys)
      .set({
        lastVerifiedAt: result.ok ? new Date() : row.lastVerifiedAt,
        lastVerifyError: result.ok ? null : result.detail.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(userApiKeys.id, id))
      .returning();

    setAudit({
      teamId: team.id,
      resourceId: id,
      severity: result.ok ? 'info' : 'warning',
      summary: result.ok
        ? `API key "${row.label}" verified`
        : `API key "${row.label}" failed verification`,
      metadata: { providerKey: row.providerKey, ok: result.ok },
    });

    return json({
      ok: result.ok,
      detail: result.detail,
      key: toApiKeyView(updated[0] ?? row),
    });
  },
);
