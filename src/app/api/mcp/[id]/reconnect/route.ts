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
import { disconnect, healthCheck } from '@/lib/mcp/manager';

/**
 * `POST /api/mcp/[id]/reconnect` — tears the pooled connection down and dials
 * again. Use this after changing a credential, or when a long-lived stdio
 * process has wedged; `test` alone would reuse the existing connection.
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

    await disconnect(server.id).catch(() => undefined);
    const result = await healthCheck(server);

    const [refreshed] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, server.id))
      .limit(1);
    const tools = await db.select().from(mcpTools).where(eq(mcpTools.serverId, server.id));

    setAudit({
      teamId: team.id,
      resourceId: server.id,
      severity: result.ok ? 'info' : 'warning',
      summary: `MCP server "${server.name}" reconnected`,
      metadata: { ok: result.ok, latencyMs: result.latencyMs },
    });

    return json({
      result,
      status: refreshed?.status ?? 'disconnected',
      statusMessage: refreshed?.statusMessage ?? null,
      lastConnectedAt: refreshed?.lastConnectedAt?.toISOString() ?? null,
      lastHealthCheckAt: refreshed?.lastHealthCheckAt?.toISOString() ?? null,
      logs: refreshed?.logs ?? [],
      tools: tools.map(toMcpToolView),
    });
  },
);
