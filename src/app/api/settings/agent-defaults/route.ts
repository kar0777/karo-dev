import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  AGENT_PERMISSION_KEYS,
  mergePreferences,
  readPreferences,
} from '@/lib/account/preferences';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { models, users } from '@/lib/db/schema';

/**
 * Personal agent defaults: what a newly created project and a fresh
 * conversation start with. Project-level settings still override these — this
 * is the starting point, not a ceiling.
 */

const permissionSchema = z.record(z.string(), z.boolean());

const bodySchema = z
  .object({
    modelId: z.string().min(1).max(64).nullable().optional(),
    agentMode: z.enum(['ask', 'plan', 'build', 'auto']).optional(),
    shell: z.enum(['bash', 'sh', 'powershell', 'cmd']).optional(),
    permissions: permissionSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: { action: 'user.agent_defaults_update', resourceType: 'user' },
  },
  async ({ user, body, setAudit }) => {
    if (body.modelId) {
      const found = await db
        .select({ id: models.id })
        .from(models)
        .where(eq(models.id, body.modelId))
        .limit(1);
      if (found.length === 0) {
        throw new ValidationError(
          'That model is no longer in the catalogue.',
          [{ path: 'modelId', message: 'Unknown model', code: 'unknown_model' }],
          {
            title: 'Model not available',
            description:
              'The catalogue changed since this page loaded. Reload and pick a model from the current list.',
          },
        );
      }
    }

    // Unknown keys are dropped rather than rejected: a client from an older
    // deploy should not fail to save the toggles it does know about.
    const permissions: Record<string, boolean> = {};
    if (body.permissions) {
      for (const key of AGENT_PERMISSION_KEYS) {
        const value = body.permissions[key];
        if (typeof value === 'boolean') permissions[key] = value;
      }
    }

    const onboardingState = mergePreferences(user.onboardingState, {
      agentDefaults: {
        ...(body.modelId === undefined ? {} : { modelId: body.modelId }),
        ...(body.agentMode === undefined ? {} : { agentMode: body.agentMode }),
        ...(body.shell === undefined ? {} : { shell: body.shell }),
        ...(body.permissions === undefined ? {} : { permissions }),
      },
    });

    const updated = await db
      .update(users)
      .set({ onboardingState, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();

    const row = updated[0];
    if (!row) throw new NotFoundError('Account not found.');

    const preferences = readPreferences(row.onboardingState);

    setAudit({
      resourceId: user.id,
      summary: 'Agent defaults updated',
      metadata: { fields: Object.keys(body) },
    });

    return json({ agentDefaults: preferences.agentDefaults });
  },
);
