import { and, eq } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json, noContent } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { mcpServers, projects } from '@/lib/db/schema';
import { splitMcpConfiguration, toMcpServerView } from '@/lib/extensions/mcp-view';
import { mcpUpdateSchema } from '@/lib/extensions/schemas';
import { mergeSecrets, pathParam } from '@/lib/extensions/service';
import { disconnect } from '@/lib/mcp/manager';

/** `/api/mcp/[id]` — edit or remove one server. */

async function loadServer(userId: string, serverId: string) {
  const { team } = await getActiveTeam(userId);
  const [row] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.id, serverId), eq(mcpServers.teamId, team.id)))
    .limit(1);
  if (!row) {
    throw new NotFoundError('MCP server not found.', {
      title: 'Server not found',
      description:
        'This MCP server has been removed, or it belongs to a team you are not a member of.',
    });
  }
  return { team, server: row };
}

export const PATCH = defineHandler(
  {
    auth: 'required',
    body: mcpUpdateSchema,
    audit: { action: AUDIT_ACTIONS.mcpUpdate, resourceType: 'mcp_server' },
  },
  async ({ user, body, params, setAudit }) => {
    const serverId = pathParam(params, 'id');
    const { team, server } = await loadServer(user.id, serverId);
    await requireApiTeamPermission(team.id, 'mcp.manage');

    const transport = body.transport ?? server.transport;
    const patch: Partial<typeof mcpServers.$inferInsert> = { updatedAt: new Date() };

    if (body.name !== undefined && body.name !== server.name) {
      const [duplicate] = await db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(and(eq(mcpServers.teamId, team.id), eq(mcpServers.name, body.name)))
        .limit(1);
      if (duplicate && duplicate.id !== server.id) {
        throw new ConflictError(`You already have an MCP server called "${body.name}".`, {
          title: 'Name already used',
          description: 'MCP server names are unique inside a team. Pick a different name.',
        });
      }
      patch.name = body.name;
    }

    if (body.description !== undefined) patch.description = body.description;
    if (body.isEnabled !== undefined) patch.isEnabled = body.isEnabled;
    if (body.requireApproval !== undefined) patch.requireApproval = body.requireApproval;
    if (body.allowedTools !== undefined) patch.allowedTools = body.allowedTools;
    if (body.transport !== undefined) patch.transport = body.transport;

    if (body.scope !== undefined) {
      patch.scope = body.scope;
      if (body.scope === 'account') patch.projectId = null;
    }
    if (body.projectId !== undefined && (body.scope ?? server.scope) === 'project') {
      if (!body.projectId) throw new NotFoundError('Pick the project this server belongs to.');
      const [row] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.teamId, team.id)))
        .limit(1);
      if (!row) throw new NotFoundError('Project not found.');
      patch.projectId = row.id;
    }

    if (transport === 'stdio') {
      if (body.command !== undefined) patch.command = body.command;
      if (body.args !== undefined) patch.args = body.args;
      if (body.transport === 'stdio') patch.url = null;
    } else {
      if (body.url !== undefined) patch.url = body.url;
      if (body.transport && body.transport !== 'stdio') {
        patch.command = null;
        patch.args = [];
      }
    }

    // A supplied env/header array replaces the plaintext values wholesale and
    // *merges* into the secret bag: an entry with an empty value clears that
    // key, which is how the Replace action removes a stored credential.
    if (body.env !== undefined || body.headers !== undefined) {
      const split = splitMcpConfiguration({
        transport,
        env: body.env ?? [],
        headers: body.headers ?? [],
      });
      if (transport === 'stdio') patch.env = split.env;
      else patch.headers = split.headers;

      const secretPatch: Record<string, string> = {};
      if (transport === 'stdio') {
        for (const entry of body.env ?? []) {
          if (entry.secret) secretPatch[entry.key] = entry.value;
        }
      } else {
        for (const entry of body.headers ?? []) {
          if (entry.secret) secretPatch[`header:${entry.name}`] = entry.value;
        }
      }
      patch.secretsCiphertext = mergeSecrets(server.secretsCiphertext, secretPatch);
    }

    const [updated] = await db
      .update(mcpServers)
      .set(patch)
      .where(eq(mcpServers.id, server.id))
      .returning();

    if (!updated) throw new NotFoundError('MCP server not found.');

    // Configuration changed under a live connection — drop it so the next run
    // dials with the new command, URL or credentials rather than the old ones.
    await disconnect(server.id).catch(() => undefined);

    setAudit({
      teamId: team.id,
      resourceId: server.id,
      summary: `MCP server "${updated.name}" updated`,
      metadata: { fields: Object.keys(body) },
    });

    return json({ server: toMcpServerView(updated, null) });
  },
);

export const DELETE = defineHandler(
  {
    auth: 'required',
    audit: { action: AUDIT_ACTIONS.mcpDelete, resourceType: 'mcp_server', severity: 'notice' },
  },
  async ({ user, params, setAudit }) => {
    const serverId = pathParam(params, 'id');
    const { team, server } = await loadServer(user.id, serverId);
    await requireApiTeamPermission(team.id, 'mcp.manage');

    await disconnect(server.id).catch(() => undefined);
    await db.delete(mcpServers).where(eq(mcpServers.id, server.id));

    setAudit({
      teamId: team.id,
      resourceId: server.id,
      summary: `MCP server "${server.name}" removed`,
      metadata: { transport: server.transport, scope: server.scope },
    });

    return noContent();
  },
);
