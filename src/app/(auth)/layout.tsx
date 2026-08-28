import type { ReactNode } from 'react';
import Link from 'next/link';

import { DiamondAccent, LatticeBackdrop } from '@/components/brand/lattice';
import { KaroLogo } from '@/components/brand/logo';
import { publicConfig } from '@/lib/env';

/**
 * The signed-out shell.
 *
 * Left is the work: one column, `max-w-sm`, nothing competing with the form.
 * Right is the claim, and it only appears at `lg` and above where there is room
 * for it to be an aside rather than a wall to scroll past. The panel keeps the
 * terminal surface in both themes — Karo's product is a machine you are handed,
 * and the sign-in screen may as well look like the thing it unlocks.
 */

export const dynamic = 'force-dynamic';

const CAPABILITIES = [
  {
    title: 'A real machine, not a code sandbox toy',
    body: 'Every project gets an isolated Linux box. The agent edits files, installs packages and runs your test suite in an actual shell.',
  },
  {
    title: 'Metered while it runs, not after',
    body: 'Weighted tokens and compute-seconds are settled as they are spent, so a run’s cost is visible long before the invoice is.',
  },
  {
    title: 'Tools you bring, wired in',
    body: 'Connect MCP servers, install skills and plugins. The agent picks up the new tools on its next turn — no redeploy.',
  },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { demoMode } = publicConfig();

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <main className="flex flex-col px-5 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
          <Link
            href="/"
            aria-label="Karo — back to the home page"
            className="inline-flex self-start rounded-md transition-opacity hover:opacity-80"
          >
            <KaroLogo size={22} />
          </Link>

          <div className="flex flex-1 flex-col justify-center py-10">{children}</div>

          <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-subtle">
            <Link href="/terms" className="rounded-sm hover:text-muted">
              Terms
            </Link>
            <Link href="/privacy" className="rounded-sm hover:text-muted">
              Privacy
            </Link>
            <Link href="/docs" className="rounded-sm hover:text-muted">
              Docs
            </Link>
            {demoMode ? (
              <span className="inline-flex items-center gap-1.5">
                <DiamondAccent size={5} tone="ember" />
                Demo mode — mock model, sandbox and billing providers
              </span>
            ) : null}
          </footer>
        </div>
      </main>

      <aside className="relative isolate hidden overflow-hidden bg-term-bg text-term-fg lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14">
        <LatticeBackdrop fade="full" opacity={16} />

        <p className="text-[11px] tracking-[0.14em] text-term-fg/45 uppercase">
          Karo — cloud workspace
        </p>

        <div className="max-w-md">
          <h2 className="text-2xl leading-snug font-semibold tracking-tight text-term-fg">
            Give your coding agent a computer, then watch what it costs.
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-term-fg/70">
            Karo pairs an agent that reads and writes your project with a sandboxed machine it
            can actually run things on — and meters every token and compute-second while it
            does.
          </p>

          <ul className="mt-8 space-y-5">
            {CAPABILITIES.map((capability) => (
              <li key={capability.title} className="flex gap-3">
                <DiamondAccent size={6} tone="primary" className="mt-1.5" />
                <div>
                  <p className="text-[13px] font-medium text-term-fg">{capability.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-term-fg/65">
                    {capability.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] leading-relaxed text-term-fg/45">
          Sandboxes are isolated per project. Commands are policy-checked before they run, and
          nothing executes on the web host.
        </p>
      </aside>
    </div>
  );
}
