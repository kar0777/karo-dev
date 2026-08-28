import Link from 'next/link';

import { KaroLogo } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { siteConfig } from '@/lib/metadata';

/* ------------------------------------------------------------------ *
 *  Public site footer
 *
 *  Every link here resolves to a page that exists. Nothing points at a
 *  blog, a status page or a careers page Karo does not have — a dead
 *  footer link is the fastest way to look unfinished.
 * ------------------------------------------------------------------ */

type FooterLink = { href: string; label: string; external?: boolean };
type FooterColumn = { title: string; links: readonly FooterLink[] };

const COLUMNS: readonly FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/features#terminal', label: 'Agent and terminal' },
      { href: '/features#sandbox', label: 'Sandboxed computers' },
      { href: '/features#byos', label: 'Bring your own server' },
      { href: '/features#docker', label: 'Docker support' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/docs', label: 'Documentation' },
      { href: '/docs#quickstart', label: 'Quickstart' },
      { href: '/docs#slash-commands', label: 'Slash commands' },
      { href: '/docs#mcp', label: 'MCP servers' },
      { href: '/docs#skills', label: 'Skills and plugins' },
      { href: '/docs#billing', label: 'Billing and metering' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About Karo' },
      { href: '/security', label: 'Security posture' },
      { href: '/pricing#faq', label: 'Pricing FAQ' },
      { href: `mailto:${siteConfig.contact.support}`, label: 'Support', external: true },
      { href: '/login?demo=1', label: 'Try the demo' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of service' },
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/security#disclosure', label: 'Responsible disclosure' },
      {
        href: `mailto:${siteConfig.contact.security}`,
        label: 'Report a vulnerability',
        external: true,
      },
    ],
  },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-bg-inset">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-4">
            <KaroLogo size={24} />
            <p className="max-w-sm text-[14px] leading-relaxed text-muted">
              An AI agent with a real, sandboxed Linux machine. It reads your files, runs your
              commands, connects your tools — and every token and compute-second is metered so
              you always know what a task cost.
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="primary" size="sm">
                Runs on your server or ours
              </Badge>
              <Badge variant="neutral" size="sm">
                Open standards: MCP
              </Badge>
            </div>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:justify-items-end"
          >
            {COLUMNS.map((column) => (
              <div key={column.title} className="flex min-w-0 flex-col gap-3">
                <h2 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
                  {column.title}
                </h2>
                <ul className="flex flex-col gap-2">
                  {column.links.map((link) => (
                    <li key={`${column.title}-${link.href}`}>
                      {link.external ? (
                        <a
                          href={link.href}
                          className="rounded-sm text-[13px] text-muted transition-colors duration-150 ease-[var(--k-ease)] hover:text-fg"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="rounded-sm text-[13px] text-muted transition-colors duration-150 ease-[var(--k-ease)] hover:text-fg"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-subtle">
            © {year} {siteConfig.name}. All rights reserved.
          </p>
          <p className="max-w-xl text-[12px] leading-relaxed text-subtle">
            <span className="font-medium text-muted">Demo content.</span> Project names,
            terminal transcripts, usage figures and workspace screenshots shown across this site
            are illustrative examples generated in demo mode. They are not customer data.
          </p>
        </div>
      </div>
    </footer>
  );
}
