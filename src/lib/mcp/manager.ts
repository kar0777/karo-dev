import 'server-only';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { and, eq } from 'drizzle-orm';

import { decryptJson } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { mcpServers, mcpTools, type McpServer } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { assertSafeOutboundTarget } from '@/lib/ssrf';
import type { ToolDefinition } from '@/lib/ai/types';

const log = createLogger('mcp');

/**
 * MCP connection manager.
 *
 * Connections are pooled per server row and reused across requests. Karo keeps
 * them lazy: a server is only dialled when a run actually needs its tools, or
 * when the user explicitly asks for a health check — so a broken MCP server in
 * settings never slows down the rest of the product.
 *
 * Three transports are supported, matching the MCP specification:
 *   · **stdio** — a local process on the control plane. The launcher is
 *     restricted to an allow-list (`npx`/`uvx` by default, see
 *     `allowedStdioCommands`), because `command` and `args` do arrive from user
 *     input. Set `MCP_STDIO_ALLOWED_COMMANDS=` to disable this transport.
 *   · **streamable HTTP** — the current remote transport.
 *   · **SSE** — the legacy remote transport, kept for older servers.
 *
 * Remote URLs pass through the SSRF guard, so an MCP entry cannot be used to
 * reach the control plane's private network or a cloud metadata endpoint.
 */

type Connection = {
  client: Client;
  serverId: string;
  connectedAt: Date;
  tools: DiscoveredTool[];
};

export type DiscoveredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isDestructive: boolean;
};

const pool = new Map<string, Connection>();
const CONNECT_TIMEOUT_MS = 20_000;

export async function connect(server: McpServer): Promise<Connection> {
  const existing = pool.get(server.id);
  if (existing) return existing;

  // Karo consumes tools/resources/prompts but exposes none of the optional
  // client-side capabilities (roots, sampling, elicitation) to MCP servers —
  // a server must not be able to ask Karo's model to do work on its behalf.
  const client = new Client({ name: 'karo', version: '1.0.0' }, { capabilities: {} });

  const transport = await buildTransport(server);

  await withTimeout(
    client.connect(transport),
    CONNECT_TIMEOUT_MS,
    `Timed out connecting to ${server.name}.`,
  );

  const tools = await discoverTools(client);
  const connection: Connection = {
    client,
    serverId: server.id,
    connectedAt: new Date(),
    tools,
  };
  pool.set(server.id, connection);

  await persistStatus(server.id, 'connected', `Connected. ${tools.length} tools discovered.`);
  await persistTools(server.id, tools);

  return connection;
}

/**
 * Launchers a `stdio` MCP server is allowed to use.
 *
 * Every stdio template Karo ships runs through `npx` or `uvx`, which is exactly
 * the allow-list this module's header always claimed to enforce — but did not.
 * Without it, `command` and `args` came straight from a request body and were
 * spawned on the **control plane**, so any member holding `mcp.manage` (the
 * `developer` role, not just an owner) had remote code execution on the Karo
 * host by registering a server and hitting the "test connection" endpoint.
 *
 * Override with `MCP_STDIO_ALLOWED_COMMANDS` (comma-separated). Setting it to an
 * empty value disables stdio servers outright, which is the right choice for a
 * multi-tenant deployment — see the residual risk noted below.
 */
function allowedStdioCommands(): Set<string> {
  const raw = process.env.MCP_STDIO_ALLOWED_COMMANDS;
  if (raw === undefined) return new Set(['npx', 'uvx']);
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Flags that turn an allowed launcher back into an arbitrary code evaluator.
 * `npx --call "<js>"` runs the string directly, which would defeat the point of
 * allow-listing the binary at all.
 */
const STDIO_FORBIDDEN_ARGS = new Set(['-c', '--call', '-e', '--eval', '--node-arg']);

function assertAllowedStdioCommand(command: string, args: readonly string[]): void {
  const allowed = allowedStdioCommands();

  if (allowed.size === 0) {
    throw new Error(
      'stdio MCP servers are disabled on this deployment. Use a streamable HTTP or SSE server instead.',
    );
  }

  // A bare name only: a path lets the caller point at any binary on the host,
  // and `PATH` resolution is what makes the allow-list meaningful.
  if (/[\\/]/.test(command)) {
    throw new Error(
      `An stdio MCP command must be a bare executable name, not a path. Allowed: ${[...allowed].join(', ')}.`,
    );
  }

  if (!allowed.has(command.trim().toLowerCase())) {
    throw new Error(
      `"${command}" is not an allowed stdio MCP launcher. Allowed: ${[...allowed].join(', ')}. Set MCP_STDIO_ALLOWED_COMMANDS to change this.`,
    );
  }

  for (const arg of args) {
    if (STDIO_FORBIDDEN_ARGS.has(arg.trim().toLowerCase())) {
      throw new Error(`The argument "${arg}" is not allowed for an stdio MCP server.`);
    }
  }

  // Residual risk, stated plainly rather than papered over: `npx <package>` can
  // still fetch and execute any published package on the control plane. The
  // allow-list stops arbitrary binaries and inline evaluation, not a hostile
  // package. A deployment with untrusted tenants should set
  // MCP_STDIO_ALLOWED_COMMANDS to empty and offer remote MCP servers only.
}

async function buildTransport(server: McpServer) {
  const secrets = server.secretsCiphertext
    ? decryptJson<Record<string, string>>(server.secretsCiphertext)
    : {};
  const env = { ...(server.env ?? {}), ...secrets };

  if (server.transport === 'stdio') {
    if (!server.command) {
      throw new Error('This stdio MCP server has no command configured.');
    }
    assertAllowedStdioCommand(server.command, server.args ?? []);
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      // Only the explicitly configured variables are exposed — the control
      // plane's own environment is never inherited by an MCP subprocess.
      env: { PATH: process.env.PATH ?? '', ...env },
      stderr: 'pipe',
    });
  }

  if (!server.url) {
    throw new Error('This MCP server has no URL configured.');
  }
  await assertSafeOutboundTarget(server.url);

  const headers: Record<string, string> = { ...(server.headers ?? {}) };
  for (const [key, value] of Object.entries(secrets)) {
    if (key.toLowerCase().startsWith('header:')) {
      headers[key.slice(7)] = value;
    }
  }

  const url = new URL(server.url);
  return server.transport === 'sse'
    ? new SSEClientTransport(url, { requestInit: { headers } })
    : new StreamableHTTPClientTransport(url, { requestInit: { headers } });
}

async function discoverTools(client: Client): Promise<DiscoveredTool[]> {
  try {
    const response = await client.listTools();
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
      isDestructive: looksDestructive(tool.name, tool.description ?? ''),
    }));
  } catch (error) {
    log.warn('Tool discovery failed', { error: String(error) });
    return [];
  }
}

/** Conservative heuristic — anything that might mutate gets an approval gate. */
function looksDestructive(name: string, description: string): boolean {
  return /\b(delete|remove|drop|destroy|truncate|purge|write|update|create|send|publish|deploy|execute|run)\b/i.test(
    `${name} ${description}`,
  );
}

export async function disconnect(serverId: string): Promise<void> {
  const connection = pool.get(serverId);
  if (!connection) return;
  pool.delete(serverId);
  try {
    await connection.client.close();
  } catch {
    // Already closed.
  }
  await persistStatus(serverId, 'disconnected', 'Disconnected.');
}

export async function reconnect(server: McpServer): Promise<Connection> {
  await disconnect(server.id);
  return connect(server);
}

export type HealthResult = {
  ok: boolean;
  message: string;
  toolCount: number;
  latencyMs: number;
};

export async function healthCheck(server: McpServer): Promise<HealthResult> {
  const started = Date.now();
  try {
    const connection = await connect(server);
    const tools = await discoverTools(connection.client);
    connection.tools = tools;
    await persistTools(server.id, tools);
    await persistStatus(server.id, 'connected', `Healthy. ${tools.length} tools.`);
    return {
      ok: true,
      message: `Connected. ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'} available.`,
      toolCount: tools.length,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed.';
    await persistStatus(server.id, 'error', message);
    pool.delete(server.id);
    return { ok: false, message, toolCount: 0, latencyMs: Date.now() - started };
  }
}

/**
 * Loads every enabled MCP server in scope and returns tool definitions the
 * model can call, namespaced so two servers can both expose `search`.
 */
export async function loadToolsForProject(
  teamId: string,
  projectId: string,
): Promise<{
  definitions: ToolDefinition[];
  routes: Map<string, { serverId: string; toolName: string; requiresApproval: boolean }>;
}> {
  const servers = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.teamId, teamId), eq(mcpServers.isEnabled, true)));

  const definitions: ToolDefinition[] = [];
  const routes = new Map<
    string,
    { serverId: string; toolName: string; requiresApproval: boolean }
  >();

  for (const server of servers) {
    if (server.scope === 'project' && server.projectId !== projectId) continue;

    let tools: DiscoveredTool[];
    try {
      const connection = await connect(server);
      tools = connection.tools;
    } catch (error) {
      log.warn('Skipping unreachable MCP server', {
        server: server.name,
        error: String(error),
      });
      continue;
    }

    const allowed = server.allowedTools ?? [];
    for (const tool of tools) {
      if (allowed.length && !allowed.includes(tool.name)) continue;

      const namespaced = `mcp__${slug(server.name)}__${tool.name}`;
      definitions.push({
        name: namespaced,
        description: `[${server.name}] ${tool.description}`,
        parameters:
          Object.keys(tool.inputSchema).length > 0
            ? tool.inputSchema
            : { type: 'object', properties: {}, additionalProperties: true },
      });
      routes.set(namespaced, {
        serverId: server.id,
        toolName: tool.name,
        requiresApproval: server.requireApproval && tool.isDestructive,
      });
    }
  }

  return { definitions, routes };
}

export async function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ output: string; isError: boolean }> {
  const connection = pool.get(serverId);
  if (!connection) {
    return { output: 'This MCP server is not connected.', isError: true };
  }

  try {
    const result = await withTimeout(
      connection.client.callTool({ name: toolName, arguments: args }),
      60_000,
      `The MCP tool ${toolName} did not respond within 60 seconds.`,
    );

    await db
      .update(mcpTools)
      .set({
        callCount: (await currentCallCount(serverId, toolName)) + 1,
        lastCalledAt: new Date(),
      })
      .where(and(eq(mcpTools.serverId, serverId), eq(mcpTools.name, toolName)));

    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((part: unknown) => {
        if (typeof part === 'object' && part !== null && 'type' in part) {
          const typed = part as { type: string; text?: string };
          if (typed.type === 'text') return typed.text ?? '';
          return `[${typed.type} content]`;
        }
        return String(part);
      })
      .join('\n');

    return { output: text || '(no output)', isError: Boolean(result.isError) };
  } catch (error) {
    return {
      output: error instanceof Error ? error.message : 'The MCP tool call failed.',
      isError: true,
    };
  }
}

async function currentCallCount(serverId: string, toolName: string): Promise<number> {
  const [row] = await db
    .select({ callCount: mcpTools.callCount })
    .from(mcpTools)
    .where(and(eq(mcpTools.serverId, serverId), eq(mcpTools.name, toolName)))
    .limit(1);
  return row?.callCount ?? 0;
}

async function persistStatus(
  serverId: string,
  status: 'connected' | 'disconnected' | 'error' | 'connecting',
  message: string,
): Promise<void> {
  const [existing] = await db
    .select({ logs: mcpServers.logs })
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId))
    .limit(1);

  const logs = [
    ...(existing?.logs ?? []).slice(-49),
    {
      at: new Date().toISOString(),
      level: status === 'error' ? 'error' : 'info',
      message,
    },
  ];

  await db
    .update(mcpServers)
    .set({
      status,
      statusMessage: message,
      logs,
      lastHealthCheckAt: new Date(),
      ...(status === 'connected' ? { lastConnectedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(mcpServers.id, serverId));
}

async function persistTools(serverId: string, tools: DiscoveredTool[]): Promise<void> {
  if (tools.length === 0) return;
  for (const tool of tools) {
    await db
      .insert(mcpTools)
      .values({
        id: newId(ID_PREFIX.mcpTool),
        serverId,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        isDestructive: tool.isDestructive,
      })
      .onConflictDoUpdate({
        target: [mcpTools.serverId, mcpTools.name],
        set: {
          description: tool.description,
          inputSchema: tool.inputSchema,
          isDestructive: tool.isDestructive,
          discoveredAt: new Date(),
        },
      });
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export function connectionCount(): number {
  return pool.size;
}

export function isConnected(serverId: string): boolean {
  return pool.has(serverId);
}
