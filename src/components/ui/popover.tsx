'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-72 rounded-md border border-line bg-surface p-3 text-[13px] text-fg shadow-pop',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          'max-h-[var(--radix-popover-content-available-height)] overflow-y-auto',
          'data-[state=open]:animate-scale-in',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
