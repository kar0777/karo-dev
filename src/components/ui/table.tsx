import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface TableProps extends React.ComponentProps<'table'> {
  /** Styles the scroll container rather than the table itself. */
  containerClassName?: string;
}

export function Table({ className, containerClassName, ...props }: TableProps) {
  return (
    <div
      data-slot="table-container"
      className={cn('relative w-full overflow-x-auto', containerClassName)}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom border-collapse text-[13px]', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        '[&_tr]:border-b [&_tr]:border-line [&_tr]:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

export function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t border-line bg-surface-2/50 font-medium', className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-line/60 transition-colors duration-150 ease-[var(--k-ease)]',
        'hover:bg-surface-2 data-[state=selected]:bg-surface-2',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-8 px-3 text-left align-middle text-[11px] font-medium tracking-wide whitespace-nowrap text-subtle uppercase',
        '[&:has([role=checkbox])]:w-8 [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-3 py-2 align-middle', '[&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-2 text-left text-xs text-subtle', className)}
      {...props}
    />
  );
}
