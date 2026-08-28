import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { LatticeBackdrop } from '@/components/brand/lattice';
import { SectionNav } from '@/components/marketing/anchor-nav';
import { breadcrumbJsonLd, JsonLd, webPageJsonLd } from '@/components/marketing/json-ld';
import {
  CONTAINER,
  DiamondList,
  Section,
  SectionIntro,
  SpecRow,
} from '@/components/marketing/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { buildMetadata, siteConfig } from '@/lib/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'About',
  description:
    'What Karo is, why an AI agent needs a real computer rather than a chat window, the principles the product is held to, and how it is actually built.',
  path: '/about',
});

const NAV = [
  { id: 'thesis', label: 'The thesis' },
  { id: 'product', label: 'What Karo is' },
  { id: 'principles', label: 'Principles' },
  { id: 'built', label: 'How it is built' },
  { id: 'today', label: 'Where it stands' },
  { id: 'contact', label: 'Contact' },
] as const;

const PRINCIPLES = [
  {
    title: 'The meter is part of the product',
    body: 'Tokens, weighted tokens, compute seconds and cost tick up in the rail beside the conversation while a run happens, not on an invoice at the end of the month. An expensive run is estimated and checked against your allowance before it starts.',
  },
  {
    title: 'Controls, not adjectives',
    body: 'Every security claim Karo makes names a mechanism you could go and check — a function, a constraint, a header. There is no page on this site that says “enterprise-grade” and stops there.',
  },
  {
    title: 'The agent asks before it does damage',
    body: 'Commands are classified allow, confirm or deny before they run. Edits arrive as diffs you approve file by file. Auto-approval exists, but it is a switch you turn on deliberately, per project.',
  },
  {
    title: 'Open standards over a walled garden',
    body: 'Tools reach the agent over the Model Context Protocol, so anything that speaks MCP works without Karo shipping an integration. Models are a setting; bring your own key and those tokens never touch a Karo allowance.',
  },
  {
    title: 'Your hardware is a first-class target',
    body: 'A worker you install on your own server dials out to Karo and long-polls for work — no inbound port, no exposed Docker socket. Compute on your machine is metered so you can see it, and billed at zero.',
  },
  {
    title: 'Nothing on this site is invented',
    body: 'Plan limits and model prices are read from the live catalogue. Transcripts and usage figures in screenshots are demo-mode data. Karo has no certifications and claims none, and there is no logo wall because there is nothing honest to put in it.',
  },
];

const MACHINE = [
  { label: 'Filesystem', value: 'Persistent /workspace volume' },
  { label: 'Shells', value: 'bash · sh · pwsh · cmd' },
  { label: 'Wake from sleep', value: '≈4 seconds' },
  { label: 'Idle sleep', value: 'Your plan’s timeout' },
  { label: 'Exposed ports', value: 'HTTPS preview URL' },
  { label: 'Containers', value: 'Rootless Docker, Pro and above' },
  { label: 'Where it runs', value: 'Karo Cloud, Daytona or your server' },
];

const STACK = [
  { label: 'Framework', value: 'Next.js 16 App Router' },
  { label: 'Language', value: 'TypeScript, strict' },
  { label: 'Data', value: 'PostgreSQL via Drizzle' },
  { label: 'Styling', value: 'Tailwind v4, CSS-first' },
  { label: 'Money', value: 'Integer micro-USD only' },
  { label: 'Boundaries', value: 'Zod on every request' },
  { label: 'Passwords', value: 'scrypt, OWASP 2024 baseline' },
  { label: 'Secrets', value: 'AES-256-GCM envelopes' },
];

const SEAMS = [
  'A model provider interface. One adapter speaks the OpenAI-compatible Chat Completions API, which covers the aggregator Karo ships with and any endpoint you point a BYOK key at.',
  'A sandbox provider interface. Karo Cloud, a remote Docker host, Daytona and a worker on your own server are four runtime targets behind one interface — the same lifecycle, exec, terminal, file and metrics calls, whichever machine answers them.',
  'A billing provider interface. Stripe on one side, a deterministic mock on the other, with the same subscription, top-up and invoice semantics.',
  'A mock behind every one of them. With no credentials in the environment Karo starts in demo mode and the whole product — agent, terminal, sandbox, metering, invoices — runs with no external service at all.',
];

const TODAY = [
  'Karo is a working product, not a waitlist. Demo mode needs no card, no provider key and nothing to configure.',
  'It has no SOC 2 report, no ISO 27001 certificate and no HIPAA business associate agreement. The security page says so in the same words.',
  'There is no public API yet on the smaller plans, no data-residency choice, and no two-factor authentication for password sign-in. Those are gaps, and they are listed rather than hidden.',
  'Uptime is not sold with a contractual guarantee at self-serve prices. Treat a sandbox as a machine you can rebuild, and keep your work in version control.',
];

export default function AboutPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            name: 'About Karo',
            description:
              'What Karo is, the thesis behind giving an AI agent a real sandboxed computer, the principles the product is held to, and how it is built.',
            path: '/about',
            type: 'AboutPage',
          }),
          breadcrumbJsonLd([{ name: 'About', path: '/about' }]),
        ]}
      />

      <section className="relative isolate overflow-hidden">
        <LatticeBackdrop fade="top" opacity={50} />
        <div className={`${CONTAINER} pt-14 pb-10 sm:pt-20`}>
          <SectionIntro
            eyebrow="About"
            title="An agent is only as useful as the computer it can actually use."
            description="Karo is a cloud workspace where an AI coding agent has its own sandboxed Linux machine — real files, a real shell, real installed packages — and where every token and compute-second it spends is measured and shown to you."
            as="h1"
          >
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="primary" size="sm">
                Runs on your server or ours
              </Badge>
              <Badge variant="neutral" size="sm">
                Open standards: MCP
              </Badge>
              <Badge variant="outline" size="sm">
                Metered to the token
              </Badge>
            </div>
          </SectionIntro>
        </div>
      </section>

      <SectionNav items={NAV} />

      {/* ---------------------------------------------------------- */}
      <Section id="thesis" divider={false}>
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-5">
            <SectionIntro
              eyebrow="The thesis"
              title="Advice is cheap. Doing the work is not."
              description="A model that can only talk hands you a suggestion and leaves the hard part — running it, reading the error, installing the missing dependency, trying again — to you."
            />
            <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-muted">
              <p>
                Most of software work is not producing text. It is the loop: change something,
                run it, read what broke, change it again. That loop needs a machine. It needs a
                filesystem that keeps the virtualenv you built two minutes ago, a shell that
                returns a real exit code, a port you can curl, and a package manager that
                actually installs things onto disk.
              </p>
              <p>
                So Karo gives the agent one. A sandbox per project, created with the project,
                asleep when idle, awake in about four seconds, with a persistent{' '}
                <code className="rounded-sm border border-line bg-surface-2 px-1 py-0.5 font-mono text-[13px] text-fg">
                  /workspace
                </code>{' '}
                volume. The agent works there the way you would: reads files, greps, edits, runs
                the test suite, reads the failure, tries again.
              </p>
              <p>
                Once an agent can run arbitrary commands, two questions stop being academic.
                What stops it from doing something you did not want, and what did that cost?
                Those two questions are why the permission matrix and the meter are as much of
                the product as the chat panel.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-fg">
              What “a real computer” means here
            </h3>
            <dl className="mt-2">
              {MACHINE.map((row) => (
                <SpecRow key={row.label} label={row.label} value={row.value} />
              ))}
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
              The isolation boundaries around that machine are drawn out on the security page,
              along with every control that enforces them.
            </p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="product" tone="inset">
        <SectionIntro
          eyebrow="What Karo is"
          title="Four parts, and nothing else pretending to be a fifth."
          description="Karo is deliberately one product rather than a suite. Everything below is in the same window, and each part is described in full on the features page."
        />

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: 'A model',
              body: 'Frontier, balanced and fast tiers from the lowest paid plan up. Switch per project, per conversation or per message, or bring your own key.',
            },
            {
              title: 'A machine',
              body: 'One rootless Linux sandbox per project, with a shared PTY you can take over mid-run, exposed ports that become HTTPS preview URLs, and optional rootless Docker.',
            },
            {
              title: 'A permission system',
              body: 'Agent modes cap what a run may do; a per-project matrix decides reads, writes, deletes, commands, installs, network, git push, Docker and MCP tools separately.',
            },
            {
              title: 'A meter',
              body: 'Weighted tokens for the model, compute hours for the machine. Estimated before an expensive run, streamed during it, itemised after it, exportable as CSV.',
            },
          ].map((part) => (
            <Card key={part.title} className="h-full">
              <CardContent className="flex h-full flex-col gap-2">
                <h3 className="text-[14px] font-semibold text-fg">{part.title}</h3>
                <p className="text-[13px] leading-relaxed text-muted">{part.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/features">How each part works</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/pricing">What it costs</Link>
          </Button>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="principles">
        <SectionIntro
          eyebrow="Principles"
          title="The rules the product is held to."
          description="These are not values on a wall. Each one corresponds to a decision you can see in the interface, and to a thing Karo refuses to do."
        />

        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((principle) => (
            <li key={principle.title} className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-[13.5px] font-semibold text-fg">{principle.title}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{principle.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="built" tone="inset">
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-6">
            <SectionIntro
              eyebrow="How it is built"
              title="One codebase, with the providers behind seams."
              description="Karo is a single Next.js application with server components doing the data fetching and a small number of provider interfaces at the edges. The seams are what make demo mode possible, and they are also what makes running on your own hardware unremarkable rather than a separate edition."
            />
            <DiamondList items={SEAMS} />
            <p className="text-[13px] leading-relaxed text-subtle">
              The interfaces matter more than the choices behind them. Swapping a model
              aggregator, a sandbox host or a payment processor is a new adapter, not a
              migration.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-fg">The stack, concretely</h3>
            <dl className="mt-2">
              {STACK.map((row) => (
                <SpecRow key={row.label} label={row.label} value={row.value} />
              ))}
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
              Money is the one that surprises people: every amount in the billing path is an
              integer number of micro-USD, so a sub-cent charge is never rounded away and a
              rounding error cannot accumulate across a month of small requests.
            </p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="today">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
          <div className="flex flex-col gap-5">
            <SectionIntro
              eyebrow="Where it stands"
              eyebrowTone="ember"
              title="What is true today, including the gaps."
              description="A page about a company is the easiest place to overstate one. Here is the honest state of things."
            />
            <DiamondList items={TODAY} tone="ember" />
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[14px] font-semibold text-fg">What you will not find here</h3>
            <ul className="mt-2 flex flex-col gap-2 text-[13px] leading-relaxed text-muted">
              <li>Founder biographies, because the product is the claim.</li>
              <li>A funding announcement, a headcount or a customer count.</li>
              <li>Logos of companies that have not agreed to appear.</li>
              <li>Benchmark charts without the command that produced them.</li>
              <li>A certification badge Karo has not earned.</li>
            </ul>
            <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
              If you want to know whether Karo works for your project, the demo answers that
              faster than this page can.
            </p>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="contact" tone="inset">
        <SectionIntro
          eyebrow="Contact"
          title="Two addresses, both read by people who can act."
          description="Support handles accounts, billing and anything the product did that you did not expect. Security handles vulnerability reports and nothing else, so it stays fast."
        />

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[13.5px] font-semibold text-fg">Support</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Accounts, teams, billing, plan limits, and a run that behaved differently from the
              way this site describes it.
            </p>
            <a
              className="mt-2 inline-block rounded-sm font-mono text-[12.5px] text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
              href={`mailto:${siteConfig.contact.support}`}
            >
              {siteConfig.contact.support}
            </a>
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[13.5px] font-semibold text-fg">Security</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Vulnerability reports, isolation concerns and anything that looks like one tenant
              reaching another. The disclosure terms are on the security page.
            </p>
            <a
              className="mt-2 inline-block rounded-sm font-mono text-[12.5px] text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
              href={`mailto:${siteConfig.contact.security}`}
            >
              {siteConfig.contact.security}
            </a>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild size="lg" iconRight={<ArrowRight aria-hidden="true" />}>
            <Link href="/register">Start building</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login?demo=1">Try the demo</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href="/security">Security posture</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
