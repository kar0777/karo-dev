export const dynamic = 'force-dynamic';

import { eq, sql, asc } from 'drizzle-orm';

import { McpServerList } from '@/components/extensions/mcp-server-list';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser, getActiveTeam } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { mcpServers, mcpTools, projects } from '@/lib/db/schema';
import { MCP_TEMPLATES_SETTING_KEY } from '@/lib/db/seed-data/admin-settings';
import { MCP_TEMPLATE_SEEDS } from '@/lib/db/seed-data/mcp-templates';
import { toMcpServerView } from '@/lib/extensions/mcp-view';
import { loadProjectOptions, loadTeamPlan } from '@/lib/extensions/service';
import type { McpTemplateView } from '@/lib/extensions/types';
import { can } from '@/lib/rbac/permissions';
import { getSetting } from '@/lib/settings';

export const metadata = {
  title: 'MCP servers',
  description: 'Connect Model Context Protocol servers so the agent has more tools.',
};

export default async function McpPage() {
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  const [rows, counts, projectOptions, plan, templates] = await Promise.all([
    db
      .select({ server: mcpServers, projectName: projects.name })
      .from(mcpServers)
      .leftJoin(projects, eq(projects.id, mcpServers.projectId))
      .where(eq(mcpServers.teamId, team.id))
      .orderBy(asc(mcpServers.name)),
    db
      .select({
        serverId: mcpTools.serverId,
        total: sql<number>`count(*)::int`,
        enabled: sql<number>`count(*) filter (where ${mcpTools.isEnabled})::int`,
      })
      .from(mcpTools)
      .groupBy(mcpTools.serverId),
    loadProjectOptions(team.id),
    loadTeamPlan(team.id),
    getSetting<readonly McpTemplateView[]>(
      MCP_TEMPLATES_SETTING_KEY,
      MCP_TEMPLATE_SEEDS as readonly McpTemplateView[],
    ),
  ]);

  const byServer = new Map(counts.map((entry) => [entry.serverId, entry]));
  const servers = rows.map((row) =>
    toMcpServerView(row.server, row.projectName, byServer.get(row.server.id)),
  );

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="MCP servers"
        description="Model Context Protocol servers extend the agent with tools Karo does not ship: your database, your repository, your internal API. Each one is dialled only when a run needs it."
        breadcrumbs={[{ label: 'Karo', href: '/app' }, { label: 'MCP servers' }]}
      />

      <McpServerList
        servers={servers}
        templates={templates}
        projects={projectOptions}
        canManage={can(role, 'mcp.manage')}
        limits={{ maxMcpServers: plan.maxMcpServers, planName: plan.name }}
      />
    </div>
  );
}
