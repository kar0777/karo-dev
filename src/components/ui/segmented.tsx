'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

import { type IconLike, renderIcon } from './icon-slot';
import { focusRing } from './styles';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: IconLike;
  disabled?: boolean;
  /** Native tooltip — useful when the label is icon-only. */
  title?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** Stretches the track and divides it evenly between the options. */
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/**
 * Mutually exclusive view switch. Radio semantics with roving focus: arrows
 * move and select, Home/End jump to the ends.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onValueChange,
  size = 'md',
  fullWidth = false,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SegmentedControlProps<T>) {
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const selectAt = React.useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onValueChange(option.value);
      itemRefs.current[index]?.focus();
    },
    [onValueChange, options],
  );

  const step = React.useCallback(
    (from: number, direction: 1 | -1) => {
      const total = options.length;
      for (let offset = 1; offset <= total; offset += 1) {
        const next = (((from + direction * offset) % total) + total) % total;
        if (!options[next]?.disabled) {
          selectAt(next);
          return;
        }
      }
    },
    [options, selectAt],
  );

  const edge = React.useCallback(
    (direction: 1 | -1) => {
      const indexes = options.map((_, index) => index);
      const ordered = direction === 1 ? indexes : indexes.reverse();
      const target = ordered.find((index) => !options[index]?.disabled);
      if (target !== undefined) selectAt(target);
    },
    [options, selectAt],
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        step(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        step(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        edge(1);
        break;
      case 'End':
        event.preventDefault();
        edge(-1);
        break;
      default:
        break;
    }
  }

  const activeIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      data-slot="segmented-control"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5',
        fullWidth && 'flex w-full',
        disabled && 'pointer-events-none opacity-55',
        className,
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.title}
            disabled={disabled || option.disabled}
            // Roving tabindex — one stop for the whole group.
            tabIndex={selected || (activeIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => selectAt(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap',
              'transition-[color,background-color,box-shadow] duration-150 ease-[var(--k-ease)]',
              'disabled:pointer-events-none disabled:opacity-50',
              "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
              size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[13px]',
              fullWidth && 'flex-1',
              selected
                ? 'bg-surface text-fg shadow-sm'
                : 'bg-transparent text-muted hover:text-fg',
              focusRing,
            )}
          >
            {option.icon ? renderIcon(option.icon, 'size-3.5') : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
