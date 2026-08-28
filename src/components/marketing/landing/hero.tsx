import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { DiamondAccent, LatticeBackdrop } from '@/components/brand/lattice';
import { CONTAINER } from '@/components/marketing/section';
import { Button } from '@/components/ui/button';

/**
 * Hero.
 *
 * The trust signals under the CTAs are deliberately unglamorous and
 * verifiable — no logo wall, no invented customer count. Everything
 * claimed here is enforced somewhere in the product.
 */

const TRUST_SIGNALS = [
  'Runs on your server or ours',
  'No card for demo mode',
  'Open standards: MCP',
  'Every token and second metered',
] as const;

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <LatticeBackdrop fade="top" opacity={55} animated />

      <div className={`${CONTAINER} pt-16 pb-12 sm:pt-24 sm:pb-16 lg:pt-28`}>
        <div className="flex max-w-3xl flex-col items-start gap-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-[12px] text-muted backdrop-blur-sm">
            <DiamondAccent size={6} tone="primary" />
            An agent, a terminal, MCP, skills and a sandbox — in one workspace
          </p>

          <h1 className="text-4xl leading-[1.08] text-balance sm:text-5xl lg:text-[3.5rem]">
            Build anything with an AI agent that has a real computer.
          </h1>

          <p className="max-w-2xl text-[17px] leading-relaxed text-muted">
            Karo gives the agent its own sandboxed Linux machine. It reads and writes your
            project files, runs real shell commands in a terminal you can watch, connects tools
            over MCP, loads skills you install — and every token and compute-second is metered,
            so a task's cost is never a surprise.
          </p>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Button asChild size="lg" iconRight={<ArrowRight aria-hidden="true" />}>
              <Link href="/register">Start building</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/pricing">View pricing</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/login?demo=1">Try demo</Link>
            </Button>
          </div>

          <ul className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-subtle">
            {TRUST_SIGNALS.map((signal, index) => (
              <li key={signal} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
