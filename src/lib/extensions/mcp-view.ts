import 'server-only';

import type { mcpServers, mcpTools } from '@/lib/db/schema';
import { buildSecrets, secretKeyNames } from '@/lib/extensions/service';
import type { McpServerView, McpToolView } from '@/lib/extensions/types';

/** Row → wire shape. The one place that decides what an MCP server looks like. */
export function toMcpServerView(
  server: typeof mcpServers.$inferSelect,
  projectName: string | null,
  counts?: { total: number; enabled: number },
): McpServerView {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    scope: server.scope,
    projectId: server.projectId,
    projectName,
    transport: server.transport,
    command: server.command,
    args: server.args ?? [],
    url: server.url,
    headers: Object.entries(server.headers ?? {}).map(([name, value]) => ({ name, value })),
    env: Object.entries(server.env ?? {}).map(([key, value]) => ({ key, value })),
    secretKeys: secretKeyNames(server.secretsCiphertext),
    isEnabled: server.isEnabled,
    status: server.status,
    statusMessage: server.statusMessage,
    allowedTools: server.allowedTools ?? [],
    requireApproval: server.requireApproval,
    lastConnectedAt: server.lastConnectedAt?.toISOString() ?? null,
    lastHealthCheckAt: server.lastHealthCheckAt?.toISOString() ?? null,
    templateKey: server.templateKey,
    toolCount: counts?.total ?? 0,
    enabledToolCount: counts?.enabled ?? 0,
    createdAt: server.createdAt.toISOString(),
  };
}

export function toMcpToolView(tool: typeof mcpTools.$inferSelect): McpToolView {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    isEnabled: tool.isEnabled,
    isDestructive: tool.isDestructive,
    callCount: tool.callCount,
    lastCalledAt: tool.lastCalledAt?.toISOString() ?? null,
    discoveredAt: tool.discoveredAt.toISOString(),
  };
}

export type McpConfigurationInput = {
  transport: string;
  env: Array<{ key: string; value: string; secret: boolean }>;
  headers: Array<{ name: string; value: string; secret: boolean }>;
};

/**
 * Splits submitted configuration into the three storage buckets: plaintext env,
 * plaintext headers, and one encrypted bag for everything marked secret.
 *
 * Secret headers are stored under the `header:<Name>` key that
 * `lib/mcp/manager.ts` looks for when it builds a remote transport — that
 * prefix is the contract between this module and the connection manager.
 */
export function splitMcpConfiguration(body: McpConfigurationInput): {
  env: Record<string, string>;
  headers: Record<string, string>;
  secrets: string | null;
  secretKeys: string[];
} {
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  const secretBag: Record<string, string> = {};

  if (body.transport === 'stdio') {
    for (const entry of body.env) {
      if (entry.secret) secretBag[entry.key] = entry.value;
      else env[entry.key] = entry.value;
    }
  } else {
    for (const entry of body.headers) {
      if (entry.secret) secretBag[`header:${entry.name}`] = entry.value;
      else headers[entry.name] = entry.value;
    }
  }

  return {
    env,
    headers,
    secrets: buildSecrets(secretBag),
    secretKeys: Object.keys(secretBag).filter((key) => secretBag[key] !== ''),
  };
}
