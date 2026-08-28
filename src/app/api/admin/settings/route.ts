import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { adminSettings } from '@/lib/db/schema';
import { setSetting } from '@/lib/settings';

/**
 * Platform setting writes.
 *
 * Two invariants live here rather than in the UI. The key must already exist in
 * `admin_settings`, so a typo cannot mint a row that nothing ever reads; and the
 * new value must be the same kind as the stored `valueType`, because
 * `getSetting` discards a value whose type does not match its fallback — a
 * string `"15"` where a number is expected would silently revert to the
 * compiled default instead of failing loudly.
 */

const bodySchema = z.object({
  key: z.string().trim().min(1).max(200),
  value: z.union([
    z.number().min(-1_000_000_000_000).max(1_000_000_000_000),
    z.string().max(2_000),
    z.boolean(),
  ]),
});

function describe(value: unknown): string {
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: {
      action: AUDIT_ACTIONS.adminSettingUpdate,
      resourceType: 'setting',
      severity: 'notice',
    },
  },
  async ({ body, setAudit }) => {
    const { user: actor } = await requireApiPlatformAdmin();

    const rows = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, body.key))
      .limit(1);

    const current = rows[0];
    if (!current) {
      throw new NotFoundError('That setting does not exist.', {
        title: 'Unknown setting',
        description:
          'Settings are created by the seed, not by this endpoint. Add the key to `src/lib/db/seed-data/admin-settings.ts` and re-run `npm run db:seed`.',
      });
    }

    if (current.valueType === 'json') {
      throw new ConflictError('This setting holds shipped content, not an operator value.', {
        title: 'Edited in the seed, not here',
        description:
          'The seed rewrites JSON payloads such as the MCP and project template catalogues on every run, so a change made here would not survive the next deploy.',
      });
    }

    if (typeof body.value !== current.valueType) {
      throw new ConflictError(
        `This setting stores a ${current.valueType}, and the value sent was a ${typeof body.value}.`,
        {
          title: 'Wrong value type',
          description:
            'Reload the page so the editor picks up the stored type. A value of the wrong kind is discarded on read and the compiled default is used instead.',
        },
      );
    }

    if (JSON.stringify(current.value) === JSON.stringify(body.value)) {
      // Nothing changed, so nothing is worth an audit entry.
      setAudit({ record: false });
      return json({ ok: true, key: current.key, value: current.value, summary: 'No change' });
    }

    await setSetting(current.key, body.value, actor.id);

    const summary = `Changed "${current.label || current.key}" from ${describe(
      current.value,
    )} to ${describe(body.value)}`;

    setAudit({
      resourceId: current.key,
      summary,
      metadata: {
        key: current.key,
        category: current.category,
        valueType: current.valueType,
        from: current.value,
        to: body.value,
      },
    });

    return json({ ok: true, key: current.key, value: body.value, summary });
  },
);
