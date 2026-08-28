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
import { buildMetadata, siteConfig } from '@/lib/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Terms of service',
  description:
    'The agreement covering Karo accounts and teams, acceptable use of a sandboxed machine that runs arbitrary code, metered token and compute billing, prepaid balances, suspension and liability.',
  path: '/terms',
});

/**
 * Fixed rather than computed.
 *
 * A policy date that moves on its own is worthless: it has to change only when
 * the text does, so it is written here as a literal and edited by hand.
 */
const LAST_UPDATED = '26 July 2026';

const NAV_GROUPS = [
  {
    title: 'The agreement',
    items: [
      { id: 'scope', label: 'Scope' },
      { id: 'accounts', label: 'Accounts' },
      { id: 'teams', label: 'Teams and roles' },
    ],
  },
  {
    title: 'Using Karo',
    items: [
      { id: 'service', label: 'What Karo provides' },
      { id: 'acceptable-use', label: 'Acceptable use' },
      { id: 'your-content', label: 'Your code' },
      { id: 'output', label: 'Agent output' },
    ],
  },
  {
    title: 'Paying for it',
    items: [
      { id: 'billing', label: 'Metered billing' },
      { id: 'balance', label: 'Balance and invoices' },
    ],
  },
  {
    title: 'Limits and endings',
    items: [
      { id: 'third-parties', label: 'Third parties' },
      { id: 'availability', label: 'Availability' },
      { id: 'termination', label: 'Termination' },
      { id: 'liability', label: 'Liability' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'changes', label: 'Changes' },
      { id: 'law', label: 'Governing law' },
      { id: 'contact', label: 'Contact' },
    ],
  },
] as const;

/* ------------------------------------------------------------------ *
 *  Local document primitives
 *
 *  Legal copy is a numbered stack of dense body text, which the marketing
 *  kit has no primitive for. These keep the type scale and colour
 *  identical across every clause instead of repeating the same class
 *  strings sixty times; lists reuse DiamondList so the document matches
 *  the rest of the public site.
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

export default function TermsPage() {
  return (
    <>
      <JsonLd
        data={[
          webPageJsonLd({
            name: 'Karo terms of service',
            description:
              'Accounts and teams, acceptable use of a sandboxed machine, metered billing, prepaid balances, suspension, liability and contact details.',
            path: '/terms',
          }),
          breadcrumbJsonLd([{ name: 'Terms of service', path: '/terms' }]),
        ]}
      />

      <section className="relative isolate overflow-hidden">
        <LatticeBackdrop fade="top" opacity={45} />
        <div className={`${CONTAINER} pt-14 pb-10 sm:pt-20`}>
          <SectionIntro
            eyebrow="Legal"
            eyebrowTone="muted"
            title="Terms of service"
            description="The rules for using Karo: what you get, what you may run on a machine Karo gives you, how the meter charges you for it, and what happens when something goes wrong. Written to be read rather than to be survived."
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
              These terms describe how Karo actually behaves, and they are a reasonable starting
              point — but they have not been drafted or reviewed by a lawyer. If you operate
              Karo commercially, have counsel review this document, complete the clauses marked
              as needing an operator, and check it against the law where your company and your
              customers are.
            </AlertDescription>
          </Alert>
        </div>
      </section>

      <Section size="sm">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-14">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <SidebarNav groups={NAV_GROUPS} label="Terms of service" />
          </div>

          <div className="flex max-w-3xl flex-col gap-8">
            <Clause
              id="scope"
              index={1}
              heading="Who this agreement is between"
              note={<TemplateField />}
            >
              <P>
                “Karo” means this service and the company operating it. That company’s legal
                name, registered address and company number belong here; an operator running
                Karo must fill them in before relying on this document.
              </P>
              <P>
                “You” means the person who created the account, and — where an account belongs
                to a company — the company on whose behalf it was created. By creating an
                account or using Karo you accept these terms. If you do not accept them, do not
                create an account.
              </P>
              <P>
                You must be old enough to enter a contract where you live, and you must not be
                barred from receiving the service under applicable sanctions or export rules.
              </P>
            </Clause>

            <Clause id="accounts" index={2} heading="Accounts">
              <DiamondList
                items={[
                  'One account belongs to one person. Give a real email address you can receive mail at, because verification, password resets and billing notices go there.',
                  'You are responsible for what happens under your account. Keep your password to yourself, and revoke a session from the settings page if you think it is no longer yours.',
                  'Karo stores your password as a scrypt hash and can never tell you what it was. A reset link is the only recovery path.',
                  'The shared demo account is a public sandbox. Anything you create in it is visible to other people and may be reset at any time. Do not put anything real in it.',
                  'Do not create accounts automatically, resell accounts, or share one account across a team — teams exist for that, and seats are a plan limit.',
                ]}
              />
            </Clause>

            <Clause id="teams" index={3} heading="Teams, roles and who is responsible">
              <P>
                Work in Karo belongs to a team, not to a person. A team has one owner, and the
                owner is the party responsible for that team’s charges. Members are added by
                invitation and hold one of four roles — owner, admin, developer or viewer — each
                mapped to an explicit list of permissions that every mutating request checks.
              </P>
              <DiamondList
                items={[
                  'An owner or admin can invite, remove and change the role of other members, subject to the seat limit on the plan.',
                  'Anything a member does inside a team is attributed to them in the audit log, and the team is accountable for it under these terms.',
                  'If you invite someone to a team, you are asserting that you are entitled to give them access to that team’s projects, files and conversations.',
                  'Deleting an account that owns a team with other members is refused. Hand the team over first — Karo will not silently delete other people’s work.',
                ]}
              />
            </Clause>

            <Clause id="service" index={4} heading="What Karo provides">
              <P>
                Karo provides a workspace in which an AI agent operates a sandboxed Linux
                machine on your behalf: it reads and writes the files in your project, runs
                shell commands, connects to tools you configure over the Model Context Protocol,
                and reports what it did. One sandbox is created per project. It sleeps when idle
                and is destroyed after the retention window on your plan.
              </P>
              <P>
                Features are gated by plan. Concurrency, machine size, storage, seats, audit
                retention, container support and preview deployments are numbers in the plan
                catalogue, not discretionary decisions, and the current values are published on
                the pricing page.
              </P>
              <P>
                Karo may change, add or remove features. Where a change reduces something you
                are paying for, you will be told before it takes effect and may cancel.
              </P>
            </Clause>

            <Clause
              id="acceptable-use"
              index={5}
              heading="Acceptable use of a machine that runs your code"
            >
              <P>
                A Karo sandbox executes arbitrary code, which is the point of it. That makes the
                following rules the most important part of this document. They exist so that one
                tenant cannot degrade the service for everyone else, and so that Karo is not
                used as infrastructure for harming other people.
              </P>
              <P>
                <strong className="font-semibold text-fg">Allowed.</strong> Building, testing,
                debugging and running your own software, including production workloads on the
                plans that permit them. Installing packages and toolchains. Running containers
                where your plan allows it. Reaching networks and APIs you are entitled to reach.
              </P>
              <P>
                <strong className="font-semibold text-fg">Not allowed.</strong>
              </P>
              <DiamondList
                items={[
                  'Cryptocurrency mining, proof-of-work, and other work whose purpose is to consume compute rather than to produce software.',
                  'Bulk scraping of third-party sites, credential stuffing, password cracking, port scanning of hosts you do not own, or any form of unauthorised access.',
                  'Sending spam or bulk email, operating open relays or proxies, or running services designed to conceal the origin of traffic.',
                  'Torrenting or distributing material you do not have the rights to distribute.',
                  'Reselling raw Karo compute, or making a sandbox available to third parties as a general-purpose machine.',
                  'Attacking Karo itself: attempting to escape the sandbox, reach the host, reach another tenant, or defeat metering, permission checks or spend guards. Security research is welcome, but under the disclosure terms on the security page, not against other people’s data.',
                  'Storing or generating material that is illegal where you or Karo operates, including material that sexually exploits children, and content whose purpose is harassment or incitement.',
                  'Circumventing plan limits, rate limits or a suspension, including by creating additional accounts.',
                ]}
              />
              <P>
                You are responsible for everything that runs in your sandbox, including commands
                the agent runs because you asked it to. The command policy denies obviously
                destructive operations and asks you to confirm privileged ones, but it is a
                safety net rather than a guarantee: an instruction you approve is an instruction
                you gave.
              </P>
            </Clause>

            <Clause id="your-content" index={6} heading="Your projects, your code">
              <P>
                You keep every right you already had in the code, files and text you bring to
                Karo or create in it. Karo claims no ownership of your work and does not use it
                to train models.
              </P>
              <P>
                To run the service, you grant Karo the narrow licence it needs to do what you
                asked: store your files, display them back to you, transmit the relevant parts
                to the model provider configured for your request so the agent can reason about
                them, and copy them into the sandbox that executes them. That licence exists
                only to operate the service and ends when the content is deleted.
              </P>
              <P>
                You confirm that you have the rights to everything you upload or have the agent
                fetch, and that processing it through Karo does not breach an obligation you owe
                someone else — a licence, an NDA or a data-processing agreement of your own.
              </P>
            </Clause>

            <Clause id="output" index={7} heading="Output from the agent">
              <P>
                The agent produces code, commands and prose from a statistical model. It can be
                confidently wrong, it can delete something you wanted, and it can write a
                plausible test that proves nothing. Review its work before you ship it, exactly
                as you would review a colleague’s.
              </P>
              <DiamondList
                items={[
                  'Karo makes no warranty that output is correct, secure, performant, licence-clean or fit for any purpose.',
                  'Similar prompts from different users can produce similar output. Karo cannot grant you exclusivity in anything the model generates.',
                  'Do not treat agent output as legal, medical, financial or safety advice, and do not put it in a position where a wrong answer hurts someone without a human reviewing it first.',
                  'Where you are subject to rules about automated processing or disclosure of AI assistance, meeting those rules is your responsibility.',
                ]}
              />
            </Clause>

            <Clause id="billing" index={8} heading="Metered billing">
              <P>
                Karo meters two units. Weighted tokens measure model use: input, output, cached
                reads and cache writes are counted separately and each is multiplied by its own
                factor before being added up. Compute hours measure machine time: seconds accrue
                while a sandbox is awake, multiplied by the size factor of the machine. Both are
                visible while a run happens and itemised afterwards, and every charge links back
                to the conversation that caused it.
              </P>
              <DiamondList
                items={[
                  'A subscription includes a monthly allowance of both units. Weighted tokens and compute come out of that allowance first; usage past it is billed at the plan’s published overage rate.',
                  'A plan that publishes no overage rate bills overage at upstream cost plus the platform margin. That is what a zero in the pricing table means.',
                  'Allowances do not roll over. An unused allowance is not refunded and is not credited to the next period.',
                  'Requests made with your own model key are not charged by Karo and do not draw down an allowance. Your provider bills you directly for those tokens.',
                  'Compute that runs on your own server is metered so you can see it, and billed at zero.',
                  'An expensive run is estimated before it starts and checked against your allowance, balance, credit limit and monthly spending cap. If a guard blocks it, you are told which limit was hit and what would clear it.',
                  'All amounts are computed as integer micro-USD, so sub-cent charges are recorded exactly rather than rounded away.',
                ]}
              />
              <P>
                Prices, allowances and limits are published in the plan catalogue. Karo may
                change them; a change that raises what you pay takes effect from your next
                billing period, and you will be told before it does.
              </P>
            </Clause>

            <Clause id="balance" index={9} heading="Prepaid balance, invoices and refunds">
              <DiamondList
                items={[
                  'Pay as you go runs on a prepaid balance. You top it up, usage draws it down, and execution stops when the balance is exhausted beyond any credit limit on the account.',
                  'A top-up buys service credit. It is not a deposit, it does not expire while the account is open, and it is not transferable between teams.',
                  'Subscriptions are billed for the period in advance. Upgrades apply immediately and are prorated; downgrades apply at the end of the current period.',
                  'Card details are handled by the payment processor. Karo stores the processor’s references, never a card number.',
                  'Consumed usage is not refundable: the tokens and the machine time were really spent. Unused prepaid balance may be refunded at Karo’s discretion, less anything already consumed.',
                  'If Karo charges you for something the meter did not record, tell support and it will be corrected. The usage export exists so you can check.',
                  'Prices are exclusive of tax unless stated otherwise; you are responsible for taxes that apply to you.',
                  'A failed payment suspends new runs rather than deleting anything. Existing work stays where it is while you fix the payment method.',
                ]}
              />
            </Clause>

            <Clause
              id="third-parties"
              index={10}
              heading="Model providers, MCP servers and plugins"
            >
              <P>
                Karo is a client of other systems. Prompts are sent to the model provider
                configured for the request. Sandboxes run on a provider — Karo’s own, a
                container host, or a worker you install on your hardware. Payments go through a
                payment processor.
              </P>
              <DiamondList
                items={[
                  'When you connect an MCP server, install a plugin or supply your own model key, you are choosing that third party. Karo checks outbound URLs against private and metadata ranges and lets you allow individual tools, but it does not vouch for what a third party does with a request you authorised.',
                  'Credentials you store for a third party are encrypted and injected into the process that needs them. They are never returned to a browser and never placed in a conversation.',
                  'A third party’s own terms apply to your use of it. Where they conflict with these terms, these terms govern your relationship with Karo only.',
                  'Karo may change which providers it uses. If a change alters where your prompts are processed, the privacy policy is updated with it.',
                ]}
              />
            </Clause>

            <Clause id="availability" index={11} heading="Availability, sleep and data loss">
              <P>
                Self-serve plans carry no contractual uptime guarantee. Karo aims to be
                available and will tell you when it is not, but there is no service credit
                scheme at these prices.
              </P>
              <DiamondList
                items={[
                  'A sandbox sleeps after the idle timeout on your plan and is destroyed after its retention window. Files in the workspace survive sleep; they do not survive destruction.',
                  'Treat a sandbox as rebuildable. Keep authoritative copies of your work in version control or somewhere else you control.',
                  'Karo may take the service down for maintenance and may stop a run that is destabilising shared infrastructure.',
                  'Preview URLs are reachable only while the sandbox is awake and rotate when it is recreated. They are not a hosting product.',
                ]}
              />
            </Clause>

            <Clause id="termination" index={12} heading="Suspension, termination and deletion">
              <DiamondList
                items={[
                  'You may stop using Karo at any time. Cancelling a subscription ends it at the end of the paid period; deleting your account is immediate and irreversible.',
                  'Deleting your account removes your projects, files, conversations, sandboxes, stored keys and sessions. There is no export step and no grace period, so take what you need first.',
                  'Invoices and billing records are retained because accounting rules require it. Audit entries are retained with your account reference removed.',
                  'A sandbox that breaks a rule in clause 5 is stopped first, and you are told which rule and what to change. An account is suspended only if the behaviour continues, or immediately where the conduct is illegal or endangers other tenants.',
                  'Karo may terminate an account for repeated or serious breach, for non-payment after notice, or where required by law. Prepaid balance left over after a termination that was not your fault is refunded.',
                  'Clauses on your content, billing already incurred, liability and governing law survive termination.',
                ]}
              />
            </Clause>

            <Clause
              id="liability"
              index={13}
              heading="Warranties and liability"
              note={<TemplateField />}
            >
              <P>
                Karo is provided as is. To the extent the law allows, Karo disclaims implied
                warranties of merchantability, fitness for a particular purpose and
                non-infringement, and does not warrant that the service will be uninterrupted,
                that a sandbox will always be available, or that agent output will be correct.
              </P>
              <P>
                Neither party is liable for indirect, incidental, special or consequential loss,
                or for lost profits, revenue or data, even if warned it was possible. Karo’s
                total liability arising from this agreement is limited to the amount you paid
                Karo in the twelve months before the claim.
              </P>
              <P>
                Nothing here excludes liability that cannot lawfully be excluded — for example
                death or personal injury caused by negligence, or fraud. An operator must have
                counsel confirm that this clause is enforceable, and in what form, in the
                jurisdictions it intends to sell into.
              </P>
              <P>
                You will indemnify Karo against claims arising from content you put into the
                service or code you had it run, to the extent the claim results from your breach
                of these terms.
              </P>
            </Clause>

            <Clause id="changes" index={14} heading="Changes to these terms">
              <P>
                Karo may update these terms. The date at the top of this page changes when the
                text does. A material change — one that reduces your rights or increases your
                obligations — is announced by email and in the product at least fourteen days
                before it takes effect, and continuing to use Karo after that date is
                acceptance. If you do not accept it, cancel before the date and any unused
                prepaid balance is refunded.
              </P>
            </Clause>

            <Clause
              id="law"
              index={15}
              heading="Governing law and disputes"
              note={<TemplateField />}
            >
              <P>
                The governing law and the courts with jurisdiction belong here, and they depend
                on where the operating company is established. This template deliberately does
                not guess: naming the wrong forum is worse than naming none, and
                consumer-protection rules in your customers’ countries may override whatever you
                choose.
              </P>
              <P>
                Before starting formal proceedings, write to support. Most disputes about Karo
                are disputes about a number in the usage export, and those are faster to settle
                by looking at it together.
              </P>
            </Clause>

            <Clause id="contact" index={16} heading="Contact">
              <P>
                Questions about these terms, about a charge, or about anything the product did
                that this document does not describe:{' '}
                <a
                  className="rounded-sm text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                  href={`mailto:${siteConfig.contact.support}`}
                >
                  {siteConfig.contact.support}
                </a>
                . Vulnerability reports go to{' '}
                <a
                  className="rounded-sm text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                  href={`mailto:${siteConfig.contact.security}`}
                >
                  {siteConfig.contact.security}
                </a>{' '}
                under the disclosure terms on the security page.
              </P>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/privacy">Privacy policy</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/security">Security posture</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/pricing">Pricing and limits</Link>
                </Button>
              </div>
            </Clause>
          </div>
        </div>
      </Section>
    </>
  );
}
