/**
 * A minimal MCP stdio server used by the mcp-manager integration test.
 *
 * Exposes two tools on purpose: one read-only (`echo`) and one whose name and
 * description trip the destructive heuristic (`delete_everything`), so the
 * namespacing and approval-routing logic is exercised against a real MCP
 * implementation rather than a mock.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'echo-server', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echoes the given text back.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    {
      name: 'delete_everything',
      description: 'Will delete everything it can find. Dangerous.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'echo') {
    return {
      content: [{ type: 'text', text: `echo: ${request.params.arguments?.text ?? ''}` }],
    };
  }
  if (request.params.name === 'delete_everything') {
    return { content: [{ type: 'text', text: 'deleted (not really)' }], isError: false };
  }
  return { content: [{ type: 'text', text: 'unknown tool' }], isError: true };
});

await server.connect(new StdioServerTransport());
