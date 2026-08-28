'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const surfaceClasses = [
  'z-50 min-w-[10rem] overflow-hidden rounded-md border border-line bg-surface p-1 text-fg shadow-pop',
  'data-[state=open]:animate-scale-in',
].join(' ');

const itemClasses = [
  'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-none select-none',
  'transition-colors duration-150 ease-[var(--k-ease)]',
  'data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-subtle",
  'data-[highlighted]:[&_svg]:text-fg',
].join(' ');

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          surfaceClasses,
          'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps extends React.ComponentProps<
  typeof DropdownMenuPrimitive.Item
> {
  /** Aligns with the checkbox/radio gutter. */
  inset?: boolean;
  variant?: 'default' | 'danger';
}

export function DropdownMenuItem({
  className,
  inset = false,
  variant = 'default',
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        itemClasses,
        inset && 'pl-7',
        variant === 'danger' &&
          'text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger [&_svg]:text-danger data-[highlighted]:[&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      checked={checked}
      className={cn(itemClasses, 'pl-7', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClasses, 'pl-7', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="size-2 fill-primary text-primary" aria-hidden="true" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export interface DropdownMenuLabelProps extends React.ComponentProps<
  typeof DropdownMenuPrimitive.Label
> {
  inset?: boolean;
}

export function DropdownMenuLabel({
  className,
  inset = false,
  ...props
}: DropdownMenuLabelProps) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(
        'px-2 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase',
        inset && 'pl-7',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-line', className)}
      {...props}
    />
  );
}

export interface DropdownMenuSubTriggerProps extends React.ComponentProps<
  typeof DropdownMenuPrimitive.SubTrigger
> {
  inset?: boolean;
}

export function DropdownMenuSubTrigger({
  className,
  inset = false,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(itemClasses, 'data-[state=open]:bg-surface-2', inset && 'pl-7', className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-3.5 text-subtle" aria-hidden="true" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(surfaceClasses, className)}
      {...props}
    />
  );
}

/** Right-aligned shortcut hint. Pair with `Kbd` when the keys must be literal. */
export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto pl-4 font-mono text-[11px] tracking-wide text-subtle', className)}
      {...props}
    />
  );
}
