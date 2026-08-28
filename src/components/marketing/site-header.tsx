'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { KaroLogo } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  Public site header
 *
 *  Sticky and translucent so the diamond lattice behind the hero keeps
 *  drifting under it, with a hairline that only appears once the page
 *  has actually scrolled — a permanent border under a transparent bar
 *  reads as a seam.
 * ------------------------------------------------------------------ */

const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
  { href: '/security', label: 'Security' },
] as const;

function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return scrolled;
}

export function SiteHeader() {
  const pathname = usePathname();
  const scrolled = useScrolled();
  const [menuOpen, setMenuOpen] = React.useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full transition-[background-color,box-shadow,border-color] duration-200 ease-[var(--k-ease)]',
        'border-b bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/65',
        scrolled ? 'border-line shadow-sm' : 'border-transparent',
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-5 sm:px-6 lg:px-8">
        <Link href="/" className="rounded-sm" aria-label="Karo — home">
          <KaroLogo size={22} />
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ease-[var(--k-ease)]',
                isActive(link.href)
                  ? 'bg-surface-2 text-fg'
                  : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />

          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>

          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/register">Start building</Link>
          </Button>

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="Open menu"
              >
                <Menu className="size-4" aria-hidden="true" />
              </Button>
            </SheetTrigger>

            <SheetContent side="right" className="w-[min(20rem,calc(100vw-2rem))]">
              <SheetHeader>
                <SheetTitle>
                  <KaroLogo size={20} />
                </SheetTitle>
              </SheetHeader>

              <nav aria-label="Mobile" className="flex flex-col gap-0.5">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive(link.href) ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 ease-[var(--k-ease)]',
                      isActive(link.href)
                        ? 'bg-surface-2 text-fg'
                        : 'text-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
                <Link
                  href="/about"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-2.5 py-2 text-sm font-medium text-muted transition-colors duration-150 ease-[var(--k-ease)] hover:bg-surface-2 hover:text-fg"
                >
                  About
                </Link>
              </nav>

              <Separator className="my-1" />

              <div className="flex flex-col gap-2">
                <Button asChild size="lg">
                  <Link href="/register" onClick={() => setMenuOpen(false)}>
                    Start building
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/login?demo=1" onClick={() => setMenuOpen(false)}>
                    Try the demo
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="lg">
                  <Link href="/login" onClick={() => setMenuOpen(false)}>
                    Sign in
                  </Link>
                </Button>
              </div>

              <p className="mt-auto text-[12px] leading-relaxed text-subtle">
                Demo mode runs on scripted providers — no card, no external credentials, nothing
                leaves the server.
              </p>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
