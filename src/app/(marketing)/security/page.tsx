import { Check, Info, Minus, ShieldAlert } from 'lucide-react';
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
import {
  controlsInGroup,
  SECURITY_CONTROLS,
  SECURITY_GROUP_LABELS,
  type SecurityGroup,
} from '@/components/marketing/security-controls';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PLAN_SEEDS } from '@/lib/db/seed-data/plans';
import { buildMetadata, siteConfig } from '@/lib/metadata';
import { cn } from '@/lib/utils';

export const metadata: Metadata = buildMetadata({
  title: 'Security',
  description:
    'Karo’s full security posture: the sandbox isolation model, every implemented control grouped by what it protects, what data is stored and where it goes, the gaps Karo has not closed yet, and how to report a vulnerability.',
  path: '/security',
});

const NAV = [
  { id: 'isolation', label: 'Isolation' },
  { id: 'agent', label: 'Agent safety' },
  { id: 'secrets', label: 'Secrets' },
  { id: 'access', label: 'Access and audit' },
  { id: 'network', label: 'Network' },
  { id: 'platform', label: 'Platform' },
  { id: 'data', label: 'Data handling' },
  { id: 'gaps', label: 'What is missing' },
  { id: 'disclosure', label: 'Disclosure' },
] as const;

/**
 * Group intros.
 *
 * The control text itself lives in `SECURITY_CONTROLS` and is shared with the
 * landing page and `/features`; only the framing around each group is written
 * here, so the two surfaces can never drift apart on a factual claim.
 */
const GROUP_INTRO: Record<SecurityGroup, { title: string; description: string }> = {
  isolation: {
    title: 'Nothing you or the agent runs touches the machine serving this page.',
    description:
      'The control plane schedules work and reads results. Execution happens inside a sandbox owned by a provider, in its own namespaces, and the boundary is structural rather than a policy someone remembered to apply.',
  },
  agent: {
    title: 'The agent is a caller with permissions, not a trusted operator.',
    description:
      'Every path it names is normalised, every command it proposes is classified, and every edit it wants is a diff until you approve it. Its own tool output is treated as untrusted input.',
  },
  secrets: {
    title: 'Secrets are encrypted at rest and never travel back to a browser.',
    description:
      'Model keys, worker tokens, MCP credentials and project environment variables all go through the same envelope. A stored secret can be shown as a mask and used by the server, and that is all.',
  },
  access: {
    title: 'Who may do what is a table, and every mutation checks it.',
    description:
      'There is no implicit administrator shortcut in the code. Sessions are server-side records, CSRF is enforced on every non-GET route, and the audit log records the mutation whether or not anyone is watching.',
  },
  network: {
    title: 'Outbound requests are checked, and egress is a permission.',
    description:
      'Karo fetches URLs on your behalf for MCP servers, webhooks and catalogue syncs. Each of those is validated before the connection and again after any redirect, and a sandbox reaches the internet only when the project allows it.',
  },
  platform: {
    title: 'The boring layers, done properly.',
    description:
      'Headers, input validation and arithmetic are where products quietly leak. All three are handled in one place each, so there is a single thing to audit rather than a pattern to hope for.',
  },
};

const GROUP_ORDER: readonly SecurityGroup[] = [
  'isolation',
  'agent',
  'secrets',
  'access',
  'network',
  'platform',
];

/**
 * Sleep and destroy windows are plan limits, so the floor quoted below is read
 * from the published plan catalogue instead of being typed in. The *schema*
 * defaults (15 min, 72 h) are not the smallest published values — pay as you go
 * sleeps at 10 min and is destroyed at 24 h — and hard-coding them here would
 * contradict the pricing table this panel points at.
 */
const PUBLISHED_PLANS = PLAN_SEEDS.filter(
  (plan) => plan.isPublic !== false && plan.isActive !== false,
);
const MIN_SLEEP_MINUTES = Math.min(
  ...PUBLISHED_PLANS.map((plan) => plan.autoSleepMinutes ?? 15),
);
const MIN_DESTROY_HOURS = Math.min(
  ...PUBLISHED_PLANS.map((plan) => plan.autoDestroyHours ?? 72),
);

const LIFECYCLE = [
  { label: 'Machines per project', value: 'One' },
  { label: 'Sleep when idle', value: `Plan timeout, from ${MIN_SLEEP_MINUTES} min` },
  { label: 'Destroyed after', value: `Plan retention, from ${MIN_DESTROY_HOURS} h` },
  { label: 'Project deleted', value: 'Sandbox and volume with it' },
  { label: 'Host Docker socket', value: <Minus className="size-4 text-subtle" /> },
  { label: 'Root in the sandbox', value: <Minus className="size-4 text-subtle" /> },
  { label: 'Own namespaces', value: <Check className="size-4 text-primary" /> },
  { label: 'Seccomp profile', value: <Check className="size-4 text-primary" /> },
];

const STORED = [
  {
    category: 'Account and session',
    detail:
      'Email, display name, a scrypt password hash, and one session row per sign-in holding a SHA-256 hash of the cookie token, the IP address and the user agent.',
    retention: 'Until you delete the account',
  },
  {
    category: 'Projects and files',
    detail:
      'Project settings, the workspace file tree, file contents, and any diff the agent has proposed but you have not approved.',
    retention: 'Until the project or account is deleted',
  },
  {
    category: 'Conversations',
    detail:
      'Messages you send, model output, reasoning blocks, every tool call with its arguments and result, and attachments.',
    retention: 'Until the conversation, project or account is deleted',
  },
  {
    category: 'Usage events',
    detail:
      'Per request: input, output, cached-read and cache-write tokens, weighted tokens, upstream cost, charged amount, model slug, latency and the conversation it belongs to. Compute events record awake seconds per sandbox.',
    retention: 'Kept — this is the billing record',
  },
  {
    category: 'Audit log',
    detail:
      'Who did what, to which resource, from which IP and user agent, with before-and-after values where they matter. Payloads pass through redaction before insert.',
    retention: 'Your plan’s window: 7 to 365 days',
  },
  {
    category: 'Secrets',
    detail:
      'Model API keys, MCP server credentials, worker tokens and project environment variables, each as an AES-256-GCM envelope with its own IV.',
    retention: 'Until you delete the secret',
  },
  {
    category: 'Billing',
    detail:
      'Subscription state, prepaid balance, top-ups, invoices and the payment processor’s references. No card number ever reaches Karo.',
    retention: 'Kept for accounting',
  },
];

const INFERENCE = [
  'What goes to the model: the system prompt, the conversation so far, the file contents and tool results the agent has read, and the schemas of the tools it may call.',
  'Where it goes: the model provider configured for that request — the aggregator Karo ships with, or your own OpenAI-compatible endpoint when you use your own key.',
  'What does not go: stored secrets. Known key shapes and stored values are redacted out of tool output before it reaches the model, and credentials are injected into processes rather than into context.',
  'In demo mode there is no provider at all. The mock model runs in-process, so no prompt leaves the deployment.',
  'Retention at the provider is the provider’s policy, not Karo’s. If that matters to you, bring your own key and the request goes to the endpoint you chose under the agreement you signed.',
];

const GAPS = [
  {
    title: 'No SOC 2, ISO 27001 or HIPAA',
    body: 'Karo has completed no third-party audit and holds no certification. It cannot sign a business associate agreement. Anyone showing you a badge for this product made it up.',
  },
  {
    title: 'No published penetration test',
    body: 'The controls on this page are implemented and reviewable in the codebase. They have not been validated by an external assessor whose report you could read.',
  },
  {
    title: 'No two-factor authentication yet',
    body: 'Password sign-in is scrypt-hashed and rate-limited, and sessions can be revoked individually, but there is no TOTP or passkey second factor. SAML single sign-on is available on the largest plan.',
  },
  {
    title: 'No customer-managed encryption keys',
    body: 'Envelope encryption uses a key held by the deployment. The envelope is versioned so the algorithm and key can be rotated, but you cannot supply or hold the key yourself.',
  },
  {
    title: 'No data-residency choice',
    body: 'You cannot pin a team to a region. What you can do is run the machine yourself: a worker on your own server keeps execution and the workspace on hardware you control.',
  },
  {
    title: 'No bug bounty programme',
    body: 'Reports are read and fixed, and you will be credited if you want to be, but there is no payout table. Disclosure terms are below.',
  },
  {
    title: 'No contractual uptime guarantee',
    body: 'Self-serve plans carry no SLA. Sandboxes sleep and are eventually destroyed by design, so treat one as rebuildable and keep your work in version control.',
  },
];

const DISCLOSURE_IN_SCOPE = [
  'The Karo web application and its API, including authentication, session handling and CSRF.',
  'Sandbox isolation: anything that escapes /workspace, reaches the host, or reaches another tenant.',
  'The agent’s command policy and path handling — a bypass of evaluateCommand() or normalizeWorkspacePath().',
  'Secret handling: a route that returns a decrypted secret, or a log line or transcript that leaks one.',
  'Authorisation: any mutation that succeeds without the permission its role table requires.',
  'Metering and billing: a way to consume tokens or compute that is not recorded, or that is charged to another team.',
];

const DISCLOSURE_OUT_OF_SCOPE = [
  'Denial of service, volumetric or resource-exhaustion testing, and anything that degrades service for other tenants.',
  'Social engineering, phishing or physical attacks against anyone connected to Karo.',
  'Findings from automated scanners with no demonstrated impact, and missing headers on endpoints that carry no session.',
  'Reports against the shared demo account, or against another team’s data — test inside a team you own.',
  'Vulnerabilities in third-party MCP servers, plugins or model providers you have connected yourself. Report those upstream.',
];

const DISCLOSURE_TERMS = [
  { label: 'Where to send it', value: siteConfig.contact.security },
  { label: 'Acknowledgement', value: 'Within 3 business days' },
  { label: 'Triage and severity', value: 'Within 10 business days' },
  { label: 'Fix target, critical', value: 'As fast as a fix can ship' },
  { label: 'Public disclosure', value: 'Coordinated, after the fix' },
  { label: 'Credit', value: 'Given if you want it' },
  { label: 'Payment', value: 'No bounty programme' },
];

export default function SecurityPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            name: 'Karo security posture',
            description:
              'The sandbox isolation model, every implemented security control grouped by area, what data Karo stores, the gaps it has not closed, and its responsible-disclosure terms.',
            path: '/security',
          }),
          breadcrumbJsonLd([{ name: 'Security', path: '/security' }]),
        ]}
      />

      <section className="relative isolate overflow-hidden">
        <LatticeBackdrop fade="top" opacity={50} />
        <div className={`${CONTAINER} pt-14 pb-10 sm:pt-20`}>
          <SectionIntro
            eyebrow="Security"
            title="Giving an agent a shell is only reasonable if the shell is boxed in."
            description="This page lists every security control Karo implements, grouped by what it protects, plus the isolation model, what data is stored, and the things Karo does not have. Each control names a mechanism specific enough to be checked against the code."
            as="h1"
          >
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="primary" size="sm">
                {SECURITY_CONTROLS.length} controls
              </Badge>
              <Badge variant="neutral" size="sm">
                {GROUP_ORDER.length} areas
              </Badge>
              <Badge variant="outline" size="sm">
                No certifications claimed
              </Badge>
            </div>
          </SectionIntro>

          <Alert variant="info" icon={Info} className="mt-6 max-w-3xl">
            <AlertTitle>What this page is not</AlertTitle>
            <AlertDescription>
              It is not an audit report. Karo holds no SOC 2 report, no ISO 27001 certificate
              and no HIPAA agreement, and the gaps are listed in full further down rather than
              left out.
            </AlertDescription>
          </Alert>
        </div>
      </section>

      <SectionNav items={NAV} />

      {/* ---------------------------------------------------------- */}
      <Section id="isolation" divider={false}>
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-6">
            <SectionIntro
              eyebrow={SECURITY_GROUP_LABELS.isolation}
              title={GROUP_INTRO.isolation.title}
              description={GROUP_INTRO.isolation.description}
            />
            <ControlList group="isolation" />
          </div>

          <div className="flex flex-col gap-4">
            <IsolationDiagram />
            <div className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-[14px] font-semibold text-fg">Sandbox lifecycle</h3>
              <dl className="mt-2">
                {LIFECYCLE.map((row) => (
                  <SpecRow key={row.label} label={row.label} value={row.value} />
                ))}
              </dl>
              <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
                Sleep and retention windows are plan limits, so the exact numbers for your plan
                are in the pricing table rather than hard-coded here.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      {GROUP_ORDER.filter((group) => group !== 'isolation').map((group, index) => (
        <Section key={group} id={group} tone={index % 2 === 0 ? 'inset' : 'default'}>
          <SectionIntro
            eyebrow={SECURITY_GROUP_LABELS[group]}
            title={GROUP_INTRO[group].title}
            description={GROUP_INTRO[group].description}
          />
          <ControlList group={group} className="mt-8" columns="grid" />
        </Section>
      ))}

      {/* ---------------------------------------------------------- */}
      <Section id="data">
        <SectionIntro
          eyebrow="Data handling"
          title="What Karo keeps, and what leaves the deployment."
          description="Two separate questions, both answered concretely. The privacy policy covers the legal framing; this is the mechanical version."
        />

        <Table
          className="mt-8 min-w-[42rem]"
          containerClassName="rounded-lg border border-line bg-surface"
        >
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>What is stored</TableHead>
              <TableHead>How long</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {STORED.map((row) => (
              <TableRow key={row.category}>
                <TableCell className="align-top font-medium whitespace-nowrap text-fg">
                  {row.category}
                </TableCell>
                <TableCell className="align-top text-muted">{row.detail}</TableCell>
                <TableCell className="align-top text-muted">{row.retention}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <SectionIntro
              eyebrow="Inference"
              eyebrowTone="ember"
              title="Your prompts and code go to a model provider."
              description="This is the part no amount of isolation removes, so it is stated plainly rather than buried."
              as="h3"
            />
            <DiamondList items={INFERENCE} tone="ember" />
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-[14px] font-semibold text-fg">Deletion, exactly</h3>
              <ul className="mt-2 flex flex-col gap-2 text-[13px] leading-relaxed text-muted">
                <li>
                  Deleting a project removes its files, conversations and pending diffs, and
                  destroys its sandbox and volume.
                </li>
                <li>
                  Deleting your account is immediate. There is no grace period, no export and no
                  undo, and the confirmation is your email address typed by hand.
                </li>
                <li>
                  Teams you own are deleted with you. A team with other members is refused
                  instead, so four colleagues do not lose their work to your account deletion.
                </li>
                <li>
                  Invoices and billing records survive, because they have to. Audit entries
                  survive with your account reference removed — the event stays, the identity
                  does not.
                </li>
              </ul>
            </div>
            <Button asChild variant="outline">
              <Link href="/privacy">Privacy policy in full</Link>
            </Button>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="gaps" tone="inset">
        <SectionIntro
          eyebrow="What is missing"
          eyebrowTone="ember"
          title="The things Karo does not have."
          description="A security page that lists only strengths is a marketing page. These are the gaps as they stand today, in the same words they would be given to an auditor."
        />

        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {GAPS.map((gap) => (
            <li key={gap.title} className="rounded-lg border border-line bg-surface-2 p-4">
              <div className="flex items-baseline gap-2">
                <Minus className="mt-1 size-3.5 shrink-0 text-subtle" aria-hidden="true" />
                <h3 className="text-[13.5px] font-semibold text-fg">{gap.title}</h3>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{gap.body}</p>
            </li>
          ))}
        </ul>

        <Alert variant="warning" icon={ShieldAlert} className="mt-6 max-w-3xl">
          <AlertTitle>If a control on this page is a requirement for you</AlertTitle>
          <AlertDescription>
            Write to {siteConfig.contact.security} and ask before you commit. A straight answer
            about what Karo does not do is cheaper for both of us than discovering it during a
            procurement review.
          </AlertDescription>
        </Alert>
      </Section>

      {/* ---------------------------------------------------------- */}
      <Section id="disclosure">
        <SectionIntro
          eyebrow="Responsible disclosure"
          title="Report it privately, to one address."
          description="Report it privately first and you will get an answer from someone who can fix it. Karo will not pursue legal action over good-faith research that stays inside the boundaries below."
        />

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="text-[14px] font-semibold text-fg">In scope</h3>
              <DiamondList items={DISCLOSURE_IN_SCOPE} />
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-[14px] font-semibold text-fg">Out of scope</h3>
              <DiamondList items={DISCLOSURE_OUT_OF_SCOPE} tone="line" />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-[14px] font-semibold text-fg">How it is handled</h3>
              <dl className="mt-2">
                {DISCLOSURE_TERMS.map((row) => (
                  <SpecRow key={row.label} label={row.label} value={row.value} />
                ))}
              </dl>
            </div>

            <div className="rounded-lg border border-line bg-surface p-4">
              <h3 className="text-[14px] font-semibold text-fg">What to include</h3>
              <ol className="mt-2 flex flex-col gap-2">
                {[
                  'The exact request or steps, with the account and team you used.',
                  'What you expected, and what happened instead.',
                  'The impact you can demonstrate — not the impact you suspect.',
                  'Whether you accessed data that was not yours, and how much.',
                ].map((item, index) => (
                  <li
                    key={item}
                    className="flex gap-2.5 text-[13px] leading-relaxed text-muted"
                  >
                    <span className="karo-numeric shrink-0 text-subtle">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <a href={`mailto:${siteConfig.contact.security}`}>
                  Email {siteConfig.contact.security}
                </a>
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-2">
          <Button asChild size="lg" variant="outline">
            <Link href="/features#security">Security on the features page</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href="/terms">Terms of service</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}

/**
 * Renders one group's controls.
 *
 * `columns` switches between the narrow column used beside the isolation
 * diagram and the full-width grid every other group gets.
 */
function ControlList({
  group,
  className,
  columns = 'stack',
}: {
  group: SecurityGroup;
  className?: string;
  columns?: 'stack' | 'grid';
}) {
  return (
    <ul
      className={cn(
        'grid gap-3',
        columns === 'grid' && 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {controlsInGroup(group).map((control) => (
        <li
          key={control.id}
          className="flex gap-2.5 rounded-lg border border-line bg-surface p-4"
        >
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-fg">{control.title}</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{control.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
