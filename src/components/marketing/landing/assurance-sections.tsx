import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

import { LatticeBackdrop } from '@/components/brand/lattice';
import { FaqAccordion } from '@/components/marketing/faq-accordion';
import { LANDING_FAQ } from '@/components/marketing/faq-data';
import { CONTAINER, Section, SectionIntro } from '@/components/marketing/section';
import {
  LANDING_SECURITY_IDS,
  SECURITY_CONTROLS,
} from '@/components/marketing/security-controls';
import { Button } from '@/components/ui/button';

/* ------------------------------------------------------------------ *
 *  Landing sections 11, 14 and 15.
 * ------------------------------------------------------------------ */

const LANDING_CONTROLS = LANDING_SECURITY_IDS.map((id) =>
  SECURITY_CONTROLS.find((control) => control.id === id),
).filter((control): control is (typeof SECURITY_CONTROLS)[number] => control !== undefined);

export function SecuritySection() {
  return (
    <Section id="security">
      <SectionIntro
        eyebrow="Security and isolation"
        title="The controls, named — so you can check them."
        description="Giving an AI agent a shell is only reasonable if the shell is boxed in and everything it does is recorded. These are the mechanisms Karo relies on, not a summary of intentions."
      />

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LANDING_CONTROLS.map((control) => (
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

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <Link href="/security">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Full security posture
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
        <p className="text-[12.5px] text-subtle">
          Including responsible disclosure, data handling and what Karo does not yet have.
        </p>
      </div>
    </Section>
  );
}

export function FaqSection() {
  return (
    <Section id="faq" tone="inset">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)] lg:gap-14">
        <SectionIntro
          eyebrow="Questions"
          title="The things people ask before signing up."
          description="If something here is still unclear, the documentation goes deeper — and the demo answers most of it faster than any page can."
        >
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/docs">Read the docs</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/login?demo=1">Open the demo</Link>
            </Button>
          </div>
        </SectionIntro>

        <FaqAccordion entries={LANDING_FAQ} idPrefix="landing" />
      </div>
    </Section>
  );
}

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden border-t border-line">
      <LatticeBackdrop fade="top" opacity={45} animated />

      <div className={`${CONTAINER} py-16 sm:py-20 lg:py-24`}>
        <div className="flex max-w-3xl flex-col items-start gap-5">
          <h2 className="text-3xl text-balance sm:text-4xl">
            Give the agent a machine and see what it ships.
          </h2>
          <p className="max-w-2xl text-[16px] leading-relaxed text-muted">
            Start with the demo — no card, no provider keys, nothing to configure. When you are
            ready for a real sandbox and a real model, the same workspace picks up where you
            left off.
          </p>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Button asChild size="lg" iconRight={<ArrowRight aria-hidden="true" />}>
              <Link href="/register">Start building</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login?demo=1">Try the demo</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/pricing">Compare plans</Link>
            </Button>
          </div>

          <p className="text-[13px] text-subtle">
            Runs on your server or ours · Bring your own model key · Every token and second
            itemised
          </p>
        </div>
      </div>
    </section>
  );
}
