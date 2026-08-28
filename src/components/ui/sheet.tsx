'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRing } from './styles';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export type SheetSide = 'right' | 'left' | 'top' | 'bottom';

/**
 * Slide-in keyframes live here rather than in globals.css because they exist
 * only for this component. React hoists and de-duplicates the tag by `href`.
 */
function SheetMotion() {
  return (
    <style href="karo-sheet-motion" precedence="default">
      {`@keyframes karo-sheet-in-right{from{opacity:0;transform:translate3d(16px,0,0)}to{opacity:1;transform:none}}
@keyframes karo-sheet-in-left{from{opacity:0;transform:translate3d(-16px,0,0)}to{opacity:1;transform:none}}
@keyframes karo-sheet-in-top{from{opacity:0;transform:translate3d(0,-16px,0)}to{opacity:1;transform:none}}
@keyframes karo-sheet-in-bottom{from{opacity:0;transform:translate3d(0,16px,0)}to{opacity:1;transform:none}}`}
    </style>
  );
}

const SIDE_CLASSES: Record<SheetSide, string> = {
  right:
    'inset-y-0 right-0 h-full w-[min(24rem,calc(100vw-2rem))] border-l data-[state=open]:animate-[karo-sheet-in-right_0.18s_var(--k-ease-out)_both]',
  left: 'inset-y-0 left-0 h-full w-[min(24rem,calc(100vw-2rem))] border-r data-[state=open]:animate-[karo-sheet-in-left_0.18s_var(--k-ease-out)_both]',
  top: 'inset-x-0 top-0 max-h-[85vh] w-full border-b data-[state=open]:animate-[karo-sheet-in-top_0.18s_var(--k-ease-out)_both]',
  bottom:
    'inset-x-0 bottom-0 max-h-[85vh] w-full border-t data-[state=open]:animate-[karo-sheet-in-bottom_0.18s_var(--k-ease-out)_both]',
};

export interface SheetContentProps extends React.ComponentProps<
  typeof DialogPrimitive.Content
> {
  side?: SheetSide;
  showCloseButton?: boolean;
}

export function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetMotion />
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col gap-3 border-line bg-surface p-4 shadow-pop',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          SIDE_CLASSES[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-2.5 right-2.5 inline-flex size-7 items-center justify-center rounded-md text-subtle',
              'transition-colors duration-150 ease-[var(--k-ease)] hover:bg-surface-2 hover:text-fg',
              focusRing,
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        '-mx-4 -mt-4 mb-1 flex flex-col gap-1 border-b border-line px-4 py-3 pr-11',
        className,
      )}
      {...props}
    />
  );
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-sm leading-tight font-semibold text-fg', className)}
      {...props}
    />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-[13px] leading-snug text-muted', className)}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        '-mx-4 -mb-4 mt-auto flex flex-col-reverse gap-2 border-t border-line bg-surface-2/40 px-4 py-3',
        'sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
