'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { ChevronRight, Menu, PanelLeft, Rocket, Search, Shield } from 'lucide-react';

import { CommandPalette } from '@/components/app/command-palette';
import { DemoModeBadge } from '@/components/app/demo-banner';
import { NotificationsPopover } from '@/components/app/notifications-popover';
import { PlatformNotices } from '@/components/app/platform-notices';
import { QuotaBlock } from '@/components/app/quota-block';
import { TeamSwitcher } from '@/components/app/team-switcher';
import { UserMenu } from '@/components/app/user-menu';
import { buildBreadcrumbs, isNavActive, localizeNav, type NavItem } from '@/components/app/nav';
import { useTranslator } from '@/components/i18n-provider';
import { useSession } from '@/components/app/session-provider';
import type {
  ShellNotification,
  ShellPlatformNotices,
  ShellProjectRef,
  ShellQuota,
} from '@/components/app/shell-data';
import { KaroLogo, KaroMark } from '@/components/brand/logo';
import type { ShellTeamOption } from '@/components/app/shell-data';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PlanTier } from '@/lib/db/schema';
import { cn, isAppleDevice } from '@/lib/utils';

/**
 * The authenticated chrome: sidebar, top bar, command palette.
 *
 * Layout notes
 * ------------
 * · The sidebar is a fixed-width column that collapses to an icon rail. The
 *   width is driven by a CSS variable so the collapse animates without the
 *   main column reflowing its children.
 * · Collapse state is a device preference, so it is read from localStorage
 *   *after* mount. Rendering the expanded rail on the server and correcting on
 *   the client avoids a hydration mismatch and is invisible in practice.
 * · Below `lg` the same rail is rendered inside a Sheet. There is exactly one
 *   implementation of the navigation, not two.
 */

const SIDEBAR_STORAGE_KEY = 'karo.sidebar.collapsed';
const EXPANDED_WIDTH = '232px';
const COLLAPSED_WIDTH = '56px';

/* ------------------------------------------------------------------ *
 *  Collapse preference store
 * ------------------------------------------------------------------ */

/**
 * The collapse flag is an external store rather than React state: it is
 * persisted in localStorage, written by the toggle, and can be changed by
 * another tab. Reading it through `useSyncExternalStore` gets the server
 * snapshot (expanded) and the client one from the same call, so there is no
 * mount effect re-rendering the shell after commit.
 *
 * The value is cached in memory because that cache — not localStorage — is what
 * the snapshot returns. When storage is denied and the write below throws, the
 * toggle still applies for the rest of the session, which is how the previous
 * `useState` version behaved.
 */
let cachedCollapsed: boolean | null = null;
const collapsedListeners = new Set<() => void>();

function loadCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    /* private browsing or a blocked storage partition — keep the default */
    return false;
  }
}

function getCollapsed(): boolean {
  cachedCollapsed ??= loadCollapsed();
  return cachedCollapsed;
}

function setCollapsedPreference(next: boolean) {
  cachedCollapsed = next;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
  // `storage` only fires in the other tabs, so this one is notified by hand.
  for (const notify of collapsedListeners) notify();
}

function subscribeCollapsed(onStoreChange: () => void) {
  function onStorage(event: StorageEvent) {
    // A `null` key means the whole store was cleared, which counts as a change.
    if (event.key !== null && event.key !== SIDEBAR_STORAGE_KEY) return;
    cachedCollapsed = loadCollapsed();
    onStoreChange();
  }

  collapsedListeners.add(onStoreChange);
  window.addEventListener('storage', onStorage);
  return () => {
    collapsedListeners.delete(onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Subscriber for snapshots that cannot change once the client is running. */
const NO_STORE_SUBSCRIBE = () => () => {};

export type AppShellProps = {
  teams: readonly ShellTeamOption[];
  quota: ShellQuota;
  planName: string;
  planTier: PlanTier;
  subscribed: boolean;
  projects: readonly ShellProjectRef[];
  notifications: readonly ShellNotification[];
  unreadNotifications: number;
  /** Maintenance mode and the announcement, both set in the admin console. */
  platform: ShellPlatformNotices;
  /** Drives the "finish setting up" banner for users who skipped past it. */
  onboardingComplete: boolean;
  children: React.ReactNode;
};

export function AppShell({
  teams,
  quota,
  planName,
  planTier,
  subscribed,
  projects,
  notifications,
  unreadNotifications,
  platform,
  onboardingComplete,
  children,
}: AppShellProps) {
  const t = useTranslator();
  const pathname = usePathname() ?? '/app';
  const router = useRouter();
  const { user } = useSession();

  const collapsed = React.useSyncExternalStore(subscribeCollapsed, getCollapsed, () => false);
  const isApple = React.useSyncExternalStore(NO_STORE_SUBSCRIBE, isAppleDevice, () => false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [drawerRoute, setDrawerRoute] = React.useState(pathname);

  // Close the mobile drawer on navigation; leaving it open hides the page. The
  // reset is applied during render rather than from an effect so the drawer is
  // already closed in the commit that first shows the new route: React re-runs
  // the component with the adjusted state and discards the stale output.
  if (pathname !== drawerRoute) {
    setDrawerRoute(pathname);
    setMobileOpen(false);
  }

  const toggleCollapsed = React.useCallback(() => {
    setCollapsedPreference(!getCollapsed());
  }, []);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (key === 'b') {
        event.preventDefault();
        toggleCollapsed();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleCollapsed]);

  const openCreateProject = React.useCallback(() => {
    router.push('/app/projects?new=1');
  }, [router]);

  const crumbs = buildBreadcrumbs(pathname, t);
  const modKey = isApple ? '⌘' : 'Ctrl';

  const rail = (
    <SidebarRail
      collapsed={collapsed}
      teams={teams}
      quota={quota}
      planName={planName}
      planTier={planTier}
      subscribed={subscribed}
      pathname={pathname}
      isPlatformAdmin={user.platformRole === 'admin'}
      onToggleCollapsed={toggleCollapsed}
      modKey={modKey}
    />
  );

  return (
    <div
      className="karo-app flex min-h-dvh bg-bg"
      style={
        {
          '--karo-sidebar': collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
        } as React.CSSProperties
      }
    >
      {/* Desktop rail */}
      <aside
        aria-label="Primary"
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 border-r border-line bg-surface lg:flex lg:flex-col',
          'w-[var(--karo-sidebar)] transition-[width] duration-200 ease-[var(--k-ease)]',
        )}
      >
        {rail}
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[17rem] gap-0 border-r bg-surface p-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-full flex-col">
            <SidebarRail
              collapsed={false}
              teams={teams}
              quota={quota}
              planName={planName}
              planTier={planTier}
              subscribed={subscribed}
              pathname={pathname}
              isPlatformAdmin={user.platformRole === 'admin'}
              onToggleCollapsed={null}
              modKey={modKey}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-md sm:px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-4" aria-hidden="true" />
          </Button>

          <Link href="/app" className="rounded-md lg:hidden" aria-label="Karo — Overview">
            <KaroMark size={20} />
          </Link>

          <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 sm:block">
            <ol className="flex min-w-0 items-center gap-1 text-[12px] text-subtle">
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                  {index > 0 ? (
                    <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
                  ) : null}
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="truncate rounded-sm transition-colors hover:text-fg"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="truncate text-fg">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex flex-1 items-center justify-end gap-1.5 sm:flex-none">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className={cn(
                'group flex h-7 items-center gap-2 rounded-md border border-line bg-surface px-2 text-left',
                'transition-colors duration-150 ease-[var(--k-ease)] hover:border-line-strong hover:bg-surface-2',
                'w-full max-w-64 sm:w-56 md:w-64',
              )}
              aria-label={`Search projects and commands (${modKey}+K)`}
            >
              <Search className="size-3.5 shrink-0 text-subtle" aria-hidden="true" />
              <span className="flex-1 truncate text-[12px] text-subtle">
                Search projects, commands…
              </span>
              <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
                <Kbd>{modKey}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>

            <DemoModeBadge className="hidden sm:inline-flex" />
            <NotificationsPopover
              notifications={notifications}
              unreadCount={unreadNotifications}
            />
          </div>
        </header>

        {/*
          Above the onboarding nudge: during an incident the incident is the
          more important thing on the page.
        */}
        <PlatformNotices notices={platform} />

        {!onboardingComplete ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-primary-soft px-4 py-2">
            <p className="flex items-center gap-2 text-[12.5px] text-primary-soft-fg">
              <Rocket className="size-4 shrink-0" aria-hidden="true" />
              Your setup is unfinished — pick a model, choose where machines run and create your
              first project.
            </p>
            <Button asChild size="xs" variant="primary">
              <Link href="/app/onboarding">Finish setup</Link>
            </Button>
          </div>
        ) : null}

        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={projects}
        onCreateProject={openCreateProject}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Rail
 * ------------------------------------------------------------------ */

type SidebarRailProps = {
  collapsed: boolean;
  teams: readonly ShellTeamOption[];
  quota: ShellQuota;
  planName: string;
  planTier: PlanTier;
  subscribed: boolean;
  pathname: string;
  isPlatformAdmin: boolean;
  /** `null` inside the mobile drawer, where collapsing makes no sense. */
  onToggleCollapsed: (() => void) | null;
  modKey: string;
};

function SidebarRail({
  collapsed,
  teams,
  quota,
  planName,
  planTier,
  subscribed,
  pathname,
  isPlatformAdmin,
  onToggleCollapsed,
  modKey,
}: SidebarRailProps) {
  // Read here rather than threaded down as a prop: the rail is the only part of
  // the shell with navigation copy in it, and the provider is mounted by the
  // `/app` layout above every route that renders this.
  const t = useTranslator();
  const navGroups = localizeNav(t);

  return (
    <>
      <div
        className={cn(
          'flex h-12 shrink-0 items-center border-b border-line px-2',
          collapsed ? 'justify-center' : 'justify-between gap-1',
        )}
      >
        <Link
          href="/app"
          className="flex min-w-0 items-center rounded-md px-1"
          aria-label="Karo — Overview"
        >
          {collapsed ? <KaroMark size={20} /> : <KaroLogo size={20} />}
        </Link>
        {onToggleCollapsed && !collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapsed}
                aria-label="Collapse sidebar"
              >
                <PanelLeft className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar · {modKey}+B</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className={cn('shrink-0 border-b border-line p-2', collapsed && 'px-1.5')}>
        <TeamSwitcher
          teams={teams}
          planName={planName}
          planTier={planTier}
          collapsed={collapsed}
        />
      </div>

      <nav
        aria-label="Product"
        className={cn(
          'karo-no-scrollbar min-h-0 flex-1 overflow-y-auto p-2',
          collapsed && 'px-1.5',
        )}
      >
        {navGroups.map((group) => (
          <div key={group.id} className="mb-3 last:mb-0">
            {collapsed ? (
              <div className="mx-auto mb-1.5 h-px w-6 bg-line" aria-hidden="true" />
            ) : (
              <p className="px-2 py-1 text-[10.5px] font-medium tracking-wider text-subtle uppercase">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <RailLink item={item} pathname={pathname} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {isPlatformAdmin ? (
          <div className="mt-3 border-t border-line pt-3">
            <RailLink
              item={{
                href: '/admin',
                label: 'Platform admin',
                icon: Shield,
                hint: 'Users, plans, models, providers and incidents',
              }}
              pathname={pathname}
              collapsed={collapsed}
            />
          </div>
        ) : null}
      </nav>

      <div className={cn('shrink-0 space-y-2 border-t border-line p-2', collapsed && 'px-1.5')}>
        <QuotaBlock
          quota={quota}
          planName={planName}
          subscribed={subscribed}
          collapsed={collapsed}
        />
        <UserMenu collapsed={collapsed} />
        {onToggleCollapsed && collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="mx-auto flex"
                onClick={onToggleCollapsed}
                aria-label="Expand sidebar"
              >
                <PanelLeft className="size-4 rotate-180" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar · {modKey}+B</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </>
  );
}

function RailLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = isNavActive(pathname, item);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]',
        'transition-colors duration-150 ease-[var(--k-ease)]',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-surface-2 font-medium text-fg'
          : 'text-muted hover:bg-surface-2/60 hover:text-fg',
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 -left-2 w-0.5 rounded-r-full bg-primary"
        />
      ) : null}
      <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-subtle')} />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        <span className="font-medium">{item.label}</span>
        <span className="mt-0.5 block text-subtle">{item.hint}</span>
      </TooltipContent>
    </Tooltip>
  );
}
