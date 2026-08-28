'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import {
  ArrowRight,
  CornerDownLeft,
  FolderGit2,
  Moon,
  Plug,
  Plus,
  Search,
  SearchX,
  Sun,
  UserRoundPlus,
  Wallet,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import { ALL_NAV_ITEMS, type NavIcon } from '@/components/app/nav';
import { useTranslator } from '@/components/i18n-provider';
import type { ShellProjectRef } from '@/components/app/shell-data';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { cn, fuzzyScore } from '@/lib/utils';

/**
 * The command palette.
 *
 * Everything reachable from the shell is reachable from here: routes, the
 * team's projects, and the handful of actions that are otherwise two clicks
 * deep. Ranking is `fuzzyScore` over the label with a smaller weight on the
 * hint, so typing "bil" finds Billing rather than a project whose description
 * happens to mention billing.
 */

export type PaletteCategory = 'Navigation' | 'Projects' | 'Actions';

type PaletteCommand = {
  id: string;
  category: PaletteCategory;
  label: string;
  hint: string;
  icon: NavIcon;
  /** Shortcut hint rendered on the right, split into individual key caps. */
  keys?: string[];
  run: () => void;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: readonly ShellProjectRef[];
  /** Opens the project-creation dialog owned by the shell. */
  onCreateProject: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  projects,
  onCreateProject,
}: CommandPaletteProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputId = React.useId();
  const listboxId = React.useId();

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const t = useTranslator();

  const commands = React.useMemo<PaletteCommand[]>(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };

    const navigation: PaletteCommand[] = ALL_NAV_ITEMS.map((item) => ({
      id: `nav:${item.href}`,
      category: 'Navigation',
      // Same label the sidebar shows — searching for what you can see is the
      // whole point of a palette, so these two must not diverge by locale.
      label: item.labelKey ? t(item.labelKey) : item.label,
      hint: item.hint,
      icon: item.icon,
      run: go(item.href),
    }));

    const projectCommands: PaletteCommand[] = projects.map((project) => ({
      id: `project:${project.id}`,
      category: 'Projects',
      label: project.name,
      hint: project.archived ? 'Archived project' : `Open the workspace · ${project.slug}`,
      icon: FolderGit2,
      run: go(`/app/projects/${project.id}`),
    }));

    const actions: PaletteCommand[] = [
      {
        id: 'action:new-project',
        category: 'Actions',
        label: 'New project',
        hint: 'Name it, pick a starter template and choose where it runs',
        icon: Plus,
        keys: ['N'],
        run: () => {
          close();
          onCreateProject();
        },
      },
      {
        id: 'action:invite',
        category: 'Actions',
        label: 'Invite a teammate',
        hint: 'Send an invitation and choose their role',
        icon: UserRoundPlus,
        run: go('/app/team'),
      },
      {
        id: 'action:mcp',
        category: 'Actions',
        label: 'Connect an MCP server',
        hint: 'Give the agent tools from an external Model Context Protocol server',
        icon: Plug,
        run: go('/app/mcp'),
      },
      {
        id: 'action:topup',
        category: 'Actions',
        label: 'Top up balance',
        hint: 'Add pay-as-you-go credit so runs are never blocked mid-task',
        icon: Wallet,
        run: go('/app/billing'),
      },
      {
        id: 'action:theme',
        category: 'Actions',
        label: resolvedTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
        hint: 'Appearance applies immediately and is remembered on this device',
        icon: resolvedTheme === 'light' ? Moon : Sun,
        run: () => {
          setTheme(resolvedTheme === 'light' ? 'dark' : 'light');
          close();
        },
      },
    ];

    return [...navigation, ...projectCommands, ...actions];
  }, [close, onCreateProject, projects, resolvedTheme, router, setTheme, t]);

  const results = React.useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return commands;

    return commands
      .map((command) => {
        const labelScore = fuzzyScore(trimmed, command.label);
        const hintScore = fuzzyScore(trimmed, command.hint);
        // A hint match is a hint, not a name — it must never outrank a real one.
        const score = labelScore >= 0 ? labelScore : hintScore >= 0 ? hintScore * 0.25 : -1;
        return { command, score };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.command);
  }, [commands, query]);

  const groups = React.useMemo(() => {
    const order: PaletteCategory[] = ['Actions', 'Projects', 'Navigation'];
    // Without a query the natural reading order (routes first) is better.
    const categories = query.trim() ? order : (['Navigation', 'Projects', 'Actions'] as const);
    return categories
      .map((category) => ({
        category,
        items: results.filter((command) => command.category === category),
      }))
      .filter((group) => group.items.length > 0);
  }, [query, results]);

  const flat = React.useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // Every re-ranking of the list invalidates the highlight, so the query and the
  // highlight are always written together rather than one chasing the other
  // through an effect.
  function changeQuery(next: string) {
    setQuery(next);
    setActiveIndex(0);
  }

  // Closing wipes the query so the palette reopens clean. `open` is a prop, and
  // the palette is closed from several places (Esc, a command running, the
  // shell's ⌘K toggle), so the reset keys off the prop changing rather than off
  // any one handler. Adjusting during render keeps the last query from being
  // painted into the closing dialog, which an effect would allow.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }

  // Keep the highlighted row inside the scroll port as the arrows move it.
  React.useEffect(() => {
    const active = flat[activeIndex];
    if (!active || !listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(`[data-command-id="${active.id}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, flat]);

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (flat.length === 0 ? 0 : (index + 1) % flat.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) =>
        flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length,
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, flat.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      flat[activeIndex]?.run();
    }
  }

  const activeId = flat[activeIndex]?.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] max-w-xl translate-y-0 gap-0 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(inputId)?.focus();
        }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search projects, pages and quick actions. Use the arrow keys to move and Enter to run.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 shrink-0 text-subtle" aria-hidden="true" />
          <input
            id={inputId}
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            aria-expanded
            aria-controls={listboxId}
            aria-activedescendant={activeId ? `${listboxId}-${activeId}` : undefined}
            aria-label="Search projects, commands"
            placeholder="Search projects, commands…"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-11 w-full bg-transparent text-[13px] text-fg outline-none placeholder:text-subtle"
          />
          <Kbd className="hidden sm:inline-flex">Esc</Kbd>
        </div>

        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Results"
          className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5"
        >
          {flat.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
              <SearchX className="size-5 text-subtle" aria-hidden="true" />
              <p className="text-[13px] font-medium text-fg">No matches for “{query.trim()}”</p>
              <p className="max-w-xs text-[12px] text-muted">
                Try a page name such as “billing”, or part of a project name. Archived projects
                are searchable too.
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.category} className="mb-1 last:mb-0">
                <p className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
                  {group.category}
                </p>
                {group.items.map((command) => {
                  const index = flat.indexOf(command);
                  const active = index === activeIndex;
                  const Icon = command.icon;
                  return (
                    <div
                      key={command.id}
                      id={`${listboxId}-${command.id}`}
                      data-command-id={command.id}
                      role="option"
                      aria-selected={active}
                      tabIndex={-1}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => command.run()}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5',
                        'transition-colors duration-100 ease-[var(--k-ease)]',
                        active ? 'bg-surface-2 text-fg' : 'text-muted',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          active ? 'text-primary' : 'text-subtle',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-fg">
                          {command.label}
                        </span>
                        <span className="block truncate text-[11.5px] text-subtle">
                          {command.hint}
                        </span>
                      </span>
                      {command.keys ? (
                        <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
                          {command.keys.map((key) => (
                            <Kbd key={key}>{key}</Kbd>
                          ))}
                        </span>
                      ) : null}
                      {active ? (
                        <CornerDownLeft
                          className="size-3.5 shrink-0 text-subtle"
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowRight
                          className="size-3.5 shrink-0 text-transparent"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2/40 px-3 py-2 text-[11px] text-subtle">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            to open
            <span className="mx-1 hidden sm:inline">·</span>
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
            <span className="hidden sm:inline">to close</span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
