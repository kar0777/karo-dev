import type { Metadata } from 'next';
import Link from 'next/link';
import type * as React from 'react';

import { LatticeBackdrop } from '@/components/brand/lattice';
import { SidebarNav } from '@/components/marketing/anchor-nav';
import { breadcrumbJsonLd, JsonLd, webPageJsonLd } from '@/components/marketing/json-ld';
import { CONTAINER, DiamondList, Section, SectionIntro } from '@/components/marketing/section';
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
import { buildMetadata, siteConfig } from '@/lib/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Privacy policy',
  description:
    'What Karo stores — projects, files, conversation transcripts, usage events and the audit log — what is sent to a model provider for inference, how long each category is kept, and how deletion actually works.',
  path: '/privacy',
});

/**
 * Fixed rather than computed.
 *
 * The date has to change when the text changes and at no other time, so it is a
 * literal that is edited by hand alongside the clauses.
 */
const LAST_UPDATED = '26 July 2026';

const NAV_GROUPS = [
  {
    title: 'Scope',
    items: [
      { id: 'scope', label: 'What this covers' },
      { id: 'controller', label: 'Who is responsible' },
      { id: 'basis', label: 'Why it is processed' },
    ],
  },
  {
    title: 'What Karo holds',
    items: [
      { id: 'stored', label: 'Data Karo stores' },
      { id: 'cookies', label: 'Cookies and storage' },
      { id: 'logs', label: 'Logs and redaction' },
      { id: 'retention', label: 'Retention and deletion' },
    ],
  },
  {
    title: 'Where data goes',
    items: [
      { id: 'inference', label: 'Model providers' },
      { id: 'sandbox', label: 'Inside the sandbox' },
      { id: 'subprocessors', label: 'Sub-processors' },
      { id: 'transfers', label: 'International transfers' },
    ],
  },
  {
    title: 'Your rights',
    items: [
      { id: 'rights', label: 'Rights and requests' },
      { id: 'children', label: 'Age' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'changes', label: 'Changes' },
      { id: 'contact', label: 'Contact' },
    ],
  },
] as const;

/* ------------------------------------------------------------------ *
 *  Local document primitives
 *
 *  Matched to the terms page so the two documents read as one pair. Body
 *  copy runs through `P`, lists reuse the marketing `DiamondList`, and
 *  every clause is numbered by `Clause` rather than by hand.
 * ------------------------------------------------------------------ */

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-muted">{children}</p>;
}

/** Flags a clause an operator has to finish before relying on the document. */
function TemplateField() {
  return (
    <Badge variant="warning" size="sm">
      Operator must complete
    </Badge>
  );
}

function Clause({
  id,
  index,
  heading,
  note,
  children,
}: {
  id: string;
  index: number;
  heading: string;
  /** Rendered beside the heading — used to flag template fields. */
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article
      id={id}
      className="scroll-mt-28 border-t border-line pt-8 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <span className="karo-numeric text-[12px] font-semibold text-subtle">
          {String(index).padStart(2, '0')}
        </span>
        <h2 className="text-lg sm:text-xl">{heading}</h2>
        {note}
      </div>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </article>
  );
}

const STORED = [
  {
    category: 'Account',
    detail:
      'Email address, display name, a scrypt hash of your password, whether the address is verified, and your interface preferences.',
    kept: 'Until you delete the account',
  },
  {
    category: 'Sessions',
    detail:
      'One row per sign-in: a SHA-256 hash of the session token, a CSRF token, the IP address and user agent that created it, and when it was last used.',
    kept: 'Until expiry, logout or revocation',
  },
  {
    category: 'Teams',
    detail:
      'Team name, ownership, membership and role, pending invitations, and spend controls.',
    kept: 'Until the team is deleted',
  },
  {
    category: 'Projects and files',
    detail:
      'Project settings, the workspace file tree, file contents, and diffs the agent has proposed but you have not approved.',
    kept: 'Until the project or account is deleted',
  },
  {
    category: 'Conversations',
    detail:
      'Every message you send, the model’s replies, its reasoning blocks, each tool call with its arguments and result, and attachments you add.',
    kept: 'Until the conversation, project or account is deleted',
  },
  {
    category: 'Sandboxes',
    detail:
      'Machine metadata, status history and resource metrics. The contents of the machine live on its volume, not in the database.',
    kept: 'Until the sandbox is destroyed',
  },
  {
    category: 'Usage events',
    detail:
      'Per request: input, output, cached-read and cache-write tokens, weighted tokens, upstream cost, amount charged, model slug, latency, and the project and conversation it belongs to. Compute events record awake seconds per sandbox.',
    kept: 'Retained — this is the billing record',
  },
  {
    category: 'Audit log',
    detail:
      'Action, actor, resource, severity, IP address, user agent, and before-and-after values where they matter. Payloads pass through secret redaction before they are written.',
    kept: 'Your plan’s window: 7 to 365 days',
  },
  {
    category: 'Secrets',
    detail:
      'Model API keys, MCP server credentials, worker tokens and project environment variables, each stored as an AES-256-GCM envelope. Only a mask and the last four characters are ever displayed.',
    kept: 'Until you delete the secret',
  },
  {
    category: 'Billing',
    detail:
      'Subscription state, prepaid balance, top-ups, invoices with their line items, and the payment processor’s references. No card number reaches Karo.',
    kept: 'Retained for accounting',
  },
  {
    category: 'Notifications',
    detail:
      'In-product notices about runs, limits and billing, and whether you have read them.',
    kept: 'Until you delete the account',
  },
];

const SUBPROCESSORS = [
  {
    role: 'Model provider',
    purpose:
      'Runs inference on the prompt, the conversation and the file contents the agent has read.',
    data: 'Prompts, code, tool results',
  },
  {
    role: 'Sandbox provider',
    purpose: 'Hosts the machine that executes your commands and holds the workspace volume.',
    data: 'Files, processes, network traffic',
  },
  {
    role: 'Payment processor',
    purpose:
      'Takes card payments, issues invoices and reports subscription state back to Karo.',
    data: 'Billing name, email, card details',
  },
  {
    role: 'Email transport',
    purpose: 'Delivers verification, password-reset and billing messages.',
    data: 'Email address, message content',
  },
  {
    role: 'Hosting and database',
    purpose: 'Runs the application and stores everything in the table above.',
    data: 'All stored data',
  },
  {
    role: 'Cache and rate limiting',
    purpose: 'Holds short-lived counters that keep one caller from starving the others.',
    data: 'IP address, user or route key',
  },
];

export default function PrivacyPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            name: 'Karo privacy policy',
            description:
              'What Karo stores, what is sent to a model provider for inference, which sub-processors are involved, how long each category is kept, and how deletion works.',
            path: '/privacy',
          }),
          breadcrumbJsonLd([{ name: 'Privacy policy', path: '/privacy' }]),
        ]}
      />

      <section className="relative isolate overflow-hidden">
        <LatticeBackdrop fade="top" opacity={45} />
        <div className={`${CONTAINER} pt-14 pb-10 sm:pt-20`}>
          <SectionIntro
            eyebrow="Legal"
            eyebrowTone="muted"
            title="Privacy policy"
            description="What Karo stores about you and your work, what leaves the deployment and where it goes, how long each category is kept, and what deleting your account actually removes. Every claim here maps to a table or a code path rather than an intention."
            as="h1"
          >
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="neutral" size="sm">
                Last updated {LAST_UPDATED}
              </Badge>
              <Badge variant="outline" size="sm">
                {NAV_GROUPS.reduce((total, group) => total + group.items.length, 0)} clauses
              </Badge>
            </div>
          </SectionIntro>

          <Alert variant="info" className="mt-6 max-w-3xl">
            <AlertTitle>This is a template, not legal advice</AlertTitle>
            <AlertDescription>
              The technical descriptions here are accurate to how Karo works, but the document
              has not been drafted or reviewed by a lawyer and it names no legal entity. If you
              operate Karo commercially, have counsel review it, complete the clauses marked as
              needing an operator, and confirm it satisfies the data-protection law that applies
              to you and to your users.
            </AlertDescription>
          </Alert>
        </div>
      </section>

      <Section size="sm">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-14">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <SidebarNav groups={NAV_GROUPS} label="Privacy policy" />
          </div>

          <div className="flex max-w-3xl flex-col gap-8">
            <Clause id="scope" index={1} heading="What this policy covers">
              <P>
                This policy covers the Karo web application, the API behind it, the sandboxes it
                runs on your behalf, and the emails it sends. It covers both the data you give
                Karo deliberately — an email address, a project, a prompt — and the data the
                product produces as a side effect of working, such as usage events and audit
                entries.
              </P>
              <P>
                It does not cover services you connect yourself. An MCP server you point Karo
                at, a plugin you install, or a model endpoint you supply your own key for is a
                third party you chose, and its own policy governs what it does with a request
                Karo makes on your instruction.
              </P>
            </Clause>

            <Clause
              id="controller"
              index={2}
              heading="Who is responsible for your data"
              note={<TemplateField />}
            >
              <P>
                The company operating this deployment is the controller of the personal data
                described here, and its legal name, registered address and — where the law
                requires one — its data protection officer or representative belong in this
                clause. This template deliberately names none of them, because an unfilled
                entity is obvious and an invented one is worse.
              </P>
              <P>
                For the code, files and prompts you bring, the arrangement is the other way
                round: you decide what goes in, and Karo processes it on your instruction in
                order to run the service.
              </P>
            </Clause>

            <Clause id="basis" index={3} heading="Why Karo is allowed to process this">
              <DiamondList
                items={[
                  'To perform the contract: running your projects, executing commands, calling the model, and metering what that cost. Without this there is no product.',
                  'For a legitimate interest in keeping the platform safe and working: rate limits, abuse detection, the audit log, and the isolation controls described on the security page.',
                  'To meet a legal obligation: keeping invoices and billing records for as long as accounting rules require.',
                  'With your consent, where something is genuinely optional — connecting a third-party tool, storing a model key, enabling a plugin. You can withdraw that by removing the thing.',
                ]}
              />
              <P>
                Karo does not sell personal data, does not share it with advertisers, and does
                not use your code, files or conversations to train models.
              </P>
            </Clause>

            <Clause id="stored" index={4} heading="What Karo stores">
              <P>
                Every category below corresponds to a table in the database rather than to a
                general description of the kind of thing Karo might keep.
              </P>
              <Table
                className="min-w-[38rem]"
                containerClassName="rounded-lg border border-line bg-surface"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>What it contains</TableHead>
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
                      <TableCell className="align-top text-muted">{row.kept}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <P>
                Conversation transcripts are the most sensitive item on that list, because they
                contain whatever you pasted into a prompt. If a conversation should not exist
                any more, delete it — deletion removes its messages, tool calls and attachments.
              </P>
            </Clause>

            <Clause id="cookies" index={5} heading="Cookies, local storage and tracking">
              <DiamondList
                items={[
                  <>
                    <code className="rounded-sm border border-line bg-surface-2 px-1 py-0.5 font-mono text-[12.5px] text-fg">
                      karo_session
                    </code>{' '}
                    holds a random session token. It is httpOnly and SameSite=Lax, is marked
                    Secure in production, and is scoped to this site. It is strictly necessary:
                    without it you cannot stay signed in.
                  </>,
                  <>
                    <code className="rounded-sm border border-line bg-surface-2 px-1 py-0.5 font-mono text-[12.5px] text-fg">
                      karo_team
                    </code>{' '}
                    remembers which of your teams you were last working in, so a page you open
                    in a new tab lands in the right place. It holds a team id and nothing else,
                    is SameSite=Lax, and is readable by the page because the team switcher
                    writes it in the browser. Those are the only two cookies Karo sets.
                  </>,
                  'Your light or dark theme choice is kept in the browser’s local storage so the correct theme is painted before the page hydrates, and — once you are signed in — on your account as well, so it follows you to another browser. Signed out, it never leaves the device.',
                  'No analytics, no advertising pixels, no session recording, no third-party scripts. Fonts are bundled with the application at build time rather than fetched from a font host.',
                  'Because nothing here is optional or tracking, Karo shows no cookie consent banner. There is nothing to consent to.',
                ]}
              />
            </Clause>

            <Clause id="logs" index={6} heading="Server logs, rate limits and redaction">
              <P>
                The server writes operational logs: which route was called, how long it took,
                whether it failed, and an error with its stack when it did. Log lines and audit
                payloads pass through a redaction pass first, which strips known API-key shapes
                and any secret value Karo has on record, so a credential does not end up in a
                log file or a streamed tool output.
              </P>
              <P>
                Rate limiting keeps short-lived counters keyed by IP address, by account, or by
                both, depending on the route. They expire within two windows of the limit they
                enforce — long enough to smooth a burst, not long enough to be a history of your
                requests.
              </P>
            </Clause>

            <Clause id="retention" index={7} heading="Retention and deletion">
              <P>
                Retention is per category, as set out in clause 4. Deleting something in the
                product deletes it for real rather than hiding it, and the cascade is
                deliberate:
              </P>
              <DiamondList
                items={[
                  'Deleting a conversation removes its messages, reasoning blocks, tool calls and attachments.',
                  'Deleting a project removes its files and conversations, and destroys its sandbox together with the volume holding the workspace.',
                  'Deleting your account is immediate. There is no grace period, no export step and no undo, and the confirmation is your own email address typed by hand.',
                  'Teams you own are deleted with you. A team that has other members is refused instead, so an account deletion cannot quietly destroy a colleague’s work; hand it over first.',
                  'Work you created inside teams you merely belong to is reassigned to that team’s owner, so the team keeps functioning.',
                  'Invoices and billing records survive, because accounting rules require them. Audit entries survive with your account reference set to null — the event remains, the identity does not.',
                  'Sandbox volumes are destroyed with the sandbox. Anything you left only inside a machine is gone at that point, which is why a sandbox should be treated as rebuildable.',
                ]}
              />
              <P>
                Backups are a separate matter: a deletion is reflected in the live database
                immediately, and disappears from backups as those age out on the operator’s
                backup schedule.
              </P>
            </Clause>

            <Clause id="inference" index={8} heading="Prompts and code go to a model provider">
              <P>
                This is the part no amount of sandboxing removes, so it is stated plainly. To
                answer you, the agent sends a request to a model provider containing the system
                prompt, the conversation so far, the file contents and tool results it has read,
                and the schemas of the tools it may call. Your code is in that request whenever
                the agent has read your code.
              </P>
              <DiamondList
                items={[
                  'Which provider depends on the request. By default it is the aggregator the deployment is configured with; when you use your own key it is the OpenAI-compatible endpoint you chose, under whatever agreement you have with them.',
                  'Stored secrets are not included. Known key shapes and recorded secret values are redacted out of tool output before it reaches the model, and credentials are injected into processes rather than into context.',
                  'What the provider retains, and whether it trains on inputs, is governed by that provider — not by this policy. If that distinction matters to you, bring your own key so the endpoint and the contract are yours.',
                  'In demo mode there is no provider at all: a mock model runs in-process, and no prompt leaves the deployment.',
                ]}
              />
            </Clause>

            <Clause id="sandbox" index={9} heading="What happens inside the sandbox">
              <P>
                A sandbox is a real machine with a real filesystem. Whatever you or the agent
                writes there — checked-out repositories, installed packages, build output,
                environment variables, log files — exists on the volume for that machine and is
                visible to the provider hosting it, in the same sense that any hosting provider
                can reach the disk it serves.
              </P>
              <P>
                Egress from the sandbox is a per-project permission. When it is off the machine
                cannot reach the internet at all, including package registries. When it is on,
                the machine can talk to whatever you point it at, and where that traffic goes is
                your decision rather than Karo’s. If you run a worker on your own server, that
                execution and that volume stay on your hardware.
              </P>
            </Clause>

            <Clause
              id="subprocessors"
              index={10}
              heading="Sub-processors"
              note={<TemplateField />}
            >
              <P>
                Karo relies on the categories of provider below. Which company fills each row
                depends on how the deployment is configured, and an operator must publish the
                actual names and locations here — a sub-processor list without names does not
                satisfy anyone’s procurement review.
              </P>
              <Table
                className="min-w-[36rem]"
                containerClassName="rounded-lg border border-line bg-surface"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Why it is involved</TableHead>
                    <TableHead>What it sees</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SUBPROCESSORS.map((row) => (
                    <TableRow key={row.role}>
                      <TableCell className="align-top font-medium whitespace-nowrap text-fg">
                        {row.role}
                      </TableCell>
                      <TableCell className="align-top text-muted">{row.purpose}</TableCell>
                      <TableCell className="align-top text-muted">{row.data}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <P>
                Running Karo with no credentials at all puts every one of these behind a mock,
                which is what demo mode is. In that state nothing leaves the deployment.
              </P>
            </Clause>

            <Clause
              id="transfers"
              index={11}
              heading="International transfers"
              note={<TemplateField />}
            >
              <P>
                Karo does not offer a data-residency choice: you cannot pin a team to a region,
                and a model provider or sandbox host may process a request outside the country
                you are in. An operator must state where its infrastructure and its
                sub-processors are located, and which transfer mechanism it relies on where the
                law requires one.
              </P>
              <P>
                The practical mitigation available today is to run the machine yourself. A
                worker installed on your own server keeps execution and the workspace volume on
                hardware you control, in a location you chose.
              </P>
            </Clause>

            <Clause id="rights" index={12} heading="Your rights, and how to use them">
              <P>
                Depending on where you live you may have the right to access the personal data
                held about you, correct it, delete it, receive a copy of it, restrict or object
                to particular processing, and complain to a supervisory authority. Karo does not
                require a formal request for most of it:
              </P>
              <DiamondList
                items={[
                  'Access and correction: your profile, sessions, teams, projects and conversations are all visible and editable in the product.',
                  'Portability: metered usage exports as CSV from the usage page. Project files are files — download them, or push them to a git remote. There is no one-click archive of your whole account, so ask support if you need the rest.',
                  'Deletion: delete the conversation, the project, or the whole account from settings. Account deletion is immediate and has no export step, so export first.',
                  'Anything the interface does not cover — a question about what is held, or a complaint about how it was handled — goes to support and is answered by a person.',
                ]}
              />
              <P>
                Karo aims to answer a rights request within thirty days. Requests are verified
                against the account they concern, because “send me everything you have about
                this email address” is also what an attacker writes.
              </P>
            </Clause>

            <Clause id="children" index={13} heading="Age">
              <P>
                Karo is a developer tool and is not directed at children. Do not create an
                account if you are under 16, or under whatever higher age applies where you
                live. An account that Karo learns belongs to a child is deleted along with its
                data.
              </P>
            </Clause>

            <Clause id="changes" index={14} heading="Changes to this policy">
              <P>
                This policy changes when the product changes. The date at the top of the page
                moves only when the text does. A change that widens what Karo collects, or that
                alters where your prompts are processed, is announced by email and in the
                product before it takes effect — not applied quietly and documented afterwards.
              </P>
            </Clause>

            <Clause id="contact" index={15} heading="Contact">
              <P>
                Questions about this policy, requests about your data, or anything the product
                did with your data that this document does not describe:{' '}
                <a
                  className="rounded-sm text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                  href={`mailto:${siteConfig.contact.support}`}
                >
                  {siteConfig.contact.support}
                </a>
                . If you believe data has been exposed, write to{' '}
                <a
                  className="rounded-sm text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                  href={`mailto:${siteConfig.contact.security}`}
                >
                  {siteConfig.contact.security}
                </a>{' '}
                instead — that address is read as a security report and handled under the
                disclosure terms.
              </P>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/terms">Terms of service</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/security#data">How the controls work</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/about">About Karo</Link>
                </Button>
              </div>
            </Clause>
          </div>
        </div>
      </Section>
    </>
  );
}
