import {
  ArrowRight,
  Bot,
  Clock,
  Container,
  Database,
  FlaskConical,
  FolderTree,
  GitBranch,
  GitPullRequest,
  Globe,
  LayoutTemplate,
  Network,
  Rocket,
  ScrollText,
  Server,
  Split,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';

import { Section, SectionIntro } from '@/components/marketing/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/* ------------------------------------------------------------------ *
 *  Landing sections 7, 8 and 12: the ecosystem around the machine.
 *
 *  Every entry below names something Karo actually seeds — the MCP
 *  templates in `@/lib/db/seed-data/mcp-templates`, the skills in
 *  `…/skills` and the plugins in `…/plugins`. No aspirational
 *  integrations.
 * ------------------------------------------------------------------ */

const MCP_CONNECTIONS = [
  {
    icon: FolderTree,
    name: 'Filesystem',
    transport: 'stdio',
    body: 'Reads and writes under /workspace with the same path confinement the built-in tools use. Started with a single root, so it cannot see another project.',
  },
  {
    icon: Globe,
    name: 'Fetch',
    transport: 'stdio',
    body: 'Turns a URL into clean markdown instead of raw HTML. Fetched pages are treated as untrusted input and redacted before the model sees them.',
  },
  {
    icon: GitBranch,
    name: 'Git',
    transport: 'stdio',
    body: 'History, diffs and blame for the project repository without shelling out — useful when the agent needs context but not a working tree.',
  },
  {
    icon: Database,
    name: 'PostgreSQL and SQLite',
    transport: 'stdio',
    body: 'Query a database directly. Connection strings are stored encrypted per team and injected into the server process, never into the transcript.',
  },
  {
    icon: ScrollText,
    name: 'Knowledge-graph memory',
    transport: 'stdio',
    body: 'A durable scratchpad across conversations. Facts the agent learns about your project survive a compaction.',
  },
  {
    icon: Clock,
    name: 'Time and timezone',
    transport: 'stdio',
    body: 'A small server that keeps date arithmetic honest — the model no longer has to guess what "next Tuesday" means in your timezone.',
  },
  {
    icon: Network,
    name: 'Custom HTTP server',
    transport: 'http / sse',
    body: 'Point Karo at any MCP endpoint you host. Auth headers are encrypted, and outbound requests are SSRF-checked before they leave.',
  },
  {
    icon: Server,
    name: 'Anything you write',
    transport: 'stdio / http',
    body: 'MCP is an open standard. If it speaks the protocol, Karo can list its tools, show their schemas and let you allow them one by one.',
  },
];

export function McpSection() {
  return (
    <Section id="mcp">
      <SectionIntro
        eyebrow="MCP integrations"
        title="Connect tools with an open standard, not a bespoke plugin API."
        description="Karo speaks the Model Context Protocol. Add a server, review the tools it exposes, allow the ones you want, and the agent can call them — with every call recorded and every argument validated."
      />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MCP_CONNECTIONS.map((connection) => {
          const Icon = connection.icon;
          return (
            <Card key={connection.name} className="h-full">
              <CardContent className="flex h-full flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-fg">
                    {connection.name}
                  </h3>
                </div>
                <p className="font-mono text-[10.5px] tracking-wide text-subtle uppercase">
                  {connection.transport}
                </p>
                <p className="text-[12.5px] leading-relaxed text-muted">{connection.body}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-6">
        <Button asChild variant="outline">
          <Link href="/docs#mcp">
            How MCP servers are configured
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Section>
  );
}

const SKILLS = [
  {
    icon: LayoutTemplate,
    name: 'Website Builder',
    body: 'Scaffolds and iterates on sites with semantic HTML, accessible components and real copy — never placeholder text.',
    commands: ['/scaffold-site', '/add-page', '/audit-a11y'],
  },
  {
    icon: Bot,
    name: 'Telegram Bot Developer',
    body: 'Builds long-polling bots, wires commands, and keeps the bot token in encrypted project environment rather than in code.',
    commands: ['/new-bot', '/add-command'],
  },
  {
    icon: Workflow,
    name: 'API Builder',
    body: 'Designs routes, validates input at the boundary, and writes the error envelope before the happy path.',
    commands: ['/scaffold-api', '/add-endpoint'],
  },
  {
    icon: FlaskConical,
    name: 'Test Engineer',
    body: 'Finds the untested branches, writes tests that fail for the right reason, and reports coverage gaps honestly.',
    commands: ['/write-tests', '/coverage-gaps'],
  },
  {
    icon: Split,
    name: 'Git Assistant',
    body: 'Writes commit messages that explain why, reviews a diff before it is pushed, and cleans up stale branches.',
    commands: ['/commit', '/review-diff', '/clean-branch'],
  },
  {
    icon: Rocket,
    name: 'Deployment Assistant',
    body: 'Runs the pre-flight checks, then deploys — with the provider token supplied as an encrypted environment variable.',
    commands: ['/deploy', '/deploy-check'],
  },
];

const PLUGINS = [
  { icon: Container, name: 'Docker', body: 'Rootless containers and compose stacks' },
  { icon: GitPullRequest, name: 'GitHub', body: 'Clone, push, open PRs, read issues' },
  { icon: Server, name: 'Node.js', body: 'Node 22 LTS with npm, pnpm and yarn' },
  { icon: FlaskConical, name: 'Python', body: 'Python 3.12 with pip, venv and uv' },
  { icon: Rocket, name: 'Bun', body: 'Runtime, bundler and test runner' },
  { icon: Database, name: 'PostgreSQL', body: 'psql plus an optional local server' },
];

export function SkillsSection() {
  return (
    <Section id="skills" tone="inset">
      <SectionIntro
        eyebrow="Skills and plugins"
        title="Teach the agent a job, then give it the toolchain to do it."
        description="A skill is a system-prompt fragment plus the slash commands that go with it — it changes how the agent thinks. A plugin installs a runtime into the sandbox and declares the permissions it needs — it changes what the agent can touch."
      />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SKILLS.map((skill) => {
          const Icon = skill.icon;
          return (
            <Card key={skill.name} className="h-full">
              <CardContent className="flex h-full flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <h3 className="text-[13.5px] font-semibold text-fg">{skill.name}</h3>
                  <Badge variant="outline" size="sm" className="ml-auto">
                    skill
                  </Badge>
                </div>
                <p className="text-[12.5px] leading-relaxed text-muted">{skill.body}</p>
                <ul className="mt-auto flex flex-wrap gap-1">
                  {skill.commands.map((command) => (
                    <li
                      key={command}
                      className="rounded-sm border border-line bg-bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
                    >
                      {command}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8">
        <h3 className="text-[13px] font-semibold tracking-[0.1em] text-subtle uppercase">
          Plugins that install into the sandbox
        </h3>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PLUGINS.map((plugin) => {
            const Icon = plugin.icon;
            return (
              <li
                key={plugin.name}
                className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2.5"
              >
                <Icon className="size-4 shrink-0 text-ember" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-fg">{plugin.name}</span>
                  <span className="block truncate text-[12px] text-subtle">{plugin.body}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
          Go, Redis, Playwright, Vitest, Chrome, Lighthouse, Vercel, Cloudflare, Telegram,
          Discord, Ollama, Hugging Face, a cron scheduler and a webhook receiver complete the
          catalogue. Every plugin lists the permissions it wants before it is installed, and you
          can revoke it without losing the project.
        </p>
      </div>
    </Section>
  );
}

const USE_CASES = [
  {
    icon: LayoutTemplate,
    title: 'Websites and web apps',
    body: 'Scaffold a Next.js or static site, iterate on real components, run the build, then open a preview URL and look at it.',
    proof: 'Templates: Next.js website · Static website',
  },
  {
    icon: Bot,
    title: 'Telegram bots',
    body: 'Long-polling bot with commands, a keyboard and an admin chat. The token lives in encrypted project environment, never in a file.',
    proof: 'Template: Telegram bot · Skill: Telegram Bot Developer',
  },
  {
    icon: Workflow,
    title: 'APIs and services',
    body: 'FastAPI or Node routes with validation, an error envelope and health checks, exercised with curl in the same shell that built them.',
    proof: 'Templates: Python API · Node.js API',
  },
  {
    icon: Clock,
    title: 'Automations and workers',
    body: 'Scheduled jobs, scrapers, cleanup scripts and webhook receivers, running on a machine that sleeps between ticks.',
    proof: 'Template: Automation worker',
  },
  {
    icon: FlaskConical,
    title: 'Tests and coverage',
    body: 'Point the agent at an untested module and watch it write failing tests first, then make them pass — with the run output in the terminal.',
    proof: 'Skill: Test Engineer',
  },
  {
    icon: Database,
    title: 'Migrations and refactors',
    body: 'Multi-file changes with a plan you approve up front, a diff you approve per file, and a test run before anything is applied.',
    proof: 'Modes: Plan then Build',
  },
];

export function UseCasesSection() {
  return (
    <Section id="use-cases" tone="inset">
      <SectionIntro
        eyebrow="Use cases"
        title="What people actually build here."
        description="Karo is a general-purpose machine, but these are the shapes of work it is tuned for — and the seeded templates and skills that get you moving in each."
      />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {USE_CASES.map((useCase) => {
          const Icon = useCase.icon;
          return (
            <Card key={useCase.title} className="h-full">
              <CardContent className="flex h-full flex-col gap-2">
                <Icon className="size-4 text-primary" aria-hidden="true" />
                <h3 className="text-[14px] font-semibold text-fg">{useCase.title}</h3>
                <p className="text-[13px] leading-relaxed text-muted">{useCase.body}</p>
                <p className="mt-auto pt-2 font-mono text-[10.5px] text-subtle">
                  {useCase.proof}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
