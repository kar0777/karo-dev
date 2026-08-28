'use client';

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface ScrollAreaProps extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string;
  viewportRef?: React.Ref<HTMLDivElement>;
  orientation?: 'vertical' | 'horizontal' | 'both';
}

export function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportRef,
  orientation = 'vertical',
  ...props
}: ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn('size-full rounded-[inherit]', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== 'horizontal' ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== 'vertical' ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors duration-150 ease-[var(--k-ease)] select-none',
        orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-line-strong transition-colors duration-150 ease-[var(--k-ease)] hover:bg-subtle" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
