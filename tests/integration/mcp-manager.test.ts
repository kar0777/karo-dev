import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';

import { db, sql as pg } from '@/lib/db';
import { mcpServers, teams, teamMembers, users } from '@/lib/db/schema';
import { newId } from '@/lib/ids';
import { callTool, disconnect, loadToolsForProject } from '@/lib/mcp/manager';

/**
 * MCP manager integration tests.
 *
 * The manager is dialled against a real MCP server implementation — a tiny
 * stdio server in `helpers/echo-mcp-server.mjs` — because transport framing,
 * tool discovery and schema shapes are exactly the things a mock would lie
 * about. `node` is allow-listed for stdio only inside these tests; production
 * keeps the stricter default (`npx`/`uvx`).
 */

const ids = {
  user: newId('user'),
  team: newId('team'),
  server: newId('mcpServer'),
};

const serverPath = fileURLToPath(new URL('./helpers/echo-mcp-server.mjs', import.meta.url));

let reachable = false;

beforeAll(async () => {
  try {
    await pg`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  process.env.MCP_STDIO_ALLOWED_COMMANDS = 'node';

  await db.insert(users).values({
    id: ids.user,
    email: `mcp-${ids.user}@karo.test`,
    name: 'MCP Fixture',
    emailVerifiedAt: new Date(),
  });
  await db.insert(teams).values({
    id: ids.team,
    name: 'MCP Fixture Team',
    slug: `mcp-${ids.team.slice(-8)}`,
    ownerId: ids.user,
  });
  await db
    .insert(teamMembers)
    .values({ id: newId('teamMember'), teamId: ids.team, userId: ids.user, role: 'owner' });
  await db.insert(mcpServers).values({
    id: ids.server,
    teamId: ids.team,
    createdById: ids.user,
    name: 'Echo Server',
    transport: 'stdio',
    command: 'node',
    args: [serverPath],
    isEnabled: true,
    requireApproval: true,
    scope: 'account',
  });
});

afterAll(async () => {
  if (!reachable) return;
  await disconnect(ids.server).catch(() => {});
  // Servers restrict on their creator and teams restrict on their owner, so
  // both go before the user; members and tools cascade from the team.
  await db.delete(mcpServers).where(eq(mcpServers.id, ids.server));
  await db.delete(teams).where(eq(teams.id, ids.team));
  await db.delete(users).where(eq(users.id, ids.user));
  await pg.end();
});

describe('mcp manager against a real MCP server', () => {
  it('is connected — otherwise these assertions prove nothing', () => {
    expect(reachable).toBe(true);
  });

  it('discovers a real stdio server and namespaces its tools', async () => {
    if (!reachable) return;
    const { definitions, routes } = await loadToolsForProject(ids.team, 'prj_none');

    const echo = definitions.find((d) => d.name === 'mcp__echo_server__echo');
    expect(echo).toBeTruthy();
    expect(echo?.description).toContain('Echoes');

    // Destructive tools keep their approval route; read-only ones do not.
    expect(routes.get('mcp__echo_server__echo')?.requiresApproval).toBe(false);
    expect(routes.get('mcp__echo_server__delete_everything')?.requiresApproval).toBe(true);
  });

  it('executes a tool call end to end through the connection pool', async () => {
    if (!reachable) return;
    const result = await callTool(ids.server, 'echo', { text: 'hello' });

    expect(result.isError).toBe(false);
    expect(result.output).toBe('echo: hello');
  });

  it('answers calls for an unconnected server with an honest error', async () => {
    if (!reachable) return;
    const result = await callTool('mcp_missing', 'echo', { text: 'hi' });

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/not connected/i);
  });
});
