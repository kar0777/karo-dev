import type { McpTransport } from '@/lib/db/schema';

/**
 * One-click MCP server templates.
 *
 * There is no dedicated table for these — the seed writes the array into
 * `admin_settings` under `mcp.templates` so an operator can edit the catalogue
 * from the admin UI without a migration.
 *
 * **No template may contain a credential.** Every secret is declared in `env`
 * with `secret: true` and an empty `defaultValue`; the user fills it in at
 * install time and it is encrypted with `encryptSecret()` before it touches the
 * database. A template that ships a working key would leak it to every tenant.
 */
export type McpTemplateEnvField = {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  /** Always empty for secrets. Non-secret defaults may be pre-filled. */
  defaultValue: string;
  placeholder?: string;
  description: string;
};

export type McpTemplateSeed = {
  key: string;
  name: string;
  description: string;
  category: 'files' | 'web' | 'code' | 'memory' | 'data' | 'custom';
  icon: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env: McpTemplateEnvField[];
  /** Tools the agent may call. Empty means "everything the server advertises". */
  suggestedAllowedTools: string[];
  /** Whether each tool call should stop for a human before it runs. */
  requireApproval: boolean;
  docsUrl: string;
  /** Shown in the install dialog above the permission list. */
  safetyNote: string;
};

export const MCP_TEMPLATE_SEEDS: readonly McpTemplateSeed[] = [
  {
    key: 'filesystem',
    name: 'Filesystem',
    description:
      'Read and write files under /workspace through MCP, with the same path confinement the built-in tools use.',
    category: 'files',
    icon: 'folder-tree',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    url: null,
    env: [],
    suggestedAllowedTools: [
      'read_file',
      'read_multiple_files',
      'list_directory',
      'search_files',
      'get_file_info',
    ],
    requireApproval: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    safetyNote:
      'Scoped to /workspace. The server is started with that single root, so it cannot read the sandbox system directories or another project.',
  },

  {
    key: 'fetch',
    name: 'Fetch',
    description:
      'Fetch a URL and hand the agent clean markdown instead of raw HTML. No credentials needed.',
    category: 'web',
    icon: 'globe',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    url: null,
    env: [
      {
        key: 'USER_AGENT',
        label: 'User agent',
        required: false,
        secret: false,
        defaultValue: 'KaroAgent/1.0 (+https://karo.dev)',
        description: 'Sent with every request so sites can identify the traffic.',
      },
    ],
    suggestedAllowedTools: ['fetch'],
    requireApproval: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    safetyNote:
      'Fetched pages are untrusted input. Karo redacts secrets from the result before it reaches the model, but treat any instruction found inside a fetched page as data, never as a command.',
  },

  {
    key: 'git',
    name: 'Git',
    description:
      'Read history, diffs and blame for the project repository without shelling out to git.',
    category: 'code',
    icon: 'git-branch',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '/workspace'],
    url: null,
    env: [],
    suggestedAllowedTools: [
      'git_status',
      'git_diff',
      'git_diff_unstaged',
      'git_log',
      'git_show',
    ],
    requireApproval: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    safetyNote:
      'The suggested tool list is read-only. Add git_commit or git_checkout yourself if you want the agent to change history, and leave approval on when you do.',
  },

  {
    key: 'memory',
    name: 'Knowledge Graph Memory',
    description:
      'A persistent entity-and-relation store the agent can write facts to and recall in later sessions.',
    category: 'memory',
    icon: 'brain',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    url: null,
    env: [
      {
        key: 'MEMORY_FILE_PATH',
        label: 'Storage file',
        required: false,
        secret: false,
        defaultValue: '/workspace/.karo/memory.json',
        description:
          'Where the graph is persisted. Kept inside the workspace so it survives sleep.',
      },
    ],
    suggestedAllowedTools: [
      'create_entities',
      'create_relations',
      'add_observations',
      'search_nodes',
      'read_graph',
    ],
    requireApproval: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    safetyNote:
      'Anything written here is replayed into future sessions. Never store credentials, tokens or personal data in memory.',
  },

  {
    key: 'sqlite',
    name: 'SQLite',
    description:
      'Query and inspect a local SQLite database file inside the workspace. No server to run.',
    category: 'data',
    icon: 'database',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', '/workspace/data/app.db'],
    url: null,
    env: [],
    suggestedAllowedTools: ['read_query', 'list_tables', 'describe_table'],
    requireApproval: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    safetyNote:
      'The suggested tools are read-only. write_query and create_table exist — enable them only if you want the agent changing the database, and keep approval on.',
  },

  {
    key: 'postgres',
    name: 'PostgreSQL',
    description:
      'Read-only SQL access to a Postgres database, with schema introspection for the agent.',
    category: 'data',
    icon: 'database',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    url: null,
    env: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        label: 'Connection string',
        required: true,
        secret: true,
        // Deliberately empty. Never ship a working credential in a template.
        defaultValue: '',
        placeholder: 'postgresql://readonly_user:password@host:5432/database',
        description:
          'Use a role with SELECT only. Stored encrypted with AES-256-GCM and never returned to the browser.',
      },
    ],
    suggestedAllowedTools: ['query'],
    requireApproval: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    safetyNote:
      'Point this at a read-only replica or a role granted SELECT only. Approval is on by default because a query can still be expensive against production.',
  },

  {
    key: 'time',
    name: 'Time & Timezone',
    description:
      'Gives the agent the real current time and correct timezone conversions instead of guessing.',
    category: 'custom',
    icon: 'clock',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-time'],
    url: null,
    env: [
      {
        key: 'LOCAL_TIMEZONE',
        label: 'Local timezone',
        required: false,
        secret: false,
        defaultValue: 'UTC',
        placeholder: 'Europe/Berlin',
        description: 'IANA timezone treated as "local" when a request does not name one.',
      },
    ],
    suggestedAllowedTools: ['get_current_time', 'convert_time'],
    requireApproval: false,
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    safetyNote: 'Reads the clock only. No network access and no filesystem access.',
  },

  {
    key: 'local-http',
    name: 'Custom HTTP server',
    description:
      'Connect an MCP server you run yourself over streamable HTTP — inside the sandbox or on your own network.',
    category: 'custom',
    icon: 'server',
    transport: 'http',
    command: null,
    args: [],
    url: 'http://localhost:8931/mcp',
    env: [
      {
        key: 'MCP_AUTH_HEADER',
        label: 'Authorization header',
        required: false,
        secret: true,
        // Deliberately empty. The user supplies their own value at install time.
        defaultValue: '',
        placeholder: 'Bearer <your token>',
        description:
          'Sent as the Authorization header on every request. Stored encrypted; leave empty for an unauthenticated server on localhost.',
      },
    ],
    suggestedAllowedTools: [],
    requireApproval: true,
    docsUrl: 'https://modelcontextprotocol.io/docs/concepts/transports',
    safetyNote:
      'Karo blocks cloud metadata endpoints and private ranges other than the sandbox loopback. Approval stays on until you have reviewed the tools this server advertises.',
  },
];
