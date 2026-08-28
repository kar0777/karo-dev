'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { requireProjectAccess, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { projects, users } from '@/lib/db/schema';
import { AGENT_PERMISSION_META, DEFAULT_AGENT_PERMISSIONS } from '@/lib/agent/policy';
import { createLogger } from '@/lib/logger';
import { rateLimitPolicy } from '@/lib/rate-limit';

/**
 * Finishing setup.
 *
 * This is a Server Action rather than a route handler because marking *your
 * own* onboarding complete is not part of the public API contract — no other
 * slice consumes it, and inventing an endpoint for it would be one more
 * surface to authenticate. The action still follows the same order as every
 * mutation in Karo: authenticate → authorize → validate → rate-limit → act →
 * audit.
 */

const log = createLogger('onboarding');

const PERMISSION_KEYS = Object.keys(AGENT_PERMISSION_META);

const inputSchema = z.object({
  usage: z.enum(['personal', 'team', 'evaluating']).nullable(),
  planKey: z.string().max(64).nullable(),
  modelId: z.string().max(64).nullable(),
  runtimeTarget: z.enum(['karo_cloud', 'own_server', 'external_sandbox']),
  template: z.string().max(64),
  permissions: z.record(z.string(), z.boolean()),
  projectId: z.string().max(64).nullable(),
  skipped: z.boolean(),
});

export type CompleteOnboardingResult = { ok: true } | { ok: false; error: string };

export async function completeOnboarding(raw: unknown): Promise<CompleteOnboardingResult> {
  const { user } = await requireUser();

  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Some of your answers could not be read. Reload the page and try again.',
    };
  }
  const input = parsed.data;

  const limit = await rateLimitPolicy('api.default', `onboarding:${user.id}`);
  if (!limit.allowed) {
    return {
      ok: false,
      error: `Too many attempts. Wait ${limit.retryAfterSeconds}s and try again.`,
    };
  }

  // Drop anything that is not a known permission key rather than trusting the
  // client's object shape into a jsonb column.
  const permissions: Record<string, boolean> = { ...DEFAULT_AGENT_PERMISSIONS };
  for (const key of PERMISSION_KEYS) {
    const value = input.permissions[key];
    if (typeof value === 'boolean') permissions[key] = value;
  }

  try {
    await db
      .update(users)
      .set({
        onboardingCompletedAt: new Date(),
        onboardingState: {
          usage: input.usage,
          planKey: input.planKey,
          modelId: input.modelId,
          runtimeTarget: input.runtimeTarget,
          template: input.template,
          permissions,
          skipped: input.skipped,
          completedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  } catch (error) {
    log.error('Could not mark onboarding complete', { userId: user.id, error: String(error) });
    return {
      ok: false,
      error: 'The database rejected the update. Nothing else was changed.',
    };
  }

  // Applying the permission matrix needs project-level authorisation, and the
  // guard is what proves the id the client sent belongs to this user's team.
  let teamId: string | null = null;
  if (input.projectId) {
    try {
      const access = await requireProjectAccess(input.projectId, 'project.update');
      teamId = access.team.id;
      await db
        .update(projects)
        .set({ permissions, updatedAt: new Date() })
        .where(eq(projects.id, access.project.id));
    } catch (error) {
      log.warn('Could not apply onboarding permissions to the new project', {
        projectId: input.projectId,
        error: String(error),
      });
      await recordAudit({
        action: AUDIT_ACTIONS.projectUpdate,
        userId: user.id,
        resourceType: 'project',
        resourceId: input.projectId,
        severity: 'warning',
        summary: 'Onboarding could not apply agent permissions to the new project',
      });
    }
  }

  await recordAudit({
    action: 'onboarding.complete',
    userId: user.id,
    teamId,
    resourceType: 'user',
    resourceId: user.id,
    summary: input.skipped ? 'Onboarding skipped' : 'Onboarding completed',
    metadata: {
      usage: input.usage,
      planKey: input.planKey,
      runtimeTarget: input.runtimeTarget,
      template: input.template,
      projectId: input.projectId,
    },
  });

  return { ok: true };
}
