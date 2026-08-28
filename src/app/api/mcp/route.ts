import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { mcpServers, mcpTools, projects } from '@/lib/db/schema';
import { splitMcpConfiguration, toMcpServerView } from '@/lib/extensions/mcp-view';
import { mcpCreateSchema } from '@/lib/extensions/schemas';
import { assertMcpServerQuota, loadTeamPlan } from '@/lib/extensions/service';
import type { McpServerView } from '@/lib/extensions/types';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * `/api/mcp` — the team's MCP server registry.
 *
 * Secret env values and secret headers never round-trip: the client sends them
 * once, they are encrypted into `secretsCiphertext`, and every read returns
 * only the *names* of the keys that hold a value.
 */

const listQuery = z.object({
  projectId: z.string().min(1).optional(),
});

export const GET = defineHandler(
  { auth: 'required', query: listQuery },
  async ({ user, query }) => {
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'mcp.read');

    const rows = await db
      .select({ server: mcpServers, projectName: projects.name })
      .from(mcpServers)
      .leftJoin(projects, eq(projects.id, mcpServers.projectId))
      .where(eq(mcpServers.teamId, team.id))
      .orderBy(asc(mcpServers.name));

    const counts = await db
      .select({
        serverId: mcpTools.serverId,
        total: sql<number>`count(*)::int`,
        enabled: sql<number>`count(*) filter (where ${mcpTools.isEnabled})::int`,
      })
      .from(mcpTools)
      .groupBy(mcpTools.serverId);

    const byServer = new Map(counts.map((c) => [c.serverId, c]));

    const servers: McpServerView[] = rows
      .filter((row) => !query?.projectId || row.server.projectId === query.projectId)
      .map((row) => toMcpServerView(row.server, row.projectName, byServer.get(row.server.id)));

    return json({ servers });
  },
);

export const POST = defineHandler(
  {
    auth: 'required',
    body: mcpCreateSchema,
    audit: { action: AUDIT_ACTIONS.mcpCreate, resourceType: 'mcp_server' },
  },
  async ({ user, body, setAudit }) => {
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'mcp.manage');

    const plan = await loadTeamPlan(team.id);
    await assertMcpServerQuota(team.id, plan);

    let projectId: string | null = null;
    if (body.scope === 'project') {
      if (!body.projectId) {
        throw new NotFoundError('Pick the project this server belongs to.', {
          title: 'No project selected',
          description:
            'A project-scoped MCP server needs a project. Choose one, or set the scope to the whole account.',
        });
      }
      const [row] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.teamId, team.id)))
        .limit(1);
      if (!row) throw new NotFoundError('Project not found.');
      projectId = row.id;
    }

    const [duplicate] = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(and(eq(mcpServers.teamId, team.id), eq(mcpServers.name, body.name)))
      .limit(1);
    if (duplicate) {
      throw new ConflictError(`You already have an MCP server called "${body.name}".`, {
        title: 'Name already used',
        description: 'MCP server names are unique inside a team. Pick a different name.',
      });
    }

    const { env, headers, secrets, secretKeys } = splitMcpConfiguration(body);

    const id = newId(ID_PREFIX.mcpServer);
    const [inserted] = await db
      .insert(mcpServers)
      .values({
        id,
        teamId: team.id,
        projectId,
        createdById: user.id,
        name: body.name,
        description: body.description,
        scope: body.scope,
        transport: body.transport,
        command: body.transport === 'stdio' ? body.command : null,
        args: body.transport === 'stdio' ? body.args : [],
        url: body.transport === 'stdio' ? null : body.url,
        headers,
        env,
        secretsCiphertext: secrets,
        isEnabled: body.isEnabled,
        allowedTools: body.allowedTools,
        requireApproval: body.requireApproval,
        templateKey: body.templateKey,
        logs: [
          {
            at: new Date().toISOString(),
            level: 'info',
            message: `Registered by ${user.name || user.email}. Not connected yet — run a connection test to discover its tools.`,
          },
        ],
      })
      .returning();

    if (!inserted) {
      throw new ConflictError('The server could not be saved. Try again.');
    }

    setAudit({
      teamId: team.id,
      resourceId: id,
      summary: `MCP server "${body.name}" added`,
      metadata: {
        transport: body.transport,
        scope: body.scope,
        templateKey: body.templateKey,
        secretKeys,
      },
    });

    return created({ server: toMcpServerView(inserted, null) });
  },
);
