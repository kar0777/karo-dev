import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface KbdProps extends React.ComponentProps<'kbd'> {
  size?: 'sm' | 'md';
}

/** A single key cap. Compose several for a chord: `<Kbd>⌘</Kbd><Kbd>K</Kbd>`. */
export function Kbd({ className, size = 'sm', ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex items-center justify-center rounded-sm border border-line bg-surface-2 font-mono text-muted shadow-sm select-none',
        size === 'sm' && 'h-[18px] min-w-[18px] px-1 text-[10px]',
        size === 'md' && 'h-5 min-w-5 px-1.5 text-[11px]',
        className,
      )}
      {...props}
    />
  );
}
