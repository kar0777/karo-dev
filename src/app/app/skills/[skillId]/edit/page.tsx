export const dynamic = 'force-dynamic';

import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { SkillEditor } from '@/components/extensions/skill-editor';
import { PageHeader } from '@/components/ui/page-header';
import { BUILTIN_TOOL_DEFINITIONS } from '@/lib/agent/tools';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { plugins, skills } from '@/lib/db/schema';
import { toSkillView } from '@/lib/extensions/skill-view';
import { can } from '@/lib/rbac/permissions';

export default async function EditSkillPage({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const { skillId } = await params;
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  if (!can(role, 'skill.manage')) notFound();

  // Only a skill this team authored is editable — official rows are read-only,
  // and a 404 keeps the two cases indistinguishable from the outside.
  const [skill] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.ownerTeamId, team.id)))
    .limit(1);

  if (!skill) notFound();

  const catalogue = await db
    .select({ key: plugins.key, name: plugins.name })
    .from(plugins)
    .where(eq(plugins.isActive, true))
    .orderBy(asc(plugins.name));

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={`Edit ${skill.name}`}
        description="Changes apply to every installation on the next agent run — nothing is re-installed."
        breadcrumbs={[
          { label: 'Karo', href: '/app' },
          { label: 'Skills', href: '/app/skills' },
          { label: skill.name },
        ]}
      />

      <SkillEditor
        skill={toSkillView(skill, team.id)}
        tools={BUILTIN_TOOL_DEFINITIONS.map((tool) => ({
          name: tool.name,
          description: tool.description,
        }))}
        plugins={catalogue}
      />
    </div>
  );
}
