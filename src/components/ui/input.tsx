import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRingField, focusWithinRingField } from './styles';

export const inputVariants = cva(
  [
    'w-full min-w-0 rounded-md border border-line bg-surface text-fg placeholder:text-subtle',
    'transition-[color,background-color,border-color,box-shadow] duration-150 ease-[var(--k-ease)]',
    'hover:border-line-strong',
    'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:hover:border-line',
    'aria-invalid:border-danger aria-invalid:focus-visible:border-danger aria-invalid:focus-visible:ring-danger/30',
    'file:mr-2 file:border-0 file:bg-transparent file:text-[12px] file:font-medium file:text-fg',
    focusRingField,
  ].join(' '),
  {
    variants: {
      inputSize: {
        sm: 'h-7 px-2 text-[12px]',
        md: 'h-8 px-2.5 text-[13px]',
        lg: 'h-9 px-3 text-sm',
      },
      mono: {
        true: 'font-mono text-[12.5px] tracking-tight',
        false: '',
      },
    },
    defaultVariants: { inputSize: 'md', mono: false },
  },
);

export interface InputProps
  extends Omit<React.ComponentProps<'input'>, 'size'>, VariantProps<typeof inputVariants> {}

export function Input({ className, inputSize, mono, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ inputSize, mono }), className)}
      {...props}
    />
  );
}

/**
 * Joins an input with leading/trailing addons into a single control: inner
 * radii and duplicated borders are collapsed, and focus lights up the group.
 */
export function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        'flex w-full items-stretch rounded-md',
        '[&>*]:relative [&>*:focus-within]:z-10',
        '[&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none',
        '[&>*:not(:last-child)]:rounded-r-none',
        className,
      )}
      {...props}
    />
  );
}

export interface InputAddonProps extends React.ComponentProps<'div'> {
  /** `false` renders a flush label (e.g. a unit suffix) without its own fill. */
  filled?: boolean;
}

export function InputAddon({ className, filled = true, ...props }: InputAddonProps) {
  return (
    <div
      data-slot="input-addon"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12px] whitespace-nowrap text-muted',
        filled ? 'bg-surface-2' : 'bg-surface',
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        focusWithinRingField,
        className,
      )}
      {...props}
    />
  );
}
