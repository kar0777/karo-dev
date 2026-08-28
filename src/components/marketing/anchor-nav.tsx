'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  Anchor navigation with scroll spy
 *
 *  Used as a sticky sub-bar on /features and as a sidebar on /docs.
 *  Plain anchor links, so it works before hydration and with JavaScript
 *  disabled; the observer only adds the highlight.
 * ------------------------------------------------------------------ */

export type AnchorItem = { id: string; label: string };
export type AnchorGroup = { title: string; items: readonly AnchorItem[] };

function useActiveSection(ids: readonly string[]): string {
  const [active, setActive] = React.useState(() => ids[0] ?? '');
  const key = ids.join('|');

  React.useEffect(() => {
    const elements = key
      .split('|')
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first) setActive(first.target.id);
      },
      // Top offset clears the sticky header; the large bottom margin means a
      // section counts as "current" only once it reaches the upper third.
      { rootMargin: '-88px 0px -62% 0px', threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [key]);

  return active;
}

export function SectionNav({
  items,
  className,
  label = 'On this page',
}: {
  items: readonly AnchorItem[];
  className?: string;
  label?: string;
}) {
  const ids = React.useMemo(() => items.map((item) => item.id), [items]);
  const active = useActiveSection(ids);

  return (
    <nav
      aria-label={label}
      className={cn(
        'sticky top-14 z-30 border-b border-line bg-bg/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <ul className="karo-no-scrollbar flex items-center gap-1 overflow-x-auto py-2">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active === item.id ? 'true' : undefined}
                className={cn(
                  'inline-block rounded-md px-2.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap transition-colors duration-150 ease-[var(--k-ease)]',
                  active === item.id
                    ? 'bg-surface-2 text-fg'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

export function SidebarNav({
  groups,
  className,
  label = 'Documentation',
}: {
  groups: readonly AnchorGroup[];
  className?: string;
  label?: string;
}) {
  const ids = React.useMemo(
    () => groups.flatMap((group) => group.items.map((item) => item.id)),
    [groups],
  );
  const active = useActiveSection(ids);

  return (
    <nav aria-label={label} className={cn('flex flex-col gap-5', className)}>
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="px-2 text-[10.5px] font-semibold tracking-[0.14em] text-subtle uppercase">
            {group.title}
          </p>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={active === item.id ? 'true' : undefined}
                  className={cn(
                    'block rounded-md border-l-2 px-2 py-1.5 text-[12.5px] transition-colors duration-150 ease-[var(--k-ease)]',
                    active === item.id
                      ? 'border-primary bg-surface-2 font-medium text-fg'
                      : 'border-transparent text-muted hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
