'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRing } from './styles';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-fade-in',
        className,
      )}
      {...props}
    />
  );
}

export interface DialogContentProps extends React.ComponentProps<
  typeof DialogPrimitive.Content
> {
  /** Hides the built-in close button when the dialog must be resolved by an action. */
  showCloseButton?: boolean;
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-3',
          'overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-pop',
          // Radix focuses the panel on open; keep an indicator for keyboard users.
          'outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          'data-[state=open]:animate-scale-in',
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
    </DialogPortal>
  );
}

/** Full-bleed header bar — the negative margins cancel the content padding. */
export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        '-mx-4 -mt-4 mb-1 flex flex-col gap-1 border-b border-line px-4 py-3 pr-11',
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-sm leading-tight font-semibold text-fg', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-[13px] leading-snug text-muted', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 mt-1 flex flex-col-reverse gap-2 border-t border-line bg-surface-2/40 px-4 py-3',
        'sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
