import { plugins } from '@/lib/db/schema';

/**
 * Official plugin catalogue.
 *
 * A plugin installs a runtime, a CLI or a client into the sandbox image and
 * contributes tools and slash commands to the agent. Permissions are shown to
 * the user *before* install, so the `permissions` array must describe what the
 * plugin can actually reach, not what it nominally does.
 *
 * `requiresPrivileged` is false for every official plugin and should stay that
 * way: nothing in the catalogue may ask for a privileged container.
 */
export type PluginSeed = Omit<typeof plugins.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;

export const PLUGIN_SEEDS: readonly PluginSeed[] = [
  /* ---------------- development ---------------- */
  {
    key: 'docker',
    name: 'Docker',
    description: 'Build and run containers inside the sandbox with rootless Docker-in-Docker.',
    longDescription:
      'Adds the Docker CLI and a rootless dockerd running inside your sandbox, so the agent can build images, run compose stacks and exec into containers. Images and volumes live in the sandbox filesystem and are destroyed with it.',
    version: '25.0.4',
    publisher: 'Karo',
    category: 'development',
    icon: 'container',
    permissions: [
      { key: 'container.build', label: 'Build container images', risk: 'medium' },
      { key: 'container.run', label: 'Run containers inside the sandbox', risk: 'medium' },
      { key: 'network.egress', label: 'Pull images from public registries', risk: 'medium' },
      { key: 'disk.write', label: 'Store images and volumes in sandbox storage', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'REGISTRY_URL',
        label: 'Default registry',
        type: 'string',
        required: false,
        default: 'docker.io',
        description: 'Registry used when an image reference has no host.',
      },
      {
        key: 'REGISTRY_TOKEN',
        label: 'Registry token',
        type: 'password',
        required: false,
        secret: true,
        description:
          'Only needed for private images. Stored encrypted, never returned to a client.',
      },
    ],
    providedTools: ['docker_build', 'docker_run', 'docker_ps', 'docker_logs', 'docker_compose'],
    providedCommands: [
      { name: 'docker-build', description: 'Build the image defined by this project.' },
      {
        name: 'docker-up',
        description: 'Bring up the compose stack and report service health.',
      },
    ],
    // Rootless Docker-in-Docker: dockerd runs unprivileged *inside* the sandbox
    // with its own storage driver. The host Docker socket is never mounted and
    // `--privileged` is refused by `evaluateCommand()` — an escape from the
    // sandbox would not gain the host daemon, only a nested unprivileged one.
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://docs.docker.com/engine/security/rootless/',
  },
  {
    key: 'github',
    name: 'GitHub',
    description: 'Clone, push, open pull requests and read issues with the gh CLI.',
    longDescription:
      'Installs git and the GitHub CLI and wires them to a personal access token you supply. The agent can clone private repositories, push branches, open pull requests and read issue threads for context.',
    version: '2.66.1',
    publisher: 'Karo',
    category: 'development',
    icon: 'github',
    permissions: [
      { key: 'repo.read', label: 'Read repositories you grant access to', risk: 'low' },
      { key: 'repo.write', label: 'Push branches and open pull requests', risk: 'high' },
      { key: 'issues.read', label: 'Read issues and pull request discussions', risk: 'low' },
      { key: 'network.egress', label: 'Reach api.github.com and github.com', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'GITHUB_TOKEN',
        label: 'Personal access token',
        type: 'password',
        required: true,
        secret: true,
        description:
          'Fine-grained token. Grant Contents: read for cloning, Contents: write to push. Stored encrypted.',
      },
      {
        key: 'GITHUB_DEFAULT_BRANCH',
        label: 'Default base branch',
        type: 'string',
        required: false,
        default: 'main',
        description: 'Branch new pull requests target.',
      },
    ],
    providedTools: [
      'gh_clone',
      'gh_pr_create',
      'gh_pr_list',
      'gh_issue_read',
      'gh_repo_search',
    ],
    providedCommands: [
      { name: 'open-pr', description: 'Push the current branch and open a pull request.' },
      { name: 'issue-context', description: 'Pull an issue thread into the conversation.' },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://cli.github.com',
  },
  {
    key: 'nodejs',
    name: 'Node.js',
    description: 'Node 22 LTS with npm, pnpm and yarn preconfigured.',
    longDescription:
      'Installs the Node 22 LTS runtime plus npm, pnpm and yarn, with a warm package cache mounted into the sandbox. The agent detects the lockfile and uses the matching package manager rather than guessing.',
    version: '22.14.0',
    publisher: 'Karo',
    category: 'development',
    icon: 'hexagon',
    permissions: [
      {
        key: 'package.install',
        label: 'Install packages from the npm registry',
        risk: 'medium',
      },
      { key: 'network.egress', label: 'Reach registry.npmjs.org', risk: 'low' },
      { key: 'process.spawn', label: 'Run node and package scripts', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'NPM_REGISTRY',
        label: 'Registry URL',
        type: 'string',
        required: false,
        default: 'https://registry.npmjs.org',
        description: 'Point at a private registry or a mirror.',
      },
      {
        key: 'NPM_TOKEN',
        label: 'Registry token',
        type: 'password',
        required: false,
        secret: true,
        description: 'Only needed for private packages. Written to a scoped .npmrc at runtime.',
      },
    ],
    providedTools: ['npm_install', 'npm_run', 'node_exec'],
    providedCommands: [
      {
        name: 'install-deps',
        description: 'Install dependencies with the project package manager.',
      },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://nodejs.org',
  },
  {
    key: 'python',
    name: 'Python',
    description: 'Python 3.12 with pip, venv and uv for fast dependency resolution.',
    longDescription:
      'Installs CPython 3.12 alongside pip, venv and uv. The agent creates a project-local virtual environment rather than installing into the system interpreter, so a broken dependency never bricks the sandbox.',
    version: '3.12.9',
    publisher: 'Karo',
    category: 'development',
    icon: 'file-code',
    permissions: [
      { key: 'package.install', label: 'Install packages from PyPI', risk: 'medium' },
      { key: 'network.egress', label: 'Reach pypi.org', risk: 'low' },
      { key: 'process.spawn', label: 'Run python and installed console scripts', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'PIP_INDEX_URL',
        label: 'Package index URL',
        type: 'string',
        required: false,
        default: 'https://pypi.org/simple',
        description: 'Point at a private index or a mirror.',
      },
    ],
    providedTools: ['pip_install', 'python_exec', 'venv_create'],
    providedCommands: [
      { name: 'venv', description: 'Create a virtual environment and install requirements.' },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://www.python.org',
  },
  {
    key: 'bun',
    name: 'Bun',
    description: 'Bun runtime, bundler and test runner in one binary.',
    longDescription:
      'Installs Bun, which replaces node, npm, a bundler and a test runner with a single fast binary. Useful when install time dominates the feedback loop on a small sandbox.',
    version: '1.2.4',
    publisher: 'Karo',
    category: 'development',
    icon: 'zap',
    permissions: [
      {
        key: 'package.install',
        label: 'Install packages from the npm registry',
        risk: 'medium',
      },
      { key: 'network.egress', label: 'Reach registry.npmjs.org', risk: 'low' },
      { key: 'process.spawn', label: 'Run bun scripts and tests', risk: 'low' },
    ],
    configSchema: [],
    providedTools: ['bun_install', 'bun_run', 'bun_test'],
    providedCommands: [{ name: 'bun-test', description: 'Run the Bun test suite.' }],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://bun.sh',
  },
  {
    key: 'go',
    name: 'Go',
    description: 'Go 1.24 toolchain with module cache and gopls.',
    longDescription:
      'Installs the Go toolchain, the language server and a persistent module cache. Builds are static by default, which pairs well with the Docker plugin for very small production images.',
    version: '1.24.0',
    publisher: 'Karo',
    category: 'development',
    icon: 'binary',
    permissions: [
      {
        key: 'package.install',
        label: 'Download modules from proxy.golang.org',
        risk: 'medium',
      },
      {
        key: 'network.egress',
        label: 'Reach the Go module proxy and checksum database',
        risk: 'low',
      },
      { key: 'process.spawn', label: 'Run go build, test and vet', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'GOPROXY',
        label: 'Module proxy',
        type: 'string',
        required: false,
        default: 'https://proxy.golang.org,direct',
        description: 'Comma-separated proxy list.',
      },
      {
        key: 'GOPRIVATE',
        label: 'Private module prefixes',
        type: 'string',
        required: false,
        description: 'Glob patterns fetched directly instead of through the proxy.',
      },
    ],
    providedTools: ['go_build', 'go_test', 'go_mod_tidy'],
    providedCommands: [
      { name: 'go-test', description: 'Run go test ./... and summarise failures.' },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://go.dev',
  },

  /* ---------------- databases ---------------- */
  {
    key: 'postgresql',
    name: 'PostgreSQL',
    description: 'psql client plus an optional local Postgres 17 instance in the sandbox.',
    longDescription:
      'Installs the psql client and, when you enable it, a local Postgres 17 server inside the sandbox for development. Point it at an external database with a connection string instead if you already have one.',
    version: '17.4',
    publisher: 'Karo',
    category: 'databases',
    icon: 'database',
    permissions: [
      {
        key: 'db.read',
        label: 'Run read queries against the configured database',
        risk: 'medium',
      },
      { key: 'db.write', label: 'Run writes and migrations', risk: 'high' },
      { key: 'network.egress', label: 'Connect to an external database host', risk: 'medium' },
    ],
    configSchema: [
      {
        key: 'DATABASE_URL',
        label: 'Connection string',
        type: 'password',
        required: false,
        secret: true,
        description:
          'postgresql://user:password@host:5432/db. Leave empty to use the sandbox-local server.',
      },
      {
        key: 'START_LOCAL_SERVER',
        label: 'Start a local server',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Run Postgres inside the sandbox when no connection string is set.',
      },
    ],
    providedTools: ['psql_query', 'psql_schema', 'psql_explain'],
    providedCommands: [
      { name: 'db-schema', description: 'Dump the current schema into the conversation.' },
      { name: 'db-migrate', description: 'Apply pending migrations and report the result.' },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://www.postgresql.org/docs/',
  },
  {
    key: 'redis',
    name: 'Redis',
    description: 'redis-cli and a local Redis 7 instance for caching, queues and rate limits.',
    longDescription:
      'Installs redis-cli and an optional in-sandbox Redis 7 server. Handy for developing against a cache, a job queue or a rate limiter without provisioning anything external.',
    version: '7.4.2',
    publisher: 'Karo',
    category: 'databases',
    icon: 'layers',
    permissions: [
      { key: 'cache.read', label: 'Read keys from the configured instance', risk: 'low' },
      { key: 'cache.write', label: 'Write and delete keys', risk: 'medium' },
      { key: 'network.egress', label: 'Connect to an external Redis host', risk: 'medium' },
    ],
    configSchema: [
      {
        key: 'REDIS_URL',
        label: 'Connection string',
        type: 'password',
        required: false,
        secret: true,
        description: 'redis://... Leave empty to use the sandbox-local server on port 6379.',
      },
    ],
    providedTools: ['redis_get', 'redis_set', 'redis_keys', 'redis_info'],
    providedCommands: [
      { name: 'redis-info', description: 'Show memory, key count and hit rate.' },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://redis.io/docs/',
  },

  /* ---------------- deployment ---------------- */
  {
    key: 'vercel',
    name: 'Vercel',
    description: 'Deploy to Vercel with preview URLs and environment variable sync.',
    longDescription:
      'Installs the Vercel CLI and authenticates it with a token you supply. The agent can create preview deployments, promote a preview to production once you approve, and read build logs when a deploy fails.',
    version: '41.2.2',
    publisher: 'Karo',
    category: 'deployment',
    icon: 'triangle',
    permissions: [
      { key: 'deploy.preview', label: 'Create preview deployments', risk: 'medium' },
      { key: 'deploy.production', label: 'Promote a deployment to production', risk: 'high' },
      {
        key: 'env.write',
        label: 'Set environment variables on the Vercel project',
        risk: 'high',
      },
      { key: 'network.egress', label: 'Reach api.vercel.com', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'VERCEL_TOKEN',
        label: 'Vercel token',
        type: 'password',
        required: true,
        secret: true,
        description: 'Created in Vercel account settings. Stored encrypted.',
      },
      {
        key: 'VERCEL_PROJECT',
        label: 'Project name',
        type: 'string',
        required: false,
        description: 'Existing Vercel project. Leave empty to create one on first deploy.',
      },
    ],
    providedTools: ['vercel_deploy', 'vercel_logs', 'vercel_env_set', 'vercel_rollback'],
    providedCommands: [
      { name: 'preview', description: 'Deploy a preview and return the URL.' },
      { name: 'rollback', description: 'Roll production back to the previous deployment.' },
    ],
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://vercel.com/docs/cli',
  },
  {
    key: 'cloudflare',
    name: 'Cloudflare',
    description: 'Deploy Workers and Pages with Wrangler, and manage KV, R2 and D1.',
    longDescription:
      'Installs Wrangler and authenticates it with an API token. The agent can develop Workers locally against the sandbox, publish to a preview environment, and read or seed KV, R2 and D1 bindings.',
    version: '4.2.0',
    publisher: 'Karo',
    category: 'deployment',
    icon: 'cloud',
    permissions: [
      { key: 'deploy.worker', label: 'Publish Workers and Pages projects', risk: 'high' },
      { key: 'storage.write', label: 'Write to KV, R2 and D1 bindings', risk: 'high' },
      { key: 'network.egress', label: 'Reach api.cloudflare.com', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'CLOUDFLARE_API_TOKEN',
        label: 'API token',
        type: 'password',
        required: true,
        secret: true,
        description: 'Scoped token with Workers Scripts: Edit. Stored encrypted.',
      },
      {
        key: 'CLOUDFLARE_ACCOUNT_ID',
        label: 'Account ID',
        type: 'string',
        required: true,
        description: 'Found in the Cloudflare dashboard sidebar.',
      },
    ],
    providedTools: ['wrangler_deploy', 'wrangler_dev', 'wrangler_kv', 'wrangler_tail'],
    providedCommands: [
      { name: 'worker-deploy', description: 'Publish the Worker and return its route.' },
    ],
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://developers.cloudflare.com/workers/wrangler/',
  },

  /* ---------------- browser ---------------- */
  {
    key: 'chrome',
    name: 'Chrome',
    description:
      'Headless Chromium with the DevTools protocol for screenshots and page inspection.',
    longDescription:
      'Installs headless Chromium and exposes the DevTools protocol to the agent. Use it to screenshot a running preview, read the console for client-side errors, or extract the rendered DOM of a page the server-side fetch cannot see.',
    version: '134.0.6998.35',
    publisher: 'Karo',
    category: 'browser',
    icon: 'globe',
    permissions: [
      { key: 'browser.navigate', label: 'Open pages in a headless browser', risk: 'medium' },
      { key: 'network.egress', label: 'Load pages and their subresources', risk: 'medium' },
      { key: 'disk.write', label: 'Save screenshots into the workspace', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'DEFAULT_VIEWPORT',
        label: 'Default viewport',
        type: 'string',
        required: false,
        default: '1280x800',
        description: 'Width x height used when a tool call does not specify one.',
      },
    ],
    providedTools: ['browser_open', 'browser_screenshot', 'browser_console', 'browser_dom'],
    providedCommands: [
      { name: 'screenshot', description: 'Screenshot a URL or the running preview.' },
    ],
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://developer.chrome.com/docs/chromium/',
  },
  {
    key: 'lighthouse',
    name: 'Lighthouse',
    description: 'Audit a page for performance, accessibility, SEO and best practices.',
    longDescription:
      'Runs Google Lighthouse against a URL inside the sandbox and returns the category scores plus the specific failing audits. Pairs with the Chrome plugin, which supplies the browser it drives.',
    version: '12.4.0',
    publisher: 'Karo',
    category: 'browser',
    icon: 'gauge',
    permissions: [
      {
        key: 'browser.navigate',
        label: 'Load the audited page in a headless browser',
        risk: 'low',
      },
      { key: 'network.egress', label: 'Fetch the page and its assets', risk: 'medium' },
      { key: 'disk.write', label: 'Write the HTML report into the workspace', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'PRESET',
        label: 'Audit preset',
        type: 'select',
        required: false,
        default: 'desktop',
        description: 'desktop or mobile throttling profile.',
      },
    ],
    providedTools: ['lighthouse_audit', 'lighthouse_report'],
    providedCommands: [
      { name: 'audit-page', description: 'Audit a URL and list every failing check.' },
    ],
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://developer.chrome.com/docs/lighthouse/',
  },

  /* ---------------- automation ---------------- */
  {
    key: 'cron',
    name: 'Cron Scheduler',
    description: 'Run project scripts on a schedule while the sandbox is awake.',
    longDescription:
      'Adds a supervised scheduler to the sandbox so recurring jobs — a sync, a report, a cleanup — run on a cron expression. Jobs are paused while the sandbox sleeps and resume on wake; the run log is kept in the workspace.',
    version: '1.4.0',
    publisher: 'Karo',
    category: 'automation',
    icon: 'clock',
    permissions: [
      { key: 'process.spawn', label: 'Run the scheduled command', risk: 'medium' },
      { key: 'disk.write', label: 'Write job state and run logs', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'TIMEZONE',
        label: 'Timezone',
        type: 'string',
        required: false,
        default: 'UTC',
        description: 'IANA timezone used to interpret cron expressions.',
      },
      {
        key: 'MAX_CONCURRENT_JOBS',
        label: 'Max concurrent jobs',
        type: 'number',
        required: false,
        default: '2',
        description: 'Overlapping runs beyond this are skipped rather than queued.',
      },
    ],
    providedTools: ['cron_add', 'cron_list', 'cron_remove', 'cron_runs'],
    providedCommands: [
      { name: 'schedule', description: 'Schedule a command and show the next run times.' },
    ],
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: null,
  },
  {
    key: 'webhooks',
    name: 'Webhooks',
    description: 'Receive and replay inbound webhooks against the project preview.',
    longDescription:
      'Gives the sandbox a stable inbound URL that forwards signed webhook deliveries to a local port, records every payload, and lets the agent replay one on demand. Signature verification is enforced when you supply a secret.',
    version: '1.1.0',
    publisher: 'Karo',
    category: 'automation',
    icon: 'webhook',
    permissions: [
      {
        key: 'network.ingress',
        label: 'Accept inbound requests on a Karo-issued URL',
        risk: 'high',
      },
      { key: 'disk.write', label: 'Record delivered payloads', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'FORWARD_PORT',
        label: 'Forward to port',
        type: 'number',
        required: true,
        default: '3000',
        description: 'Local port that receives forwarded deliveries.',
      },
      {
        key: 'SIGNING_SECRET',
        label: 'Signing secret',
        type: 'password',
        required: false,
        secret: true,
        description: 'When set, deliveries failing HMAC verification are rejected and logged.',
      },
    ],
    providedTools: ['webhook_url', 'webhook_list', 'webhook_replay'],
    providedCommands: [
      { name: 'webhook-url', description: 'Show the inbound URL for this project.' },
      { name: 'replay-webhook', description: 'Replay the most recent delivery.' },
    ],
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: null,
  },

  /* ---------------- testing ---------------- */
  {
    key: 'playwright',
    name: 'Playwright',
    description: 'End-to-end browser tests across Chromium, Firefox and WebKit.',
    longDescription:
      'Installs Playwright with all three browser engines and the trace viewer. The agent can generate specs, run them headlessly in the sandbox, and read the trace of a failure instead of guessing why it broke.',
    version: '1.51.0',
    publisher: 'Karo',
    category: 'testing',
    icon: 'theater',
    permissions: [
      { key: 'browser.navigate', label: 'Drive browsers against your app', risk: 'medium' },
      {
        key: 'network.egress',
        label: 'Download browser binaries and load pages',
        risk: 'medium',
      },
      { key: 'disk.write', label: 'Write traces, screenshots and videos', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'BASE_URL',
        label: 'Base URL',
        type: 'string',
        required: false,
        default: 'http://localhost:3000',
        description: 'Root URL tests navigate against.',
      },
      {
        key: 'BROWSERS',
        label: 'Browsers to install',
        type: 'string',
        required: false,
        default: 'chromium',
        description: 'Comma-separated: chromium, firefox, webkit. Each adds about 300 MB.',
      },
    ],
    providedTools: ['playwright_test', 'playwright_codegen', 'playwright_trace'],
    providedCommands: [
      { name: 'e2e', description: 'Run the end-to-end suite and summarise failures.' },
    ],
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://playwright.dev',
  },
  {
    key: 'vitest',
    name: 'Vitest',
    description: 'Fast unit and integration tests for TypeScript and JavaScript projects.',
    longDescription:
      'Installs Vitest with coverage reporting and watch mode. The agent runs the suite after every change it makes, and reads the coverage report to find behaviour that no test would catch.',
    version: '4.1.10',
    publisher: 'Karo',
    category: 'testing',
    icon: 'flask-conical',
    permissions: [
      { key: 'process.spawn', label: 'Run the test suite', risk: 'low' },
      { key: 'disk.write', label: 'Write coverage output into the workspace', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'COVERAGE_THRESHOLD',
        label: 'Minimum coverage %',
        type: 'number',
        required: false,
        default: '0',
        description: 'Fail the run below this line coverage. 0 disables the gate.',
      },
    ],
    providedTools: ['vitest_run', 'vitest_coverage'],
    providedCommands: [
      { name: 'test', description: 'Run the unit test suite and report failures.' },
      { name: 'coverage', description: 'Run with coverage and list the weakest files.' },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://vitest.dev',
  },

  /* ---------------- ai ---------------- */
  {
    key: 'ollama',
    name: 'Ollama',
    description: 'Run small open-weight models locally inside the sandbox.',
    longDescription:
      'Installs Ollama so the project can call a local model over HTTP with no external API key and no per-token cost. Only small models fit in a sandbox — check your plan memory limit before pulling anything above 3B parameters.',
    version: '0.6.2',
    publisher: 'Karo',
    category: 'ai',
    icon: 'cpu',
    permissions: [
      {
        key: 'network.egress',
        label: 'Download model weights from the Ollama registry',
        risk: 'medium',
      },
      { key: 'disk.write', label: 'Store model weights in sandbox storage', risk: 'medium' },
      { key: 'process.spawn', label: 'Run the local inference server', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'DEFAULT_MODEL',
        label: 'Model to pull on install',
        type: 'string',
        required: false,
        default: 'qwen2.5:1.5b',
        description: 'Weights are downloaded once and counted against project storage.',
      },
    ],
    providedTools: ['ollama_pull', 'ollama_generate', 'ollama_list'],
    providedCommands: [
      { name: 'local-model', description: 'Pull a model and print the local endpoint.' },
    ],
    minPlanTier: 'scale',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://ollama.com',
  },
  {
    key: 'huggingface',
    name: 'Hugging Face',
    description: 'Download datasets and model artefacts from the Hugging Face Hub.',
    longDescription:
      'Installs the huggingface_hub client so the agent can fetch datasets, tokenizers and model cards into the workspace. A token is only needed for gated or private repositories.',
    version: '0.29.3',
    publisher: 'Karo',
    category: 'ai',
    icon: 'sparkles',
    permissions: [
      { key: 'network.egress', label: 'Reach huggingface.co', risk: 'low' },
      {
        key: 'disk.write',
        label: 'Write downloaded artefacts into the workspace',
        risk: 'medium',
      },
    ],
    configSchema: [
      {
        key: 'HF_TOKEN',
        label: 'Access token',
        type: 'password',
        required: false,
        secret: true,
        description: 'Read token. Only required for gated or private repositories.',
      },
    ],
    providedTools: ['hf_download', 'hf_search', 'hf_model_card'],
    providedCommands: [
      { name: 'hf-fetch', description: 'Download a dataset or model into the workspace.' },
    ],
    minPlanTier: 'pro',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://huggingface.co/docs/huggingface_hub',
  },

  /* ---------------- communication ---------------- */
  {
    key: 'telegram',
    name: 'Telegram',
    description: 'Bot API client for building and testing Telegram bots.',
    longDescription:
      'Installs a Telegram Bot API client and a helper that starts a long-polling loop in the sandbox, so the agent can run and exercise a bot without exposing a public webhook URL.',
    version: '8.3.0',
    publisher: 'Karo',
    category: 'communication',
    icon: 'send',
    permissions: [
      { key: 'message.send', label: 'Send messages as your bot', risk: 'high' },
      { key: 'message.read', label: 'Receive updates addressed to your bot', risk: 'medium' },
      { key: 'network.egress', label: 'Reach api.telegram.org', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'TELEGRAM_BOT_TOKEN',
        label: 'Bot token',
        type: 'password',
        required: true,
        secret: true,
        description:
          'Issued by @BotFather. Stored encrypted and injected into the sandbox only.',
      },
    ],
    providedTools: ['telegram_send', 'telegram_updates', 'telegram_set_commands'],
    providedCommands: [
      {
        name: 'bot-run',
        description: 'Start the bot in long-polling mode and stream its log.',
      },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://core.telegram.org/bots/api',
  },
  {
    key: 'discord',
    name: 'Discord',
    description: 'Gateway and REST client for building Discord bots and slash commands.',
    longDescription:
      'Installs a Discord client with gateway and REST support so the agent can register slash commands, respond to interactions and post to channels while you iterate.',
    version: '14.18.0',
    publisher: 'Karo',
    category: 'communication',
    icon: 'message-circle',
    permissions: [
      { key: 'message.send', label: 'Post messages as your bot', risk: 'high' },
      { key: 'message.read', label: 'Receive gateway events for your bot', risk: 'medium' },
      { key: 'network.egress', label: 'Reach discord.com and the gateway', risk: 'low' },
    ],
    configSchema: [
      {
        key: 'DISCORD_BOT_TOKEN',
        label: 'Bot token',
        type: 'password',
        required: true,
        secret: true,
        description: 'From the Discord developer portal. Stored encrypted.',
      },
      {
        key: 'DISCORD_GUILD_ID',
        label: 'Development guild ID',
        type: 'string',
        required: false,
        description: 'Register commands to one guild for instant updates while developing.',
      },
    ],
    providedTools: ['discord_send', 'discord_register_commands', 'discord_events'],
    providedCommands: [
      { name: 'discord-run', description: 'Connect the bot to the gateway and stream events.' },
    ],
    minPlanTier: 'payg',
    requiresPrivileged: false,
    isVerified: true,
    isActive: true,
    installCount: 0,
    homepageUrl: 'https://discord.com/developers/docs',
  },
];
