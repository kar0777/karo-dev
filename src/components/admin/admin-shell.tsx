'use client';

import { ArrowLeft, Menu, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import { KaroMark } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { ADMIN_NAV, activeAdminHref } from './nav';

/**
 * The admin chrome.
 *
 * Visually separated from the product on purpose — darker rail, a lock-up that
 * says "Admin" rather than the product wordmark, and the operator's own email
 * always on screen. Nobody should ever be unsure which console they are in
 * before clicking something destructive.
 */

export type AdminShellProps = {
  adminEmail: string;
  adminName: string;
  demoMode: boolean;
  openIncidents: number;
  children: React.ReactNode;
};

export function AdminShell({
  adminEmail,
  adminName,
  demoMode,
  openIncidents,
  children,
}: AdminShellProps) {
  const pathname = usePathname() ?? '/admin';
  const active = activeAdminHref(pathname);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // A route change should always leave the mobile drawer closed. The adjustment
  // happens during render rather than in an effect: React re-runs this component
  // with the closed drawer before painting, so the new page is never shown for a
  // frame with the old route's drawer still covering it.
  const [seenPathname, setSeenPathname] = React.useState(pathname);
  if (pathname !== seenPathname) {
    setSeenPathname(pathname);
    setMobileOpen(false);
  }

  return (
    <div className="karo-app flex min-h-dvh bg-bg-inset text-fg">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line-strong bg-bg-inset lg:flex">
        <AdminRail
          active={active}
          adminEmail={adminEmail}
          adminName={adminName}
          demoMode={demoMode}
          openIncidents={openIncidents}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="animate-slide-up-fade absolute inset-y-0 left-0 flex w-[min(17rem,85vw)] flex-col border-r border-line-strong bg-bg-inset shadow-pop">
            <AdminRail
              active={active}
              adminEmail={adminEmail}
              adminName={adminName}
              demoMode={demoMode}
              openIncidents={openIncidents}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line-strong bg-bg-inset/95 px-3 backdrop-blur-sm lg:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </Button>
          <AdminWordmark />
          <div className="ml-auto">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/app">
                <ArrowLeft className="size-3.5" />
                App
              </Link>
            </Button>
          </div>
        </header>

        <main id="admin-content" className="min-w-0 flex-1 bg-bg">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function AdminWordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex size-7 items-center justify-center rounded-md border border-line-strong bg-surface-3">
        <KaroMark size={16} />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-tight text-fg">Karo</span>
        <span className="mt-0.5 text-[10px] font-medium tracking-[0.14em] text-ember uppercase">
          Admin
        </span>
      </span>
    </span>
  );
}

function AdminRail({
  active,
  adminEmail,
  adminName,
  demoMode,
  openIncidents,
  onNavigate,
}: {
  active: string;
  adminEmail: string;
  adminName: string;
  demoMode: boolean;
  openIncidents: number;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line-strong px-3">
        <Link
          href="/admin"
          onClick={onNavigate}
          className="rounded-md focus-visible:outline-none"
          aria-label="Karo admin console"
        >
          <AdminWordmark />
        </Link>
        {onNavigate ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close navigation"
            onClick={onNavigate}
          >
            <X />
          </Button>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Admin" className="flex flex-col gap-4 px-2 py-3">
          {ADMIN_NAV.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <p className="px-2 pb-1 text-[10px] font-medium tracking-[0.12em] text-subtle uppercase">
                {group.label}
              </p>
              {group.items.map((item) => {
                const isActive = active === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.description}
                    className={cn(
                      'group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-150 ease-[var(--k-ease)]',
                      isActive
                        ? 'bg-surface-3 font-medium text-fg'
                        : 'text-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    <Icon
                      className={cn('size-4 shrink-0', isActive ? 'text-ember' : 'text-subtle')}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                    {item.href === '/admin/incidents' && openIncidents > 0 ? (
                      <Badge variant="danger" size="sm" className="ml-auto">
                        {openIncidents}
                      </Badge>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>

      <div className="shrink-0 border-t border-line-strong px-3 py-3">
        {demoMode ? (
          <p className="mb-2 flex items-center gap-1.5 rounded-md bg-ember-soft px-2 py-1.5 text-[11px] text-ember-soft-fg">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
            Demo mode — providers are simulated
          </p>
        ) : null}

        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[12px] font-medium text-fg">
            {adminName || 'Operator'}
          </span>
          <span className="truncate text-[11px] text-subtle">{adminEmail}</span>
        </div>

        <Separator className="my-2.5" />

        <Button variant="secondary" size="sm" className="w-full justify-start" asChild>
          <Link href="/app" onClick={onNavigate}>
            <ArrowLeft className="size-3.5" />
            Back to Karo
          </Link>
        </Button>
      </div>
    </>
  );
}
