export const dynamic = 'force-dynamic';

import { Plus } from 'lucide-react';
import Link from 'next/link';

import { asc, eq, isNull, or } from 'drizzle-orm';

import { SkillImportButton } from '@/components/extensions/skill-import-dialog';
import { SkillsWorkspace } from '@/components/extensions/skills-workspace';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedSkills, projects, skills } from '@/lib/db/schema';
import { loadProjectOptions, loadTeamPlan } from '@/lib/extensions/service';
import { toInstalledSkillView, toSkillView } from '@/lib/extensions/skill-view';
import { can } from '@/lib/rbac/permissions';

export const metadata = {
  title: 'Skills',
  description: 'Install and author the instructions that shape how the agent works.',
};

export default async function SkillsPage() {
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);
  const canManage = can(role, 'skill.manage');

  const [catalogue, installations, projectOptions, plan] = await Promise.all([
    db
      .select()
      .from(skills)
      .where(or(isNull(skills.ownerTeamId), eq(skills.ownerTeamId, team.id)))
      .orderBy(asc(skills.name)),
    db
      .select({ installation: installedSkills, skill: skills, projectName: projects.name })
      .from(installedSkills)
      .innerJoin(skills, eq(skills.id, installedSkills.skillId))
      .leftJoin(projects, eq(projects.id, installedSkills.projectId))
      .where(eq(installedSkills.teamId, team.id))
      .orderBy(asc(skills.name)),
    loadProjectOptions(team.id),
    loadTeamPlan(team.id),
  ]);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Skills"
        description="A skill is a block of instructions folded into the agent's system prompt — how your team reviews code, writes migrations or ships a release. Install the ones you want, or write your own."
        breadcrumbs={[{ label: 'Karo', href: '/app' }, { label: 'Skills' }]}
        actions={
          canManage ? (
            <>
              <SkillImportButton />
              <Button asChild size="sm" iconLeft={<Plus />}>
                <Link href="/app/skills/new">Create skill</Link>
              </Button>
            </>
          ) : null
        }
      />

      <SkillsWorkspace
        skills={catalogue.map((row) => toSkillView(row, team.id))}
        installed={installations.map((row) =>
          toInstalledSkillView(row.installation, row.skill, row.projectName, team.id),
        )}
        projects={projectOptions}
        canManage={canManage}
        limits={{ maxSkills: plan.maxSkills, planName: plan.name }}
      />
    </div>
  );
}
