import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { CUSTOM_PROVIDER_KEY, toApiKeyView } from '@/lib/account/api-keys';
import { ForbiddenError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam } from '@/lib/auth/guards';
import { encryptSecret, fingerprint, last4 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { providers, userApiKeys } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { loadBillingContext } from '@/lib/usage/metering';
import { assertCan } from '@/lib/rbac/permissions';
import { assertSafeOutboundUrl } from '@/lib/ssrf';

/**
 * Bring-Your-Own-Key.
 *
 * The plaintext key is encrypted with AES-256-GCM before the insert and is
 * never read back into a response — `keyLast4` is the only fragment that ever
 * reaches a browser again. A duplicate is detected by HMAC fingerprint, so
 * "you already added this key" costs no plaintext comparison.
 */

const createSchema = z.object({
  label: z.string().trim().min(1, 'Give the key a name you will recognise').max(60),
  providerKey: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Pick a provider from the list'),
  baseUrl: z.string().trim().max(300).optional().or(z.literal('')),
  apiKey: z.string().trim().min(8, 'That key looks too short').max(400),
});

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ user }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'apikey.read');

    const [rows, catalogue, billing] = await Promise.all([
      db
        .select()
        .from(userApiKeys)
        .where(eq(userApiKeys.userId, user.id))
        .orderBy(desc(userApiKeys.createdAt)),
      db.select().from(providers),
      loadBillingContext(team.id),
    ]);

    const names = new Map(catalogue.map((row) => [row.key, row.name]));

    return json({
      keys: rows.map((row) => toApiKeyView(row, names.get(row.providerKey))),
      allowByok: billing.plan.allowByok,
      planName: billing.plan.name,
    });
  },
);

export const POST = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: createSchema,
    audit: { action: AUDIT_ACTIONS.apikeyCreate, resourceType: 'api_key' },
  },
  async ({ user, body, setAudit }) => {
    const { team, role } = await getActiveTeam(user.id);
    assertCan(role, 'apikey.manage');

    const billing = await loadBillingContext(team.id);
    if (!billing.plan.allowByok) {
      throw new ForbiddenError('Your plan does not include bring-your-own-key.', {
        title: 'BYOK is not on this plan',
        description: `The ${billing.plan.name} plan runs on Karo's provider credentials. Upgrade to add your own key and stop consuming included model credits.`,
      });
    }

    const trimmedBaseUrl = body.baseUrl?.trim() ?? '';
    const requiresBaseUrl = body.providerKey === CUSTOM_PROVIDER_KEY;

    if (requiresBaseUrl && !trimmedBaseUrl) {
      throw new ValidationError(
        'A custom endpoint needs its base URL.',
        [
          {
            path: 'baseUrl',
            message: 'Enter the full base URL, for example https://api.example.com/v1',
            code: 'base_url_required',
          },
        ],
        {
          title: 'Base URL is required',
          description:
            'Karo has no address to send requests to. Paste the OpenAI-compatible base URL your provider documents.',
        },
      );
    }

    // SSRF: a base URL is a server-side fetch target chosen by the user.
    const baseUrl = trimmedBaseUrl ? assertSafeOutboundUrl(trimmedBaseUrl).toString() : null;

    if (!requiresBaseUrl) {
      const known = await db
        .select({ key: providers.key })
        .from(providers)
        .where(eq(providers.key, body.providerKey))
        .limit(1);

      if (known.length === 0) {
        throw new ValidationError(
          'That provider is not in the catalogue.',
          [{ path: 'providerKey', message: 'Unknown provider', code: 'unknown_provider' }],
          {
            title: 'Unknown provider',
            description:
              'Reload the page to pick from the current provider list, or choose “OpenAI-compatible endpoint” and supply a base URL.',
          },
        );
      }
    }

    const id = newId(ID_PREFIX.userApiKey);

    const inserted = await db
      .insert(userApiKeys)
      .values({
        id,
        userId: user.id,
        teamId: team.id,
        label: body.label,
        providerKey: body.providerKey,
        baseUrl,
        keyCiphertext: encryptSecret(body.apiKey),
        keyLast4: last4(body.apiKey),
        keyFingerprint: fingerprint(body.apiKey),
      })
      .returning();

    const row = inserted[0];
    if (!row) throw new Error('API key insert returned no row');

    setAudit({
      teamId: team.id,
      resourceId: row.id,
      severity: 'notice',
      summary: `API key "${row.label}" added`,
      metadata: { providerKey: row.providerKey, keyLast4: row.keyLast4 },
    });

    return created({ key: toApiKeyView(row) });
  },
);
