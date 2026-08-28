export const dynamic = 'force-dynamic';

import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { SkillEditor } from '@/components/extensions/skill-editor';
import { PageHeader } from '@/components/ui/page-header';
import { BUILTIN_TOOL_DEFINITIONS } from '@/lib/agent/tools';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { plugins } from '@/lib/db/schema';
import { can } from '@/lib/rbac/permissions';

export const metadata = {
  title: 'Create a skill',
  description: 'Write the instructions the agent follows for a particular kind of work.',
};

export default async function NewSkillPage() {
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  // Authoring is a privileged action; hiding the page is the honest response
  // for a role that could never save what it wrote.
  if (!can(role, 'skill.manage')) notFound();

  const catalogue = await db
    .select({ key: plugins.key, name: plugins.name })
    .from(plugins)
    .where(eq(plugins.isActive, true))
    .orderBy(asc(plugins.name));

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Create a skill"
        description={`Skills authored here belong to ${team.name} and are never shown to other teams.`}
        breadcrumbs={[
          { label: 'Karo', href: '/app' },
          { label: 'Skills', href: '/app/skills' },
          { label: 'Create' },
        ]}
      />

      <SkillEditor
        tools={BUILTIN_TOOL_DEFINITIONS.map((tool) => ({
          name: tool.name,
          description: tool.description,
        }))}
        plugins={catalogue}
      />
    </div>
  );
}
