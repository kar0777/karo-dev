import { eq } from 'drizzle-orm';

import { publicUser } from '@/app/api/auth/_shared';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { plans, subscriptions, type PlanTier } from '@/lib/db/schema';
import { publicConfig } from '@/lib/env';

/**
 * GET /api/auth/session — who am I, and what may I do?
 *
 * The app shell already has all of this from its server render; this endpoint
 * exists for the client-side cases that server render cannot cover — a long-open
 * tab checking whether its session survived, and a form recovering the CSRF
 * token after one was rotated.
 *
 * Signed out is a 401 with the standard envelope, which is what `apiFetch`
 * expects and what makes "your session expired, sign in again" a rendered state
 * rather than a guess.
 */

type PlanSummary = {
  planKey: string;
  planName: string;
  planTier: PlanTier;
};

/**
 * A team without a subscription is a real state — it happens on a database that
 * has not been seeded with a plan catalogue yet — and it must not 500 the
 * endpoint the whole client depends on.
 */
const NO_PLAN: PlanSummary = {
  planKey: 'none',
  planName: 'No plan',
  planTier: 'payg',
};

async function planSummary(teamId: string): Promise<PlanSummary> {
  const rows = await db
    .select({ key: plans.key, name: plans.name, tier: plans.tier })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.teamId, teamId))
    .limit(1);

  const row = rows[0];
  if (!row) return NO_PLAN;

  return { planKey: row.key, planName: row.name, planTier: row.tier };
}

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ user, session }) => {
    const { team, role } = await getActiveTeam(user.id);
    const plan = await planSummary(team.id);

    return json(
      {
        user: publicUser(user),
        team: {
          id: team.id,
          name: team.name,
          slug: team.slug,
          isPersonal: team.isPersonal,
          ...plan,
        },
        role,
        csrfToken: session.csrfToken,
        demoMode: publicConfig().demoMode,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  },
);
