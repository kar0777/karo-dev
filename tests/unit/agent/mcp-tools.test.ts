import { beforeEach, describe, expect, it, vi } from 'vitest';

type CallToolArgs = [serverId: string, toolName: string, args: Record<string, unknown>];

const callToolMock = vi.fn(async (...[_serverId, toolName]: CallToolArgs) => ({
  output: `${toolName} output`,
  isError: false,
}));

vi.mock('@/lib/mcp/manager', () => ({
  callTool: (...args: CallToolArgs) => callToolMock(...args),
  loadToolsForProject: vi.fn(async () => ({ definitions: [], routes: new Map() })),
}));

import { runMcpToolCall } from '@/lib/agent/runtime';

describe('runMcpToolCall', () => {
  beforeEach(() => {
    callToolMock.mockClear();
  });

  it('pauses for approval on destructive tools without calling the server', async () => {
    const result = await runMcpToolCall(
      { serverId: 'mcp_1', toolName: 'delete_issue', requiresApproval: true },
      { id: 7 },
    );

    expect(result.isError).toBe(false);
    expect(result.needsApproval?.reason).toMatch(/approval|go-ahead/i);
    expect(result.needsApproval?.preview).toContain('"id": 7');
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it('routes normal calls through the manager and maps the output', async () => {
    const result = await runMcpToolCall(
      { serverId: 'mcp_1', toolName: 'search_repo', requiresApproval: false },
      { query: 'karo' },
    );

    expect(callToolMock).toHaveBeenCalledWith('mcp_1', 'search_repo', { query: 'karo' });
    expect(result).toEqual({
      output: 'search_repo output',
      summary: 'search_repo (MCP)',
      isError: false,
    });
  });

  it('marks server-side failures as errors without throwing', async () => {
    callToolMock.mockResolvedValueOnce({ output: 'boom', isError: true });

    const result = await runMcpToolCall(
      { serverId: 'mcp_2', toolName: 'explode', requiresApproval: false },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.output).toBe('boom');
  });
});
