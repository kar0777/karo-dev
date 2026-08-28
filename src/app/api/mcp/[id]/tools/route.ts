import { and, asc, eq } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { mcpServers, mcpTools } from '@/lib/db/schema';
import { toMcpToolView } from '@/lib/extensions/mcp-view';
import { mcpToolPatchSchema } from '@/lib/extensions/schemas';
import { pathParam } from '@/lib/extensions/service';

/** `/api/mcp/[id]/tools` — the tools discovered on one server. */

async function loadServer(
  userId: string,
  serverId: string,
  permission: 'mcp.read' | 'mcp.manage',
) {
  const { team } = await getActiveTeam(userId);
  await requireApiTeamPermission(team.id, permission);
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.teamId, team.id)))
    .limit(1);
  if (!server) throw new NotFoundError('MCP server not found.');
  return { team, server };
}

export const GET = defineHandler({ auth: 'required' }, async ({ user, params }) => {
  const serverId = pathParam(params, 'id');
  const { server } = await loadServer(user.id, serverId, 'mcp.read');

  const tools = await db
    .select()
    .from(mcpTools)
    .where(eq(mcpTools.serverId, server.id))
    .orderBy(asc(mcpTools.name));

  return json({ tools: tools.map(toMcpToolView), allowedTools: server.allowedTools ?? [] });
});

/**
 * Enabling and disabling a single discovered tool. The server's `allowedTools`
 * allow-list is kept in step: an empty list means "everything discovered", so
 * the first time a tool is switched off the list is materialised from the
 * tools that stay enabled.
 */
export const PATCH = defineHandler(
  {
    auth: 'required',
    body: mcpToolPatchSchema,
    audit: { action: AUDIT_ACTIONS.mcpUpdate, resourceType: 'mcp_server' },
  },
  async ({ user, body, params, setAudit }) => {
    const serverId = pathParam(params, 'id');
    const { team, server } = await loadServer(user.id, serverId, 'mcp.manage');

    const [tool] = await db
      .select()
      .from(mcpTools)
      .where(and(eq(mcpTools.id, body.toolId), eq(mcpTools.serverId, server.id)))
      .limit(1);
    if (!tool) throw new NotFoundError('That tool is not registered on this server.');

    await db
      .update(mcpTools)
      .set({ isEnabled: body.isEnabled })
      .where(eq(mcpTools.id, tool.id));

    const tools = await db
      .select()
      .from(mcpTools)
      .where(eq(mcpTools.serverId, server.id))
      .orderBy(asc(mcpTools.name));

    const enabledNames = tools.filter((t) => t.isEnabled).map((t) => t.name);
    const allowedTools = enabledNames.length === tools.length ? [] : enabledNames;

    await db
      .update(mcpServers)
      .set({ allowedTools, updatedAt: new Date() })
      .where(eq(mcpServers.id, server.id));

    setAudit({
      teamId: team.id,
      resourceId: server.id,
      summary: `Tool "${tool.name}" ${body.isEnabled ? 'enabled' : 'disabled'} on "${server.name}"`,
      metadata: { tool: tool.name, isEnabled: body.isEnabled },
    });

    return json({ tools: tools.map(toMcpToolView), allowedTools });
  },
);
