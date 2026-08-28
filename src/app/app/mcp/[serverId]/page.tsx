export const dynamic = 'force-dynamic';

import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { McpServerDetail } from '@/components/extensions/mcp-server-detail';
import { PageHeader } from '@/components/ui/page-header';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { mcpServers, mcpTools, projects } from '@/lib/db/schema';
import { toMcpServerView, toMcpToolView } from '@/lib/extensions/mcp-view';
import { loadProjectOptions } from '@/lib/extensions/service';
import type { McpServerDetailView } from '@/lib/extensions/types';
import { can } from '@/lib/rbac/permissions';

export default async function McpServerPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  const [row] = await db
    .select({ server: mcpServers, projectName: projects.name })
    .from(mcpServers)
    .leftJoin(projects, eq(projects.id, mcpServers.projectId))
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.teamId, team.id)))
    .limit(1);

  if (!row) notFound();

  const [tools, projectOptions] = await Promise.all([
    db
      .select()
      .from(mcpTools)
      .where(eq(mcpTools.serverId, row.server.id))
      .orderBy(asc(mcpTools.name)),
    loadProjectOptions(team.id),
  ]);

  const enabledCount = tools.filter((tool) => tool.isEnabled).length;

  const server: McpServerDetailView = {
    ...toMcpServerView(row.server, row.projectName, {
      total: tools.length,
      enabled: enabledCount,
    }),
    logs: row.server.logs ?? [],
    tools: tools.map(toMcpToolView),
  };

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={server.name}
        description={
          server.description ||
          'No description yet — add one so your team knows what this server is for.'
        }
        breadcrumbs={[
          { label: 'Karo', href: '/app' },
          { label: 'MCP servers', href: '/app/mcp' },
          { label: server.name },
        ]}
      />

      <McpServerDetail
        server={server}
        projects={projectOptions}
        canManage={can(role, 'mcp.manage')}
      />
    </div>
  );
}
