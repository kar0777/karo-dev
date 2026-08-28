'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRing } from './styles';

export type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root>;

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5',
        'transition-colors duration-150 ease-[var(--k-ease)]',
        'data-[state=unchecked]:bg-surface-3 data-[state=unchecked]:hover:bg-line-strong',
        'data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary-hover',
        'disabled:cursor-not-allowed disabled:opacity-55',
        focusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-4 rounded-full shadow-sm ring-0',
          'transition-[transform,background-color] duration-150 ease-[var(--k-ease)]',
          'data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-muted',
          'data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-fg',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
