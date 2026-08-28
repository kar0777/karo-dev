import { ArrowRight, Container, Lock, Radio, ShieldCheck, Ticket } from 'lucide-react';
import Link from 'next/link';

import { IsolationDiagram } from '@/components/marketing/isolation-diagram';
import { DiamondList, Section, SectionIntro, SpecRow } from '@/components/marketing/section';
import { TerminalPanel } from '@/components/marketing/terminal-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';

/* ------------------------------------------------------------------ *
 *  Landing sections 3–5 and 9: what the machine actually is.
 * ------------------------------------------------------------------ */

const AGENT_SHELL_TRANSCRIPT = [
  { kind: 'cmd' as const, text: 'ls src/app/api' },
  { kind: 'out' as const, text: 'auth  conversations  projects  sandboxes' },
  { kind: 'cmd' as const, text: 'pnpm vitest run health' },
  { kind: 'ok' as const, text: ' ✓ tests/unit/health.test.ts (4 tests) 118ms' },
  { kind: 'cmd' as const, text: 'curl -s localhost:3000/api/health | jq .status' },
  { kind: 'ok' as const, text: '"ok"' },
  { kind: 'cmd' as const, text: 'git diff --stat' },
  { kind: 'out' as const, text: ' src/app/api/health/route.ts | 28 ++++++++++++++' },
  { kind: 'out' as const, text: ' 1 file changed, 28 insertions(+)' },
  { kind: 'cmd' as const, text: 'rm -rf /' },
  {
    kind: 'err' as const,
    text: 'blocked by command policy: destructive_root — no confirmation offered',
  },
];

export function TerminalSection() {
  return (
    <Section id="terminal">
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col gap-6">
          <SectionIntro
            eyebrow="Agent and terminal"
            title="An AI agent with a real terminal."
            description="Most coding assistants can only suggest text. Karo's agent has a shell. It installs the dependency, runs the test, reads the stack trace, and tries again — in the same machine your project lives on, with you watching every line."
          />

          <DiamondList
            items={[
              'A live PTY you can type into. The agent and you share one session — interrupt it, run your own command, hand it back.',
              'bash, sh, PowerShell and cmd in every sandbox, so a Windows-shaped project does not have to be translated.',
              'Long-running processes are supported: start a dev server, keep it up, and open the port as a preview URL.',
              'Every command is classified before it runs. Destructive patterns are denied outright; borderline ones ask you first.',
              'Output is redacted for known secrets before it goes back to the model — the same guard that blunts prompt injection.',
            ]}
          />

          <div>
            <Button asChild variant="outline">
              <Link href="/docs#terminal">
                Terminal documentation
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        <TerminalPanel
          lines={AGENT_SHELL_TRANSCRIPT}
          label="Sandbox shell transcript: the agent lists API routes, runs the unit tests, curls the health endpoint, shows a one-file diff, and has an attempted rm -rf / denied by command policy."
        />
      </div>
    </Section>
  );
}

const ISOLATION_FACTS = [
  { label: 'Runtime', value: 'Rootless, unprivileged' },
  { label: 'Namespaces', value: 'PID · mount · net · user · IPC' },
  { label: 'Root filesystem', value: 'Read-only base image' },
  { label: 'Writable path', value: '/workspace only' },
  { label: 'Host Docker socket', value: 'Never mounted' },
  { label: 'Syscalls', value: 'seccomp profile, no CAP_SYS_ADMIN' },
  { label: 'Egress', value: 'Policy-checked, SSRF-guarded' },
  { label: 'Lifecycle', value: 'Sleeps when idle, destroyed on delete' },
];

export function SandboxSection() {
  return (
    <Section id="sandbox" tone="inset">
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
        <IsolationDiagram className="order-2 lg:order-1" />

        <div className="order-1 flex flex-col gap-6 lg:order-2">
          <SectionIntro
            eyebrow="Sandboxed computers"
            title="Every project gets its own machine, and it cannot reach yours."
            description="A sandbox is not a REPL in a web page. It is a real Linux container with its own namespaces, its own filesystem and its own network policy — created for one project, and destroyed with it."
          />

          <div className="rounded-lg border border-line bg-surface p-4">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-fg">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              Isolation properties
            </p>
            <dl>
              {ISOLATION_FACTS.map((fact) => (
                <SpecRow key={fact.label} label={fact.label} value={fact.value} />
              ))}
            </dl>
          </div>

          <p className="text-[13px] leading-relaxed text-subtle">
            The Karo web host never executes a user command. Everything goes through a sandbox
            provider — Karo Cloud, a remote Docker host, Daytona, or a worker you run yourself.
          </p>
        </div>
      </div>
    </Section>
  );
}

/**
 * The real install flow, copied from what the product actually prints.
 *
 * `buildInstallCommand` in `lib/account/byos.ts` emits exactly the one-liner
 * below, and `worker/karo-worker.mjs --help` documents the flags. An earlier
 * version of this block invented a signed binary at `karo.dev/dist`, a
 * `register --install-token` subcommand and an `install-service` subcommand —
 * none of which exist. Marketing copy that shows commands the product does not
 * accept is a support ticket with a countdown on it, so if the flow changes,
 * change it here too.
 *
 * Rotation is a dashboard action rather than a worker flag on purpose:
 * `POST /api/workers/[id]/rotate` is session-authenticated and CSRF-checked,
 * and it mints a fresh *install* token for the machine to redeem — not a worker
 * token the running process could swap in place.
 */
const BYOS_INSTALL = `# 1 · get a one-time install token in Settings → Servers,
#     then run the line Karo shows you
curl -fsSL https://get.karo.dev/worker.sh | sh -s -- \\
  --token kwi_9f3a2c7b41d8 \\
  --url https://app.karo.dev

# The worker registers, burns the install token for a long-lived one,
# and stores it at ~/.karo/worker.json with mode 0600.

# 2 · it needs rootless Docker and outbound HTTPS. Nothing inbound:
#     no public IP, no port forward, no firewall exception.

# 3 · to replace the token later, use Settings → Servers → Rotate. It
#     revokes the worker token and issues a fresh install token, so you
#     run the line above again on the machine.`;

const BYOS_STEPS = [
  {
    icon: Ticket,
    title: 'Install token',
    body: 'You generate a single-use token in the dashboard. The worker exchanges it once for a long-lived worker token and the install token is burned.',
  },
  {
    icon: Lock,
    title: 'Outbound TLS',
    body: 'The worker dials Karo, never the other way around. No inbound firewall rule, no public IP, no exposed Docker socket. Commands arrive on a long poll.',
  },
  {
    icon: Radio,
    title: 'Heartbeat',
    body: 'Every few seconds it reports CPU, memory, disk and running sandboxes. Miss enough heartbeats and Karo marks it offline and reschedules elsewhere.',
  },
];

export function ByosSection() {
  return (
    <Section id="byos">
      <SectionIntro
        eyebrow="Bring your own server"
        title="Run the sandboxes on hardware you control."
        description="A spare VPS, a machine under your desk, a box inside your VPC. Install the Karo worker and your projects run there instead of on Karo Cloud — metered so you can see the usage, never charged for the compute."
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-12">
        <ol className="flex flex-col gap-3">
          {BYOS_STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="flex gap-3 rounded-lg border border-line bg-surface p-4"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="karo-numeric text-[11px] text-subtle">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[14px] font-medium text-fg">{step.title}</span>
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-muted">
                    {step.body}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col gap-3">
          <CodeBlock
            code={BYOS_INSTALL}
            language="bash"
            filename="install the Karo worker"
            maxHeight={340}
          />
          <p className="text-[12.5px] leading-relaxed text-subtle">
            Available on every plan. Compute that runs on your own hardware is metered for
            visibility and billed at zero — you still pay for model tokens unless you also bring
            your own key.
          </p>
        </div>
      </div>
    </Section>
  );
}

const DOCKER_FACTS = [
  'Rootless dockerd runs inside the sandbox as an unprivileged user, in its own user namespace.',
  'The host Docker socket is never bind-mounted. There is no path from a container you build to the machine running Karo.',
  'Images and layers live in the sandbox volume and count against the project storage quota, not a shared cache.',
  'docker compose up works, and exposed ports become preview URLs on plans that allow previews.',
  'Registry credentials are stored encrypted per team and injected only for the duration of a pull.',
];

const DOCKER_TRANSCRIPT = [
  { kind: 'cmd' as const, text: 'docker info --format "{{.SecurityOptions}}"' },
  { kind: 'out' as const, text: '[name=seccomp,profile=builtin name=rootless name=userns]' },
  { kind: 'cmd' as const, text: 'docker compose up -d --build' },
  { kind: 'out' as const, text: ' ✔ api      Built' },
  { kind: 'out' as const, text: ' ✔ postgres Started' },
  { kind: 'ok' as const, text: ' ✔ api      Healthy in 4.1s' },
  { kind: 'cmd' as const, text: 'ls /var/run/docker.sock' },
  {
    kind: 'err' as const,
    text: "ls: cannot access '/var/run/docker.sock': No such file or directory",
  },
];

export function DockerSection() {
  return (
    <Section id="docker">
      <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col gap-6">
          <SectionIntro
            eyebrow="Docker support"
            title="Containers inside the sandbox, never on the host."
            description="Docker-in-Docker gets a bad reputation because it usually means handing a container the host's socket. Karo does the other thing: a rootless daemon inside the sandbox, with no route out."
          />
          <DiamondList items={DOCKER_FACTS} />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary" size="sm">
              <Container className="size-3" aria-hidden="true" />
              Rootless DinD
            </Badge>
            <Badge variant="neutral" size="sm">
              Available on Pro and above
            </Badge>
          </div>
        </div>

        <TerminalPanel
          lines={DOCKER_TRANSCRIPT}
          title="bash — docker plugin"
          label="Sandbox shell showing rootless Docker security options, a successful compose build, and the host Docker socket being absent from the filesystem."
        />
      </div>
    </Section>
  );
}
