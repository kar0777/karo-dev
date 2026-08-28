import type * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRingField } from './styles';

export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** Monospace body — for prompts, YAML, env blocks and system instructions. */
  mono?: boolean;
}

export function Textarea({ className, mono = false, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      data-slot="textarea"
      className={cn(
        'w-full min-h-16 resize-y rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-fg placeholder:text-subtle',
        'transition-[color,background-color,border-color,box-shadow] duration-150 ease-[var(--k-ease)]',
        'hover:border-line-strong',
        'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:hover:border-line',
        'aria-invalid:border-danger aria-invalid:focus-visible:border-danger aria-invalid:focus-visible:ring-danger/30',
        mono && 'font-mono text-[12.5px] leading-relaxed tracking-tight',
        focusRingField,
        className,
      )}
      {...props}
    />
  );
}
