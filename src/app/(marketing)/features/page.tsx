import { Check, Minus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { LatticeBackdrop } from '@/components/brand/lattice';
import { SectionNav } from '@/components/marketing/anchor-nav';
import { IsolationDiagram } from '@/components/marketing/isolation-diagram';
import { breadcrumbJsonLd, JsonLd, webPageJsonLd } from '@/components/marketing/json-ld';
import {
  CONTAINER,
  DiamondList,
  Section,
  SectionIntro,
  SpecRow,
} from '@/components/marketing/section';
import { SECURITY_CONTROLS } from '@/components/marketing/security-controls';
import { TerminalPanel } from '@/components/marketing/terminal-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AGENT_MODE_META,
  AGENT_MODES,
  AGENT_PERMISSION_META,
  type AgentPermissionKey,
} from '@/lib/agent/policy';
import { buildMetadata } from '@/lib/metadata';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, TEAM_ROLES } from '@/lib/rbac/permissions';

export const metadata: Metadata = buildMetadata({
  title: 'Features',
  description:
    'Agent modes, a real terminal, isolated sandboxes, reviewable diffs, MCP servers, skills, plugins, rootless Docker, bring-your-own-server and per-token metering — how each one actually works.',
  path: '/features',
});

const NAV = [
  { id: 'agent', label: 'Agent modes' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'sandbox', label: 'Sandboxes' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'models', label: 'Models' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: 'Skills' },
  { id: 'docker', label: 'Docker' },
  { id: 'byos', label: 'Your server' },
  { id: 'metering', label: 'Metering' },
  { id: 'security', label: 'Security' },
  { id: 'team', label: 'Team' },
] as const;

/**
 * Page copy that replaces the shared permission descriptions from
 * `@/lib/agent/policy` for two switches whose in-app wording would overpromise
 * on a public page. The sandbox network Karo ships in `docker-compose.yml` is
 * declared `internal: true`, so Docker gives it no gateway and no MASQUERADE
 * rule and a container on it has no route off the host. The switches are still
 * enforced — `evaluateCommand` denies a matching command outright when they are
 * off — but a permitted request only reaches something if the operator has
 * attached a network that can carry it.
 */
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  networkAccess:
    'Permit outbound requests from inside the sandbox. Karo enforces the switch either way; whether the traffic leaves is the operator’s decision, because the sandbox network Karo ships is internal and has no route off the host until an egress-capable network is attached to it.',
  installPackages:
    'Permit npm, pip, apt and similar package managers. They need a registry to reach, so on the internal sandbox network Karo ships an install only succeeds against a mirror the operator has made reachable.',
} satisfies Partial<Record<AgentPermissionKey, string>>;

const TERMINAL_TRANSCRIPT = [
  { kind: 'cmd' as const, text: 'python -m venv .venv && . .venv/bin/activate' },
  { kind: 'cmd' as const, text: 'pip install -q fastapi uvicorn httpx' },
  {
    kind: 'out' as const,
    text: 'Successfully installed fastapi-0.118.0 httpx-0.28.1 uvicorn-0.38.0',
  },
  { kind: 'cmd' as const, text: 'uvicorn app.main:app --host 0.0.0.0 --port 8000 &' },
  { kind: 'ok' as const, text: 'INFO:     Uvicorn running on http://0.0.0.0:8000' },
  { kind: 'cmd' as const, text: 'curl -s :8000/items?limit=2 | jq ".items | length"' },
  { kind: 'ok' as const, text: '2' },
  { kind: 'cmd' as const, text: 'sudo apt-get install -y anything' },
  {
    kind: 'warn' as const,
    text: 'confirm required: elevates privileges — approve in chat to continue',
  },
];

const MCP_CONFIG = `{
  "name": "Internal search",
  "transport": "http",
  "url": "https://mcp.internal.example.com/v1",
  "headers": { "Authorization": "Bearer \${MCP_TOKEN}" },
  "allowedTools": ["search_documents", "get_document"],
  "requireApproval": true
}`;

const SKILL_SNIPPET = `---
name: Migration Reviewer
category: databases
allowedTools: [read_file, search_files, run_command]
---

Before proposing any schema change, read every migration already in
the repository and the ORM model it maps to. State which tables the
change locks and for how long. Never write a destructive migration
without an explicit, reversible down step — and say so out loud when
one is not possible.

Run the project's migration dry-run command before reporting back.`;

export default function FeaturesPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            name: 'Karo features',
            description:
              'How Karo’s agent modes, terminal, sandboxes, models, MCP support, skills, Docker, bring-your-own-server, metering and security controls work.',
            path: '/features',
          }),
          breadcrumbJsonLd([{ name: 'Features', path: '/features' }]),
        ]}
      />

      <section className="relative isolate overflow-hidden">
        <LatticeBackdrop fade="top" opacity={50} />
        <div className={`${CONTAINER} pt-14 pb-10 sm:pt-20`}>
          <SectionIntro
            eyebrow="Features"
            title="Everything the agent can do, and the limits on each."
            description="Karo is one product with a small number of parts that fit together: a model, a machine, a permission system and a meter. This page describes each part in the terms you will meet it in."
            as="h1"
          />
        </div>
      </section>

      <SectionNav items={NAV} />

      {/* ---------------------------------------------------------- */}
      <Section id="agent" divider={false}>
        <SectionIntro
          eyebrow="Agent modes"
          title="Four modes, from a conversation to an autonomous run."
          description="The mode is a cap on what the agent may do, applied on top of the project's permission matrix. It can only ever narrow permissions, never widen them."
        />

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AGENT_MODES.map((mode) => (
            <Card key={mode} className="h-full">
              <CardContent className="flex h-full flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-[14px] font-semibold text-fg">
                    {AGENT_MODE_META[mode].label}
                  </h3>
                  <Badge variant="outline" size="sm">
                    {AGENT_MODE_META[mode].short}
                  </Badge>
                </div>
                <p className="text-[13px] leading-relaxed text-muted">
                  {AGENT_MODE_META[mode].description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <h3 className="mt-10 text-lg">The per-project permission matrix</h3>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
          Each project carries its own switches. A teammate with full team permissions still
          cannot make the agent push to a remote if this project forbids it.
        </p>

        <Table
          className="mt-4 min-w-[34rem]"
          containerClassName="rounded-lg border border-line bg-surface"
        >
          <TableHeader>
            <TableRow>
              <TableHead>Permission</TableHead>
              <TableHead>What it allows</TableHead>
              <TableHead className="text-right">Risk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(AGENT_PERMISSION_META).map(([key, meta]) => (
              <TableRow key={key}>
                <TableCell className="font-medium text-fg">{meta.label}</TableCell>
                <TableCell className="text-muted">
                  {PERMISSION_DESCRIPTIONS[key] ?? meta.description}
                </TableCell>
                <TableCell className="text-right">
                  <Badge
                    size="sm"
                    variant={
                      meta.risk === 'high'
                        ? 'danger'
                        : meta.risk === 'medium'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {meta.risk}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="terminal" tone="inset">
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-6">
            <SectionIntro
              eyebrow="Terminal"
              title="A shell you and the agent share."
              description="The terminal is not a log of what the agent did. It is the same PTY the agent is typing into, streamed to your browser over server-sent events, and you can take it over mid-run."
            />
            <DiamondList
              items={[
                'Full PTY semantics: colours, cursor addressing, interactive prompts, Ctrl-C, resize on window change.',
                'Sessions survive a page reload. Reconnect and the scrollback is still there.',
                'bash, sh, PowerShell and cmd, chosen per project or per session.',
                'Background processes keep running when you close the tab; the sandbox only sleeps when it is genuinely idle.',
                'Every command is classified before execution — allow, confirm or deny — and confirmations appear in chat, not as a modal you will click through.',
              ]}
            />
          </div>

          <TerminalPanel
            lines={TERMINAL_TRANSCRIPT}
            title="bash — python project"
            label="Terminal session: creating a virtualenv, installing FastAPI, starting uvicorn, curling the API, and a privileged apt-get command that requires confirmation."
          />
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="sandbox">
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-6">
            <SectionIntro
              eyebrow="Sandboxes"
              title="One machine per project, with a lifecycle you control."
              description="A sandbox is created with the project, sleeps when idle, wakes on the next command, and is destroyed when you delete the project or its retention window expires."
            />
            <DiamondList
              items={[
                'Providers: Karo Cloud, a remote Docker host, Daytona, your own worker, or the in-process mock used by demo mode.',
                'Wake from sleep takes roughly four seconds; the state of /workspace is preserved across sleeps.',
                'Storage is a persistent volume sized by your plan and counted against the plan storage quota.',
                'Metrics — CPU, memory, disk, uptime — stream while the sandbox runs and are recorded for usage.',
                'Failure states are explicit: starting, sleeping, failed and destroyed each have their own message and their own next step.',
              ]}
            />
          </div>

          <IsolationDiagram />
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="workspace" tone="inset">
        <SectionIntro
          eyebrow="Workspace"
          title="Chat, editor, diffs and preview in one window."
          description="The workspace is a small IDE rather than a chat box with an attachment. Everything the agent touches is visible in the same place you would look for it yourself."
        />

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: 'File tree and editor',
              body: 'Monaco with the project’s real files. Open anything the agent mentions, edit it yourself, and your change is what the agent reads next.',
            },
            {
              title: 'Reviewable diffs',
              body: 'Proposed changes arrive as a pending diff per file. Approve, reject or edit before applying. Nothing is written to the workspace until you say so.',
            },
            {
              title: 'Preview pane',
              body: 'A sandboxed frame beside the conversation, at mobile, tablet or desktop width, pointed at whatever the sandbox is serving. You give it the address; Karo does not yet publish a port for you.',
            },
            {
              title: 'Conversations that compact',
              body: 'Long threads are summarised on demand rather than silently truncated, and the summary is visible so you can see what was dropped.',
            },
            {
              title: 'Tool calls you can inspect',
              body: 'Every call expands to show its arguments, its result and how long it took. Approvals for risky calls happen inline.',
            },
            {
              title: 'Telemetry while it runs',
              body: 'Tokens, weighted tokens, cost and compute tick up live in the rail beside the conversation — not after the fact on a billing page.',
            },
          ].map((item) => (
            <Card key={item.title} className="h-full">
              <CardContent className="flex h-full flex-col gap-2">
                <h3 className="text-[14px] font-semibold text-fg">{item.title}</h3>
                <p className="text-[13px] leading-relaxed text-muted">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-8 max-w-xl rounded-lg border border-line bg-surface p-4">
          <h3 className="text-[14px] font-semibold text-fg">Approval flow</h3>
          <dl className="mt-2">
            <SpecRow label="File edits" value="Reviewed per file, then applied" />
            <SpecRow label="Destructive commands" value="Denied by policy" />
            <SpecRow label="Privileged commands" value="Confirmed in chat" />
            <SpecRow label="Auto-approve" value="Opt-in, per project" />
            <SpecRow label="Rollback" value="Reject restores the previous file" />
          </dl>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="models">
        <SectionIntro
          eyebrow="Models"
          title="Any model in the catalogue, or your own key."
          description="The model is a setting, not an architecture decision. Change it per project, per conversation or per message."
        />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <DiamondList
            items={[
              'Most of the catalogue, the default model included, is available on pay as you go. Some models are gated by tier: the Claude Opus generations and the largest open-weight reasoning models need Lite, and Claude Fable 5, Gemini 3.1 Pro Preview and Grok 4.5 need Pro.',
              'Prompt caching is used automatically where the model supports it, which is why cached reads dominate a long conversation.',
              'Bring your own key and those tokens are billed by your provider. They never draw down your allowance and are marked BYOK in usage.',
              'The catalogue syncs on a schedule; a model withdrawn upstream is disabled rather than deleted so historical usage still resolves.',
            ]}
          />
          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-fg">How a request is settled</h3>
            <ol className="mt-3 flex flex-col gap-2.5">
              {[
                'Your own key was used — Karo charges nothing and touches no allowance.',
                'Otherwise, weighted tokens come out of the plan allowance first.',
                'Anything past the allowance is billed at the plan’s published overage rate.',
                'If the plan publishes no rate, overage is upstream cost plus the platform margin.',
              ].map((step, index) => (
                <li key={step} className="flex gap-2.5 text-[13px] leading-relaxed text-muted">
                  <span className="karo-numeric shrink-0 text-subtle">{index + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/pricing#weighted-tokens">Weighted tokens, in full</Link>
            </Button>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="mcp" tone="inset">
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-6">
            <SectionIntro
              eyebrow="MCP"
              title="Bring your own tools over an open protocol."
              description="Karo is an MCP client. Any server that speaks the protocol — over stdio inside the sandbox, or over HTTP and SSE from anywhere — can expose tools to the agent."
            />
            <DiamondList
              items={[
                'Add a server from a template or by hand. Karo connects, lists its tools and shows you each tool’s schema before anything is allowed.',
                'Allow tools individually. A server with twelve tools can be reduced to the two you actually want.',
                'Mark a server as requiring approval and every one of its calls pauses for you.',
                'Credentials are encrypted per team and injected into the server process — never into the transcript, never into the model’s context.',
                'HTTP servers are SSRF-checked before connection and again after any redirect.',
                'Connection health, latency and last error are visible, and a failed server degrades that one tool rather than the whole run.',
              ]}
            />
          </div>

          <div className="flex flex-col gap-3">
            <CodeBlock code={MCP_CONFIG} language="json" filename="mcp-server.json" />
            <p className="text-[12.5px] leading-relaxed text-subtle">
              Environment placeholders are resolved from the team’s encrypted secret store at
              connection time. The literal token never appears in a config file, a log line or a
              conversation.
            </p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="skills">
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-6">
            <SectionIntro
              eyebrow="Skills and plugins"
              title="Two different things, deliberately kept apart."
              description="A skill changes how the agent thinks. A plugin changes what the sandbox contains. Confusing the two is how extension systems become unauditable."
            />
            <DiamondList
              items={[
                'A skill is a system-prompt fragment concatenated verbatim when it is enabled, plus the slash commands it registers and the tools it is allowed to use.',
                'A skill can narrow the tools available during its run, but never widen beyond what the project already permits.',
                'A plugin installs a runtime or a toolchain into the sandbox and declares its permissions — package installs, network egress, process spawning, disk writes — before you install it.',
                'Plugins can require configuration, and any secret among it is stored encrypted and injected at runtime.',
                'Official skills and plugins ship with Karo. On plans that allow it, you can author private ones that stay inside your team.',
              ]}
            />
            <div>
              <Button asChild variant="outline">
                <Link href="/docs#skills">Writing a skill</Link>
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <CodeBlock
              code={SKILL_SNIPPET}
              language="markdown"
              filename="migration-reviewer.skill.md"
            />
            <p className="text-[12.5px] leading-relaxed text-subtle">
              Skills are written as instructions to the agent, not as code. The front matter
              declares the metadata; everything below it goes into the system prompt exactly as
              written.
            </p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="docker" tone="inset">
        <SectionIntro
          eyebrow="Docker"
          title="Rootless containers inside the sandbox."
          description="Docker support is a plugin. It installs a rootless daemon inside the sandbox, in its own user namespace, with no route back to the host."
        />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <DiamondList
            items={[
              'The host Docker socket is never bind-mounted into a sandbox. It is not present in the filesystem at all.',
              'docker build, docker run and docker compose behave normally, including health checks and named volumes.',
              'Images and layers live in the sandbox volume and count against project storage — no shared cache between tenants.',
              'Registry credentials are encrypted per team and injected only for the duration of a pull.',
            ]}
          />
          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-fg">Plan availability</h3>
            <dl className="mt-2">
              <SpecRow label="Pay as you go" value={<Minus className="size-4 text-subtle" />} />
              <SpecRow label="Lite" value={<Minus className="size-4 text-subtle" />} />
              <SpecRow
                label="Pro and above"
                value={<Check className="size-4 text-primary" />}
              />
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
              Rootless Docker needs headroom that a 512 MB machine does not have, which is why
              it starts at Pro rather than being sold as an add-on.
            </p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="byos">
        <SectionIntro
          eyebrow="Bring your own server"
          title="Outbound only, on hardware you own."
          description="The worker dials Karo and long-polls for work. There is no inbound connection, no open port and no exposed Docker socket — the security model is the same one a CI runner uses."
        />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <DiamondList
            items={[
              'A single-use install token is exchanged once for a long-lived worker token, then burned.',
              'The worker reports capabilities, CPU, memory and disk on registration, and heartbeats with live metrics after that.',
              'Miss enough heartbeats and Karo marks the worker offline and schedules elsewhere; nothing hangs waiting for it.',
              'Compute on your hardware is metered so you can see it in usage, and billed at exactly zero.',
              'Rotate or revoke a worker token from the dashboard; the worker stops receiving commands immediately.',
              'Available on every plan, including pay as you go.',
            ]}
          />
          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-fg">What the worker needs</h3>
            <dl className="mt-2">
              <SpecRow label="Inbound ports" value="None" />
              <SpecRow label="Outbound" value="443 to your Karo host" />
              <SpecRow label="Runtime" value="Docker or Podman, rootless supported" />
              <SpecRow label="Minimum" value="2 vCPU · 4 GB · 40 GB disk" />
              <SpecRow label="Platforms" value="Linux amd64 and arm64" />
              <SpecRow label="Privileges" value="No root required for the agent" />
            </dl>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="metering" tone="inset">
        <SectionIntro
          eyebrow="Metering"
          title="Two units, both visible while a run is happening."
          description="Weighted tokens for the model, compute hours for the machine. Both are estimated before an expensive run, shown live during it, and itemised afterwards."
        />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <DiamondList
            items={[
              'Every request records input, output, cached-read and cache-write tokens separately, with the multiplier that was applied to each.',
              'Compute accrues per second while a sandbox is awake, multiplied by the machine’s size factor.',
              'All money is stored as integer micro-USD, so a sub-cent charge is never rounded away.',
              'Spend guards check the estimate against your allowance, balance, credit limit and monthly cap before a run starts.',
              'Usage is exportable as CSV, and every charge links back to the conversation that caused it.',
            ]}
          />
          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-fg">Guard outcomes you may see</h3>
            <dl className="mt-2">
              <SpecRow label="Monthly allowance spent" value="Top up or upgrade" />
              <SpecRow label="Balance too low" value="Add credit" />
              <SpecRow label="Spending cap reached" value="Raise the cap or wait" />
              <SpecRow label="Subscription needs attention" value="Update payment method" />
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
              Each one names the limit that was hit and links straight to the screen that fixes
              it. None of them appear after the money is spent.
            </p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="security">
        <SectionIntro
          eyebrow="Security"
          title="Controls, not adjectives."
          description="A short list here; the full posture, including what Karo does not have yet, is on the security page."
        />
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY_CONTROLS.slice(0, 9).map((control) => (
            <li key={control.id} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-[13.5px] font-semibold text-fg">{control.title}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{control.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <Button asChild variant="outline">
            <Link href="/security">Full security posture</Link>
          </Button>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="team" tone="inset">
        <SectionIntro
          eyebrow="Team"
          title="Four roles, one permission table."
          description="Roles map to an explicit list of permissions, and every mutating endpoint checks it. There is no “admin can do anything” shortcut in the code."
        />

        <Table
          className="mt-6 min-w-[30rem]"
          containerClassName="rounded-lg border border-line bg-surface"
        >
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>What it can do</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TEAM_ROLES.map((role) => (
              <TableRow key={role}>
                <TableCell className="font-medium text-fg">{ROLE_LABELS[role]}</TableCell>
                <TableCell className="text-muted">{ROLE_DESCRIPTIONS[role]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-subtle">
          Seat counts are a plan limit. Platform administration is a separate role entirely and
          is what gates the admin console — a team owner is not a platform admin.
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href="/register">Start building</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login?demo=1">Try the demo</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
