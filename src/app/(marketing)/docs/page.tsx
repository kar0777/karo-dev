import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type * as React from 'react';

import { APP_NAV } from '@/components/app/nav';
import { LatticeBackdrop } from '@/components/brand/lattice';
import { SectionNav, SidebarNav } from '@/components/marketing/anchor-nav';
import {
  API_ENDPOINTS,
  DOCS_NAV,
  SLASH_COMMANDS,
  SLASH_GROUPS,
} from '@/components/marketing/docs-data';
import { breadcrumbJsonLd, JsonLd, webPageJsonLd } from '@/components/marketing/json-ld';
import {
  CONTAINER,
  DiamondList,
  Eyebrow,
  SectionIntro,
  SpecRow,
} from '@/components/marketing/section';
import { controlsInGroup } from '@/components/marketing/security-controls';
import { TerminalPanel } from '@/components/marketing/terminal-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { Kbd } from '@/components/ui/kbd';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AGENT_MODE_META, AGENT_MODES, WORKSPACE_ROOT } from '@/lib/agent/policy';
import { CSRF_HEADER } from '@/lib/api/csrf-header';
import { buildMetadata, siteConfig } from '@/lib/metadata';
import { BASE_COMPUTE_UNIT, calculateComputeMultiplier } from '@/lib/pricing/compute';
import { FALLBACK_MULTIPLIERS } from '@/lib/pricing/weighted-tokens';
import { cn } from '@/lib/utils';

export const metadata: Metadata = buildMetadata({
  title: 'Documentation',
  description:
    'How Karo works, end to end: quickstart, the workspace, projects and sandboxes, weighted tokens and compute hours, agent modes, every slash command, MCP servers, skills, plugins, bring-your-own key and server, billing and the REST API.',
  path: '/docs',
  type: 'article',
});

/**
 * The sub-bar shown instead of the sidebar on narrow screens. Flattened from
 * the same outline, so a section can never be reachable from one nav and not
 * the other.
 */
const FLAT_NAV = DOCS_NAV.flatMap((group) => group.items);

/**
 * Commands bucketed once, at module scope, in the order `SLASH_GROUPS`
 * declares. A group with no commands is dropped rather than rendered as an
 * empty table — the only way that can happen is a mistake in the data.
 */
const SLASH_BY_GROUP = SLASH_GROUPS.map((group) => ({
  group,
  commands: SLASH_COMMANDS.filter((command) => command.group === group),
})).filter((bucket) => bucket.commands.length > 0);

/** Worked example for the compute section, from the function that bills it. */
const SMALL_MACHINE = calculateComputeMultiplier({ cpuCores: 0.5, memoryMb: 1024 });

const METHOD_VARIANT: Record<string, 'neutral' | 'primary' | 'ember' | 'danger'> = {
  GET: 'neutral',
  POST: 'primary',
  PUT: 'ember',
  DELETE: 'danger',
};

const READING_MAP = [
  {
    title: 'New to Karo',
    body: 'Get an account, a project and a first reviewed diff, then learn what each pane of the workspace is for.',
    links: [
      { href: '#quickstart', label: 'Quickstart' },
      { href: '#workspace-tour', label: 'Workspace tour' },
    ],
  },
  {
    title: 'Driving the agent',
    body: 'The four modes and what each one may touch, the command reference, and the shell you and the agent share.',
    links: [
      { href: '#agent-modes', label: 'Agent modes' },
      { href: '#slash-commands', label: 'Slash commands' },
    ],
  },
  {
    title: 'Running it for real',
    body: 'What a run costs and how it is settled, the controls that make a shell safe to hand over, and the REST surface.',
    links: [
      { href: '#billing', label: 'Billing and usage' },
      { href: '#api', label: 'API' },
    ],
  },
];

const TERMINAL_TRANSCRIPT = [
  { kind: 'cmd' as const, text: 'npm ci' },
  { kind: 'out' as const, text: 'added 412 packages in 9s' },
  { kind: 'cmd' as const, text: 'npm test -- --run fetch-retry' },
  { kind: 'ok' as const, text: ' ✓ tests/fetch-retry.test.ts (7 tests) 412ms' },
  { kind: 'cmd' as const, text: 'git commit -am "add a retry budget to the fetch wrapper"' },
  { kind: 'out' as const, text: '[main 8c41f2a] add a retry budget to the fetch wrapper' },
  { kind: 'cmd' as const, text: 'rm -rf node_modules' },
  {
    kind: 'warn' as const,
    text: 'confirm required: recursively deletes files — approve in chat to continue',
  },
];

const MCP_STDIO_CONFIG = `{
  "name": "Postgres (read only)",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres"],
  "env": [
    {
      "key": "POSTGRES_CONNECTION_STRING",
      "value": "postgresql://reader:…@db.internal:5432/app",
      "secret": true
    }
  ],
  "allowedTools": ["query"],
  "requireApproval": true,
  "scope": "project"
}`;

const SKILL_DOCUMENT = `{
  "karoSkillVersion": 1,
  "key": "migration-reviewer",
  "name": "Migration reviewer",
  "description": "Reads every existing migration before proposing a schema change.",
  "category": "databases",
  "allowedTools": ["read_file", "search_files", "run_command"],
  "slashCommands": [
    {
      "name": "review-migration",
      "description": "Audit the pending migration and report the locks it takes",
      "prompt": "Review the newest migration in this repository. Name every table it locks and for how long."
    }
  ],
  "instructions": "Before proposing any schema change, read every migration already in the repository and the ORM model it maps to. Never write a destructive migration without a reversible down step — and say so out loud when one is not possible."
}`;

const WORKER_INSTALL = `curl -fsSL https://get.karo.dev/worker.sh \\
  | sh -s -- --token <installation-token> --url https://your-karo-host`;

const API_CALL = `# every endpoint returns JSON; GET requests need no CSRF token
curl -sS "$KARO_URL/api/usage/summary?days=30" \\
  -H "cookie: karo_session=$KARO_SESSION" \\
  | jq '.totals.weightedTokens'`;

const API_ERROR = `{
  "error": {
    "code": "rate_limited",
    "title": "Slow down for a moment",
    "message": "Too many requests.",
    "retryAfterSeconds": 30
  }
}`;

/* ------------------------------------------------------------------ *
 *  Page-local chrome
 *
 *  The marketing `Section` is a full-bleed band with its own container,
 *  which cannot sit inside the sidebar grid — so the documentation body
 *  brings its own section shell and reuses `SectionIntro`'s siblings
 *  (`Eyebrow`, `DiamondList`, `SpecRow`) for everything inside it.
 * ------------------------------------------------------------------ */

/**
 * Divider between the outline's groups. Deliberately not a heading: the
 * sections underneath own the document outline, and an extra level here would
 * put a rung in it that the sidebar does not link to.
 */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Eyebrow tone="muted">{children}</Eyebrow>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
  );
}

function DocSection({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl sm:text-2xl">{title}</h2>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted">{lede}</p>
      {children ? <div className="mt-5 flex flex-col gap-4">{children}</div> : null}
    </section>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-surface p-4', className)}>
      <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Inline literal — a path, a header name, a field. */
function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[12.5px] text-fg">{children}</code>;
}

function Steps({ items }: { items: readonly React.ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-[14px] leading-relaxed text-muted">
          <span className="karo-numeric shrink-0 font-medium text-subtle">{index + 1}.</span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export default function DocsPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            name: 'Karo documentation',
            description:
              'Quickstart, concepts, agent modes, the slash-command reference, MCP servers, skills, plugins, bring-your-own key and server, billing and the REST API.',
            path: '/docs',
            type: 'TechArticle',
          }),
          breadcrumbJsonLd([{ name: 'Documentation', path: '/docs' }]),
        ]}
      />

      <section className="relative isolate overflow-hidden">
        <LatticeBackdrop fade="top" opacity={50} />
        <div className={`${CONTAINER} pt-14 pb-10 sm:pt-20`}>
          <SectionIntro
            eyebrow="Documentation"
            title="Karo, in the order you will meet it."
            description="Karo gives an AI coding agent a sandboxed Linux machine, a shell, your project files and a meter on everything it spends. This page is the whole reference: how to get from signing in to a change you have reviewed and applied, what each concept in the interface means, every slash command, and the REST surface."
            as="h1"
          >
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="lg" iconRight={<ArrowRight aria-hidden="true" />}>
                <Link href="/register">Start building</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login?demo=1">Open the demo</Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/pricing">Compare plans</Link>
              </Button>
            </div>
          </SectionIntro>

          <div className="mt-9 grid gap-3 sm:grid-cols-3">
            {READING_MAP.map((entry) => (
              <div key={entry.title} className="rounded-lg border border-line bg-surface p-4">
                <h3 className="text-[13.5px] font-semibold text-fg">{entry.title}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{entry.body}</p>
                <ul className="mt-3 flex flex-col gap-1">
                  {entry.links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="rounded-sm text-[12.5px] text-primary transition-colors duration-150 ease-[var(--k-ease)] hover:text-fg"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SectionNav items={FLAT_NAV} className="lg:hidden" label="Documentation sections" />

      <div className="border-t border-line">
        <div className={`${CONTAINER} py-12 sm:py-14`}>
          <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
            <SidebarNav
              groups={DOCS_NAV}
              className="sticky top-20 hidden max-h-[calc(100dvh-7rem)] self-start overflow-y-auto pb-4 lg:flex"
            />

            {/* Section order mirrors DOCS_NAV, which is what the two navs read. */}
            <div className="flex min-w-0 flex-col gap-12">
              <GroupLabel>Getting started</GroupLabel>

              <DocSection
                id="quickstart"
                title="Quickstart"
                lede="Five steps from an empty account to a change the agent wrote, tested and you approved. None of them need a provider key or a card: the demo runs on mock model, sandbox and billing providers and behaves exactly like the real thing, meter included."
              >
                <Steps
                  items={[
                    <>
                      <strong className="font-medium text-fg">Sign in.</strong> The demo signs
                      you into a seeded team with projects, conversations and usage history
                      already in it. Registering instead starts you on pay as you go, where you
                      are charged upstream cost plus a flat margin and nothing is bundled.
                    </>,
                    <>
                      <strong className="font-medium text-fg">Finish setup.</strong> The wizard
                      walks through how you work, your plan, a default model, where sandboxes
                      should run — Karo Cloud, an external provider or your own server — then
                      the first project, its template and the permissions its agent gets. Every
                      one of them is a setting you can change afterwards.
                    </>,
                    <>
                      <strong className="font-medium text-fg">Let the sandbox come up.</strong>{' '}
                      It is created with the project and seeded from the template. From then on{' '}
                      <Mono>{WORKSPACE_ROOT}</Mono> survives every sleep, and waking the machine
                      takes about four seconds.
                    </>,
                    <>
                      <strong className="font-medium text-fg">
                        Ask for something concrete.
                      </strong>{' '}
                      &ldquo;Add a retry budget to the fetch wrapper and prove it with a
                      test.&rdquo; In Build mode the agent reads the repository, writes the
                      change, runs the test in the sandbox, reads the failure if there is one,
                      and tries again.
                    </>,
                    <>
                      <strong className="font-medium text-fg">Review and apply.</strong> Changes
                      arrive as a pending diff per file and nothing is written to the workspace
                      until you approve it. Rejecting restores the previous contents of that
                      file.
                    </>,
                  ]}
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <Panel title="What the demo actually is">
                    <dl>
                      <SpecRow label="Model provider" value="Mock, deterministic replies" />
                      <SpecRow label="Sandbox provider" value="In-process, no container" />
                      <SpecRow label="Billing provider" value="Mock, invoices are simulated" />
                      <SpecRow label="Data" value="Seeded team, projects and usage" />
                      <SpecRow label="Metering" value="Recorded and shown, never charged" />
                    </dl>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                      Demo mode is the whole product with the providers swapped, not a cut-down
                      tour. Every screen, guard and usage row you see is the one a paid account
                      gets.
                    </p>
                  </Panel>

                  <Panel title="If something goes wrong early">
                    <dl>
                      <SpecRow
                        label="Sandbox stuck starting"
                        value="Check the provider in setup"
                      />
                      <SpecRow
                        label="Agent refuses a command"
                        value="Project permission or mode"
                      />
                      <SpecRow
                        label="Run blocked before it starts"
                        value="A spend guard fired"
                      />
                      <SpecRow
                        label="No models in the picker"
                        value="Catalogue has not synced"
                      />
                    </dl>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                      Each of these states names the limit or setting it hit and links to the
                      screen that changes it. Nothing fails silently, and nothing charges you
                      for a run it refused.
                    </p>
                  </Panel>
                </div>
              </DocSection>

              <DocSection
                id="workspace-tour"
                title="Workspace tour"
                lede="The workspace is a small IDE rather than a chat box with an attachment: the conversation on the left, the file tree and editor in the middle, a terminal and a live preview behind tabs, and the meter in the rail beside it all. Everything the agent touches is visible where you would look for it yourself."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      title: 'Chat',
                      body: 'The run, as it happens. Every tool call expands to show its arguments, its result and how long it took, and approvals for risky calls appear inline rather than as a modal you click through.',
                    },
                    {
                      title: 'Code',
                      body: 'Monaco with the project’s real files, plus the pending diff for anything the agent has proposed. Edit a file yourself and your version is what the agent reads next.',
                    },
                    {
                      title: 'Terminal',
                      body: 'The same PTY the agent is typing into, streamed to your browser. Take it over mid-run, then hand it back.',
                    },
                    {
                      title: 'Preview',
                      body: 'A port exposed from the sandbox over HTTPS, refreshed as the code changes. Available on plans that allow preview deployments.',
                    },
                  ].map((pane) => (
                    <div
                      key={pane.title}
                      className="rounded-lg border border-line bg-surface p-4"
                    >
                      <h3 className="text-[14px] font-semibold text-fg">{pane.title}</h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">{pane.body}</p>
                    </div>
                  ))}
                </div>

                <h3 className="mt-2 text-lg">Everything else in the product</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  {APP_NAV.map((group) => (
                    <div
                      key={group.id}
                      className="rounded-lg border border-line bg-surface p-4"
                    >
                      <p className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
                        {group.label}
                      </p>
                      <ul className="mt-3 flex flex-col gap-3">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          return (
                            <li key={item.href} className="flex gap-2.5">
                              <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-fg">{item.label}</p>
                                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                                  {item.hint}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>

                <Panel title="Two shortcuts worth learning">
                  <ul className="flex flex-col gap-2">
                    <li className="flex items-center gap-2 text-[13px] text-muted">
                      <span className="flex items-center gap-1">
                        <Kbd>⌘</Kbd>
                        <span className="text-subtle">/</span>
                        <Kbd>Ctrl</Kbd>
                        <Kbd>K</Kbd>
                      </span>
                      <span>
                        Command palette — every screen, every project and the create actions.
                      </span>
                    </li>
                    <li className="flex items-center gap-2 text-[13px] text-muted">
                      <span className="flex items-center gap-1">
                        <Kbd>⌘</Kbd>
                        <span className="text-subtle">/</span>
                        <Kbd>Ctrl</Kbd>
                        <Kbd>B</Kbd>
                      </span>
                      <span>Collapse the sidebar to icons. The preference is remembered.</span>
                    </li>
                  </ul>
                </Panel>
              </DocSection>

              <GroupLabel>Concepts</GroupLabel>

              <DocSection
                id="projects"
                title="Projects"
                lede="A project is a workspace, one machine, its conversations and its own agent permission matrix. It is the unit everything else hangs off: usage is attributed to it, MCP servers and skills can be scoped to it, and deleting it destroys the sandbox and the volume with it."
              >
                <DiamondList
                  items={[
                    'Created from a template — a blank workspace, a Next.js site, a Python or Node API, a static site, a Telegram bot or a scheduled automation worker. The template seeds the workspace and the sandbox is provisioned with it.',
                    'Each project carries its own permission switches: read, write and delete files, run commands, install packages, network access, git commit, git push, Docker, MCP tools, dev servers, and the two auto-approve toggles. A teammate with full team permissions still cannot make this project’s agent push to a remote if the project forbids it.',
                    'Environment variables are per project. Values marked secret are encrypted at rest, shown masked, and never printed in full — not in the transcript, not in a log line.',
                    'Conversations belong to the project, so an agent run’s history and its cost sit where the work happened rather than in one global feed.',
                    'How many projects you can have is a plan limit, as is how many of their sandboxes may run at once.',
                  ]}
                />

                <Panel title="Boundaries a project cannot cross">
                  <dl>
                    <SpecRow label="Workspace root" value={WORKSPACE_ROOT} />
                    <SpecRow label="Writable path" value="The workspace only" />
                    <SpecRow label="Path handling" value="Normalised, traversal rejected" />
                    <SpecRow label="Machines" value="One sandbox per project" />
                    <SpecRow label="Deletion" value="Destroys the sandbox and its volume" />
                  </dl>
                  <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                    A path that resolves outside the workspace is refused rather than clamped,
                    so an escape attempt shows up in the audit log instead of quietly becoming a
                    valid path nobody asked for.
                  </p>
                </Panel>
              </DocSection>

              <DocSection
                id="sandboxes"
                title="Sandboxes"
                lede="The sandbox is the real computer behind the agent: an unprivileged Linux machine with its own filesystem, its own network namespace and a persistent volume. It is created with the project, sleeps when idle, wakes on the next command, and is destroyed when the project is deleted or its retention window expires."
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <DiamondList
                    items={[
                      'Providers: Karo Cloud, a remote Docker host, Daytona, your own registered server, or the in-process mock demo mode uses.',
                      'Eight explicit states — creating, starting, running, sleeping, stopping, stopped, failed and destroyed — each with its own message and its own next step.',
                      'Compute accrues per second only while the machine is awake. Idle timeout and retention window are plan limits.',
                      'CPU, memory, disk and uptime stream while it runs and are recorded against the project for usage.',
                      'Containers inside a sandbox come from the rootless Docker plugin. The host Docker socket is not mounted and is not visible from inside.',
                    ]}
                  />

                  <div className="flex flex-col gap-3">
                    <Panel title="Isolation, as configured">
                      <dl>
                        <SpecRow label="Runtime" value="Rootless, unprivileged" />
                        <SpecRow label="Namespaces" value="PID · mount · net · user · IPC" />
                        <SpecRow label="Root filesystem" value="Read-only base image" />
                        <SpecRow label="Writable path" value={WORKSPACE_ROOT} />
                        <SpecRow label="Syscalls" value="seccomp, no CAP_SYS_ADMIN" />
                        <SpecRow label="Wake from sleep" value="≈ 4 seconds" />
                      </dl>
                    </Panel>
                    <p className="text-[12.5px] leading-relaxed text-subtle">
                      <Mono>/sandbox status</Mono> reports the size, uptime, compute multiplier
                      and current CPU, memory and disk of the machine you are talking to, and{' '}
                      <Mono>/sandbox restart</Mono> replaces it without touching the workspace.
                    </p>
                  </div>
                </div>
              </DocSection>

              <DocSection
                id="weighted-tokens"
                title="Weighted tokens"
                lede="Providers charge four different rates for what looks like one thing, and those ratios move whenever a price sheet changes. A plan that promised “6 million tokens” would therefore be worth a different amount of money on every model, so a Karo plan promises weighted tokens instead."
              >
                <p className="rounded-md border border-line-accent bg-primary-soft px-4 py-3 font-mono text-[13.5px] text-primary-soft-fg">
                  1 input token = 1 weighted token
                </p>

                <div className="grid gap-4 lg:grid-cols-2">
                  <DiamondList
                    items={[
                      'Every other class — output, cached read, cache write — converts at that model’s current price ratio against its own input price. When prices move the multipliers recompute; no plan is edited and no allowance silently shrinks.',
                      'Each request records the four token counts separately, with the multiplier applied to each, so a charge can always be re-derived from the row.',
                      'Prompt caching is used automatically wherever the model supports it. A re-read of cached context costs a fraction of a first read, which is why long conversations stay affordable.',
                      'Tokens spent through your own provider key are marked BYOK, billed by that provider, and never drawn from the allowance.',
                    ]}
                  />

                  <div className="flex flex-col gap-3">
                    <Panel title="Multipliers when a model publishes no input price">
                      <dl>
                        <SpecRow label="Input" value={`×${FALLBACK_MULTIPLIERS.input}`} />
                        <SpecRow label="Output" value={`×${FALLBACK_MULTIPLIERS.output}`} />
                        <SpecRow
                          label="Cached read"
                          value={`×${FALLBACK_MULTIPLIERS.cachedInput}`}
                        />
                        <SpecRow
                          label="Cache write"
                          value={`×${FALLBACK_MULTIPLIERS.cacheWrite}`}
                        />
                      </dl>
                      <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                        These documented fallbacks are used only when there is no input price to
                        take ratios against — a free tier, the mock provider or a gap in the
                        catalogue. Every charge derived from them is flagged as estimated.
                      </p>
                    </Panel>
                    <div>
                      <Button asChild variant="outline" size="sm">
                        <Link href="/pricing#weighted-tokens">
                          The live multipliers and a worked example
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </DocSection>

              <DocSection
                id="compute-units"
                title="Compute units"
                lede="Machine time is metered in compute hours. One base compute hour is one hour of the smallest machine Karo runs, and a bigger machine does not get a different price list — it burns the same budget faster, by a multiplier you can compute yourself."
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="flex flex-col gap-3">
                    <Panel title="The base unit">
                      <dl>
                        <SpecRow label="vCPU" value={`${BASE_COMPUTE_UNIT.cpuCores} shared`} />
                        <SpecRow label="RAM" value={`${BASE_COMPUTE_UNIT.memoryMb} MB`} />
                        <SpecRow label="System disk" value={`${BASE_COMPUTE_UNIT.diskGb} GB`} />
                      </dl>
                    </Panel>
                    <p className="rounded-md border border-line bg-bg-inset px-4 py-3 font-mono text-[13px] text-fg">
                      multiplier = (vCPU ÷ {BASE_COMPUTE_UNIT.cpuCores}) × (MB ÷{' '}
                      {BASE_COMPUTE_UNIT.memoryMb}) × provider
                    </p>
                  </div>

                  <div className="flex flex-col gap-3">
                    <DiamondList
                      items={[
                        'The provider factor is 1.0 on Karo Cloud, varies for external providers, and is exactly 0 on your own server — that compute is metered so you can see it, and charged nothing.',
                        'Disk is billed as storage, separately. It is not part of the multiplier.',
                        'The multiplier is shown before a sandbox starts and again on every usage row, so a compute-hour allowance is never a surprise after the fact.',
                      ]}
                    />
                    <Panel title="Worked example: 0.5 vCPU, 1 GB">
                      <p className="font-mono text-[12.5px] leading-relaxed text-muted">
                        {SMALL_MACHINE.explanation}
                      </p>
                      <p className="mt-2 text-[12.5px] leading-relaxed text-subtle">
                        Ten wall-clock hours of building on that machine spends{' '}
                        <span className="karo-numeric">{SMALL_MACHINE.value * 10}</span> compute
                        hours. The figure comes from the same function that settles a real run.
                      </p>
                    </Panel>
                  </div>
                </div>
              </DocSection>

              <GroupLabel>Using the agent</GroupLabel>

              <DocSection
                id="agent-modes"
                title="Agent modes"
                lede="The mode is a cap, applied on top of the project’s permission matrix. It can only ever narrow what the agent may do, never widen it — so switching to Auto on a project that forbids git push still cannot push. Switch with /mode; the new cap applies from your next message rather than retroactively."
              >
                <Table
                  className="min-w-[32rem]"
                  containerClassName="rounded-lg border border-line bg-surface"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mode</TableHead>
                      <TableHead>Shorthand</TableHead>
                      <TableHead>What it may do</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {AGENT_MODES.map((mode) => (
                      <TableRow key={mode}>
                        <TableCell className="font-medium text-fg">
                          {AGENT_MODE_META[mode].label}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" size="sm">
                            {AGENT_MODE_META[mode].short}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted">
                          {AGENT_MODE_META[mode].description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Panel title="What each mode forces off">
                    <dl>
                      <SpecRow label="Ask" value="Writes, commands, installs, git, Docker" />
                      <SpecRow label="Plan" value="Writes, deletes, installs, git" />
                      <SpecRow label="Build" value="Auto-approving edits" />
                      <SpecRow label="Auto" value="Nothing — the project decides" />
                    </dl>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                      Plan keeps commands on purpose: reading a codebase properly means running
                      a search and reading test output. It simply cannot write the result down.
                    </p>
                  </Panel>
                  <div className="flex flex-col gap-3">
                    <p className="text-[14px] leading-relaxed text-muted">
                      Build is the mode to stay in. The agent works, runs commands and proposes
                      diffs, and you approve them file by file. Auto is for tasks you have
                      already scoped — it applies edits without asking, which is why
                      auto-approval is a permission you turn on deliberately per project.
                    </p>
                    <div>
                      <Button asChild variant="outline" size="sm">
                        <Link href="/features#agent">The full permission matrix</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </DocSection>

              <DocSection
                id="slash-commands"
                title="Slash commands"
                lede="Typed in the chat composer. These are the built-ins; skills register more, and /help lists everything available in the current project with the skill each extra command came from beside it."
              >
                {SLASH_BY_GROUP.map((bucket) => (
                  <div key={bucket.group} className="flex flex-col gap-2">
                    <h3 className="text-[14px] font-semibold text-fg">{bucket.group}</h3>
                    <Table
                      className="min-w-[34rem]"
                      containerClassName="rounded-lg border border-line bg-surface"
                    >
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[16rem]">Command</TableHead>
                          <TableHead>What it does</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bucket.commands.map((command) => (
                          <TableRow key={command.command}>
                            <TableCell className="align-top">
                              <code className="font-mono text-[12.5px] font-medium text-primary">
                                {command.command}
                              </code>
                              {command.args ? (
                                <span className="ml-1.5 font-mono text-[12px] text-subtle">
                                  {command.args}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-muted">{command.description}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </DocSection>

              <DocSection
                id="terminal"
                title="Terminal"
                lede="Not a log of what the agent did — the same PTY it is typing into, streamed to your browser over server-sent events. You can take it over mid-run, run your own command, and hand it back."
              >
                <div className="grid items-start gap-6 lg:grid-cols-2">
                  <DiamondList
                    items={[
                      'Full PTY semantics: colours, cursor addressing, interactive prompts, Ctrl-C, and a resize on every window change.',
                      'bash, sh, PowerShell and cmd, chosen per project or per session with /terminal.',
                      'Sessions survive a page reload — reconnect and the scrollback is still there. Background processes keep running when you close the tab.',
                      'Every command is classified before it executes: allow, confirm or deny. Confirmations appear in the conversation, not as a modal you will click through.',
                      'Denials are absolute, not a stronger confirmation. Mounting the host Docker socket, sharing a host namespace, reaching a cloud metadata endpoint or deleting the filesystem root offer no approval at all.',
                      'Output is redacted for known secret values before it goes back to the model — the same guard that blunts prompt injection through tool results.',
                    ]}
                  />

                  <div className="flex flex-col gap-3">
                    <TerminalPanel
                      lines={TERMINAL_TRANSCRIPT}
                      title="bash — node project"
                      label="Sandbox shell transcript: the agent installs dependencies, runs one test file, commits the change, and then has a recursive delete held for confirmation."
                    />
                    <p className="text-[12.5px] leading-relaxed text-subtle">
                      The last line is the command policy at work. A recursive delete is
                      legitimate often enough to allow, and dangerous enough to ask about, so it
                      is held for an explicit approval even when the project auto-approves
                      commands.
                    </p>
                  </div>
                </div>
              </DocSection>

              <GroupLabel>Extending</GroupLabel>

              <DocSection
                id="mcp"
                title="MCP servers"
                lede="Karo is a Model Context Protocol client. Any server that speaks the protocol can expose its tools to the agent: over stdio inside the sandbox, or over HTTP and SSE from anywhere you can reach."
              >
                <div className="grid items-start gap-6 lg:grid-cols-2">
                  <DiamondList
                    items={[
                      'Add a server from a template or by hand. Karo connects, lists its tools and shows you each tool’s schema before any of them is allowed.',
                      'Allow tools individually. A server with twelve tools can be reduced to the two you actually want; an empty allow-list means every tool it discovered.',
                      'Mark a server as requiring approval and every one of its calls pauses for you. New servers require approval by default.',
                      'Scope a server to one project or to the whole account. Credentials are encrypted per team and injected into the server process, never into the transcript or the model’s context.',
                      'HTTP and SSE endpoints are SSRF-checked before the connection and again after any redirect.',
                      'Connection status, latency and the last error are visible per server, and a server that fails degrades its own tools rather than the whole run.',
                    ]}
                  />

                  <div className="flex flex-col gap-3">
                    <CodeBlock
                      code={MCP_STDIO_CONFIG}
                      language="json"
                      filename="POST /api/mcp"
                    />
                    <p className="text-[12.5px] leading-relaxed text-subtle">
                      An <Mono>env</Mono> entry marked <Mono>secret</Mono> is encrypted before
                      the insert and decrypted only when the server process starts, where it is
                      injected into that process’s environment — never into a log line or the
                      model’s context. A stdio server inherits nothing else: only{' '}
                      <Mono>PATH</Mono> and the variables you configured. How many servers you
                      may connect is a plan limit.
                    </p>
                  </div>
                </div>
              </DocSection>

              <DocSection
                id="skills"
                title="Skills"
                lede="A skill changes how the agent thinks. It is a block of instructions concatenated into the system prompt verbatim while it is enabled, plus the slash commands it registers and the tools it is allowed to use. No code runs."
              >
                <div className="grid items-start gap-6 lg:grid-cols-2">
                  <div className="flex flex-col gap-4">
                    <DiamondList
                      items={[
                        'Enable a skill for the whole account or for one project, and toggle it for a single conversation with /skills.',
                        'A skill may narrow the tools available while it runs — the eight built-ins are list_files, read_file, write_file, edit_file, delete_file, search_files, run_command and web_fetch — but never widen beyond what the project already permits.',
                        'A skill can declare the plugins it needs and the environment values it expects. Anything marked secret is encrypted at rest and injected at run time.',
                        'Slash commands a skill registers show up in /help beside the skill they came from, so an unfamiliar command is always traceable.',
                        'Official skills ship with Karo. On plans that allow private skills you can author your own and they stay inside your team.',
                      ]}
                    />
                    <div>
                      <Button asChild variant="outline" size="sm">
                        <Link href="/features#skills">Skills and plugins compared</Link>
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <CodeBlock
                      code={SKILL_DOCUMENT}
                      language="json"
                      filename="migration-reviewer.skill.json"
                      maxHeight={420}
                    />
                    <p className="text-[12.5px] leading-relaxed text-subtle">
                      This is the export format, and what the import dialog accepts — paste the
                      document or upload the file. Skills are written as instructions to the
                      agent, so the <Mono>instructions</Mono> field is the whole substance and
                      it reaches the model exactly as written.
                    </p>
                  </div>
                </div>
              </DocSection>

              <DocSection
                id="plugins"
                title="Plugins"
                lede="A plugin changes what the sandbox contains. It installs a runtime or a toolchain into the machine and declares, before you install it, every permission it wants. Keeping that separate from skills is what makes an extension system auditable."
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <DiamondList
                    items={[
                      'Every declared permission carries a risk level and must be granted explicitly — installing is a decision about a listed set of capabilities, not a single yes.',
                      'A plugin can require configuration. Fields marked secret are encrypted at rest and injected into the sandbox only while the plugin runs.',
                      'Plugins add tools and slash commands, both listed on the plugin before you install and afterwards under /plugins.',
                      'Some plugins have a minimum plan: rootless Docker needs headroom a 512 MB machine does not have, which is why it starts at Pro rather than being sold as an add-on.',
                      'Health, version and the last error are visible per installation, and upgrading re-runs the install against the catalogue’s current version.',
                    ]}
                  />

                  <Panel title="What a plugin declares up front">
                    <dl>
                      <SpecRow label="Permissions" value="Each with a risk level" />
                      <SpecRow label="Configuration" value="Typed fields, secrets flagged" />
                      <SpecRow label="Tools provided" value="Named, before install" />
                      <SpecRow label="Commands provided" value="Named, before install" />
                      <SpecRow label="Minimum plan" value="Per plugin" />
                      <SpecRow label="Privileged" value="Refused by command policy" />
                    </dl>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                      A plugin cannot ask for privileges the sandbox does not have. A container
                      started with <Mono>--privileged</Mono> is denied by the command policy no
                      matter which plugin asked for it.
                    </p>
                  </Panel>
                </div>
              </DocSection>

              <GroupLabel>Bring your own</GroupLabel>

              <DocSection
                id="byok"
                title="Model keys"
                lede="Add your own provider key and Karo stops charging you for tokens. The provider bills you directly, the usage is still recorded so you can see it, and none of it touches your plan allowance. Available on every plan, including pay as you go."
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <DiamondList
                    items={[
                      'The plaintext key is encrypted with AES-256-GCM before the insert and never read back into a response. The last four characters are the only fragment that reaches a browser again.',
                      'A duplicate is detected by fingerprint rather than by comparing plaintext, so “you already added this key” costs nothing in exposure.',
                      'Keys are verified against the provider when you add them, and the last verification result and error are shown on the key.',
                      'A custom base URL is allowed for gateways and self-hosted endpoints. It is SSRF-checked before Karo will call it.',
                      'Requests made with your key are marked BYOK on the usage row, so a month’s spend separates cleanly into “billed by Karo” and “billed by your provider”.',
                    ]}
                  />

                  <Panel title="What Karo charges on a BYOK request">
                    <dl>
                      <SpecRow label="Model tokens" value="Nothing" />
                      <SpecRow label="Plan allowance" value="Untouched" />
                      <SpecRow label="Compute" value="Metered and charged as usual" />
                      <SpecRow label="Recorded in usage" value="Yes, flagged BYOK" />
                    </dl>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                      The machine is still Karo&rsquo;s unless you also bring your own server.
                      Bring both and a run costs you nothing at all here.
                    </p>
                  </Panel>
                </div>
              </DocSection>

              <DocSection
                id="byos"
                title="Your own server"
                lede="Run the sandboxes on hardware you own. The worker dials Karo and long-polls for work, so there is no inbound connection, no open port and no exposed Docker socket — the same security model a CI runner uses."
              >
                <Steps
                  items={[
                    <>
                      Generate a one-time installation token from Settings. It is valid once and
                      only for the first machine that presents it.
                    </>,
                    <>
                      Run the install command on your server. The worker registers over HTTPS,
                      reports its CPU, memory and disk, and burns the installation token in the
                      same request — two machines racing the same token cannot both come away
                      registered.
                    </>,
                    <>
                      It exchanges that token for a long-lived worker token and presents it as{' '}
                      <Mono>Authorization: Bearer</Mono> on every later call. Karo stores only
                      the SHA-256 of both, so a database dump cannot be replayed against your
                      machine.
                    </>,
                    <>
                      From then on the worker long-polls for commands and heartbeats every 20
                      seconds. Miss enough heartbeats and Karo marks it offline and schedules
                      elsewhere rather than hanging on it.
                    </>,
                    <>
                      Rotate to issue a fresh installation token for the same machine, or revoke
                      to invalidate both tokens immediately and fail every command in flight.
                    </>,
                  ]}
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="flex flex-col gap-3">
                    <CodeBlock
                      code={WORKER_INSTALL}
                      language="bash"
                      filename="run on your server"
                    />
                    <p className="text-[12.5px] leading-relaxed text-subtle">
                      Settings prints this command with the token and your host already filled
                      in. Copy it from there rather than assembling it by hand — the token is
                      shown once.
                    </p>
                  </div>

                  <Panel title="What the worker needs">
                    <dl>
                      <SpecRow label="Inbound ports" value="None" />
                      <SpecRow label="Outbound" value="443 to your Karo host" />
                      <SpecRow label="Runtime" value="Docker or Podman, rootless supported" />
                      <SpecRow label="Minimum" value="2 vCPU · 4 GB · 40 GB disk" />
                      <SpecRow label="Platforms" value="Linux amd64 and arm64" />
                      <SpecRow label="Compute charged" value="Zero" />
                    </dl>
                  </Panel>
                </div>
              </DocSection>

              <GroupLabel>Operations</GroupLabel>

              <DocSection
                id="billing"
                title="Billing and usage"
                lede="Two units — weighted tokens for the model, compute hours for the machine. Both are estimated before an expensive run, shown live while it happens, and itemised per request afterwards. Nothing is settled silently."
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <DiamondList
                    items={[
                      'A subscription bundles an allowance of both units. Weighted tokens come out of the allowance first, and anything past it is billed at the plan’s published overage rate.',
                      'A plan that publishes no rate bills overage at upstream cost plus the platform margin — that is what a zero in the pricing table means, not “free”.',
                      'Pay as you go bundles nothing: every request is upstream cost plus a flat margin, drawn from a balance you top up.',
                      'All money is stored as integer micro-USD. There is no floating-point currency anywhere in the billing path, so a sub-cent charge is never rounded away.',
                      'Spend guards check an estimate against your allowance, balance, credit limit and monthly cap before a run starts. A refused run costs nothing.',
                      'Usage exports as CSV, and every charge links back to the conversation that caused it. /cost itemises the current conversation; /usage reports the team’s period.',
                    ]}
                  />

                  <div className="flex flex-col gap-3">
                    <Panel title="Guard outcomes and what fixes each">
                      <dl>
                        <SpecRow label="Monthly allowance spent" value="Top up or upgrade" />
                        <SpecRow label="Balance too low" value="Add credit" />
                        <SpecRow label="Spending cap reached" value="Raise the cap or wait" />
                        <SpecRow label="Subscription needs attention" value="Update the card" />
                      </dl>
                      <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                        Each one names the limit it hit and links to the screen that changes it.
                        All four appear before the money is spent, not on an invoice afterwards.
                      </p>
                    </Panel>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href="/pricing">Plans and limits</Link>
                      </Button>
                      <Button asChild variant="ghost" size="sm">
                        <Link href="/pricing#estimator">Estimate a month</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </DocSection>

              <DocSection
                id="security"
                title="Security"
                lede="Handing an agent a shell is only reasonable if the shell is boxed in and everything it does is recorded. These are the controls that apply to the agent itself; the platform, secret and access controls are on the security page in full."
              >
                <ul className="grid gap-3 sm:grid-cols-2">
                  {controlsInGroup('agent').map((control) => (
                    <li
                      key={control.id}
                      className="rounded-lg border border-line bg-surface p-4"
                    >
                      <h3 className="text-[13.5px] font-semibold text-fg">{control.title}</h3>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                        {control.body}
                      </p>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center gap-3">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/security">Full security posture</Link>
                  </Button>
                  <p className="text-[12.5px] text-subtle">
                    Including encryption, audit retention, responsible disclosure and what Karo
                    does not have yet.
                  </p>
                </div>
              </DocSection>

              <DocSection
                id="api"
                title="API"
                lede="The REST surface is the one the workspace itself calls, so anything you can do in the interface can be driven from a script. Programmatic access is a plan feature — it is available on Scale and Ultra."
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <Panel title="Calling it">
                    <dl>
                      <SpecRow label="Content type" value="application/json" />
                      <SpecRow label="Authentication" value="Karo session, team-scoped" />
                      <SpecRow label="Mutations also need" value={CSRF_HEADER} />
                      <SpecRow label="Streaming" value="text/event-stream" />
                      <SpecRow label="Rate limits" value="Per route, per bucket" />
                      <SpecRow label="Errors" value="One envelope, every route" />
                    </dl>
                    <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                      Non-GET requests carry a CSRF token issued to the session in the{' '}
                      <Mono>{CSRF_HEADER}</Mono> header, so a cross-site form post cannot
                      satisfy the check. Rate-limit state comes back on every response as{' '}
                      <Mono>x-ratelimit-limit</Mono>, <Mono>x-ratelimit-remaining</Mono> and{' '}
                      <Mono>x-ratelimit-reset</Mono>.
                    </p>
                  </Panel>

                  <div className="flex flex-col gap-3">
                    <CodeBlock
                      code={API_CALL}
                      language="bash"
                      filename="usage for the period"
                    />
                    <CodeBlock
                      code={API_ERROR}
                      language="json"
                      filename="error envelope — 429"
                    />
                  </div>
                </div>

                <Table
                  className="min-w-[36rem]"
                  containerClassName="rounded-lg border border-line bg-surface"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[5rem]">Method</TableHead>
                      <TableHead className="w-[20rem]">Path</TableHead>
                      <TableHead>What it does</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {API_ENDPOINTS.map((endpoint) => (
                      <TableRow key={`${endpoint.method} ${endpoint.path}`}>
                        <TableCell className="align-top">
                          <Badge variant={METHOD_VARIANT[endpoint.method]} size="sm">
                            {endpoint.method}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top">
                          <code className="font-mono text-[12.5px] break-all text-fg">
                            {endpoint.path}
                          </code>
                        </TableCell>
                        <TableCell className="text-muted">{endpoint.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <p className="text-[13px] leading-relaxed text-subtle">
                  Errors always arrive as <Mono>{'{ error: { code, title, message } }'}</Mono>{' '}
                  with the machine-readable code repeated in the <Mono>x-karo-error-code</Mono>{' '}
                  header, and a <Mono>retry-after</Mono> header whenever waiting is the right
                  response. Every mutation is written to the audit log with the actor, the
                  resource and the calling IP.
                </p>
              </DocSection>

              <div className="rounded-lg border border-line bg-bg-inset p-5">
                <h2 className="text-lg">Still stuck</h2>
                <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted">
                  The demo is usually the fastest answer: it is the whole product on mock
                  providers, so you can try the thing you are unsure about on seeded data. If
                  the question is about your own account or a charge you did not expect, email
                  support and quote the conversation — every charge links back to one.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href="/login?demo=1">Open the demo</Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/features">How each part works</Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <a href={`mailto:${siteConfig.contact.support}`}>Email support</a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
