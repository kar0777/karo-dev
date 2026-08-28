import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { eq } from 'drizzle-orm';

import { completeOnboarding } from '@/app/app/onboarding/actions';
import { OnboardingWizard } from '@/components/app/onboarding/onboarding-wizard';
import {
  loadModelOptions,
  loadPlanOptions,
  loadProjectTemplates,
  loadShellContext,
  loadWorkerOptions,
} from '@/components/app/shell-data';
import { ACTIVE_TEAM_COOKIE } from '@/components/app/team-switcher';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { plans } from '@/lib/db/schema';
import { can } from '@/lib/rbac/permissions';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const { user } = await requireUser();

  // Re-running setup after it is done would silently overwrite real settings.
  if (user.onboardingCompletedAt) redirect('/app');

  const cookieStore = await cookies();
  const active = await getActiveTeam(
    user.id,
    cookieStore.get(ACTIVE_TEAM_COOKIE)?.value ?? null,
  ).catch(() => getActiveTeam(user.id, null));

  const teamId = active.team.id;
  const context = await loadShellContext(user.id, teamId);

  const [planOptions, modelOptions, templates, workers, planRows] = await Promise.all([
    loadPlanOptions(),
    loadModelOptions(),
    loadProjectTemplates(),
    loadWorkerOptions(teamId),
    db
      .select({
        allowOwnServer: plans.allowOwnServer,
        allowExternalSandbox: plans.allowExternalSandbox,
      })
      .from(plans)
      .where(eq(plans.id, context.plan.id))
      .limit(1),
  ]);

  const planRow = planRows[0];
  const firstName = user.name.trim().split(/\s+/)[0] ?? '';

  return (
    <OnboardingWizard
      plans={planOptions}
      models={modelOptions}
      templates={templates}
      workers={workers}
      allowOwnServer={planRow?.allowOwnServer ?? true}
      allowExternalSandbox={planRow?.allowExternalSandbox ?? false}
      planName={context.plan.name}
      firstName={firstName}
      canCreateProject={can(active.role, 'project.create')}
      completeOnboarding={completeOnboarding}
    />
  );
}
