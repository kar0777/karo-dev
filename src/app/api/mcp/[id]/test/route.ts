import { and, eq } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { mcpServers, mcpTools } from '@/lib/db/schema';
import { toMcpToolView } from '@/lib/extensions/mcp-view';
import { pathParam } from '@/lib/extensions/service';
import { healthCheck } from '@/lib/mcp/manager';

/**
 * `POST /api/mcp/[id]/test` — dial the server, list its tools, persist the
 * result. Never throws on a connection failure: a failed health check is a
 * *result*, not an API error, and the UI shows the message inline.
 */
export const POST = defineHandler(
  {
    auth: 'required',
    audit: { action: AUDIT_ACTIONS.mcpConnect, resourceType: 'mcp_server' },
  },
  async ({ user, params, setAudit }) => {
    const serverId = pathParam(params, 'id');
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'mcp.manage');

    const [server] = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.teamId, team.id)))
      .limit(1);
    if (!server) throw new NotFoundError('MCP server not found.');

    const result = await healthCheck(server);

    const tools = await db.select().from(mcpTools).where(eq(mcpTools.serverId, server.id));

    const [refreshed] = await db
      .select({
        status: mcpServers.status,
        statusMessage: mcpServers.statusMessage,
        logs: mcpServers.logs,
        lastConnectedAt: mcpServers.lastConnectedAt,
        lastHealthCheckAt: mcpServers.lastHealthCheckAt,
      })
      .from(mcpServers)
      .where(eq(mcpServers.id, server.id))
      .limit(1);

    setAudit({
      teamId: team.id,
      resourceId: server.id,
      severity: result.ok ? 'info' : 'warning',
      summary: result.ok
        ? `MCP server "${server.name}" connected`
        : `MCP server "${server.name}" failed to connect`,
      metadata: { ok: result.ok, latencyMs: result.latencyMs, toolCount: result.toolCount },
    });

    return json({
      result: {
        ok: result.ok,
        message: result.message,
        toolCount: result.toolCount,
        latencyMs: result.latencyMs,
      },
      status: refreshed?.status ?? server.status,
      statusMessage: refreshed?.statusMessage ?? server.statusMessage,
      lastConnectedAt: refreshed?.lastConnectedAt?.toISOString() ?? null,
      lastHealthCheckAt: refreshed?.lastHealthCheckAt?.toISOString() ?? null,
      logs: refreshed?.logs ?? [],
      tools: tools.map(toMcpToolView),
    });
  },
);
