'use client';

import * as React from 'react';

import { Kbd } from '@/components/ui/kbd';
import { cn, fuzzyScore } from '@/lib/utils';

import {
  SLASH_CATEGORY_ORDER,
  type SlashCommand,
  type SlashCommandCategory,
} from './slash-commands';

/**
 * The `/` command palette that floats above the composer.
 *
 * The composer owns the highlighted index so that arrow keys keep working
 * while the caret stays in the textarea — a palette that steals focus would
 * break "type a bit, arrow down, keep typing".
 */

export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...commands];

  return commands
    .map((command) => {
      const nameScore = fuzzyScore(needle, command.name);
      const descriptionScore = fuzzyScore(needle, command.description) * 0.35;
      return { command, score: Math.max(nameScore, descriptionScore) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.command);
}

function groupCommands(commands: readonly SlashCommand[]) {
  const groups = new Map<SlashCommandCategory, SlashCommand[]>();
  for (const command of commands) {
    const bucket = groups.get(command.category);
    if (bucket) bucket.push(command);
    else groups.set(command.category, [command]);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => SLASH_CATEGORY_ORDER.indexOf(a[0]) - SLASH_CATEGORY_ORDER.indexOf(b[0]),
  );

  // The highlighted index the composer hands us counts across the whole list
  // rather than per group, so every command carries the flat position it will be
  // rendered at. Numbering it here keeps render itself free of a counter that
  // would otherwise be reassigned while the tree is being built.
  let flat = 0;
  return ordered.map(([category, items]) => ({
    category,
    items: items.map((command) => ({ command, index: flat++ })),
  }));
}

export function SlashPalette({
  commands,
  activeIndex,
  onHover,
  onSelect,
  listboxId,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (command: SlashCommand) => void;
  listboxId: string;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const groups = React.useMemo(() => groupCommands(commands), [commands]);

  React.useEffect(() => {
    const node = containerRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (commands.length === 0) {
    return (
      <div className="animate-slide-up-fade absolute bottom-full left-0 z-30 mb-2 w-full rounded-md border border-line bg-surface p-3 shadow-pop">
        <p className="text-[12.5px] text-muted">
          No command matches. Press <Kbd>Esc</Kbd> to keep typing a normal message.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="animate-slide-up-fade absolute bottom-full left-0 z-30 mb-2 max-h-80 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-pop"
    >
      <ul id={listboxId} role="listbox" aria-label="Slash commands">
        {groups.map(({ category, items }) => (
          <li key={category} role="presentation">
            <p className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium tracking-wide text-subtle uppercase">
              {category}
            </p>
            <ul role="presentation">
              {items.map(({ command, index }) => {
                const active = index === activeIndex;
                const Icon = command.icon;
                return (
                  <li key={command.name} role="presentation">
                    <button
                      type="button"
                      role="option"
                      id={`${listboxId}-option-${index}`}
                      aria-selected={active}
                      data-active={active ? 'true' : undefined}
                      onMouseEnter={() => onHover(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onSelect(command)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left',
                        'focus-visible:outline-none',
                        active ? 'bg-surface-2' : 'bg-transparent hover:bg-surface-2/60',
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'size-3.5 shrink-0',
                          active ? 'text-primary' : 'text-subtle',
                        )}
                      />
                      <span className="shrink-0 font-mono text-[12.5px] font-medium text-fg">
                        /{command.name}
                      </span>
                      {command.argHint ? (
                        <span className="shrink-0 font-mono text-[11px] text-subtle">
                          {command.argHint}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-muted">
                        {command.description}
                      </span>
                      {command.shortcut ? (
                        <Kbd className="shrink-0">{command.shortcut}</Kbd>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
