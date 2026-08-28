'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRingField } from './styles';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps extends React.ComponentProps<
  typeof SelectPrimitive.Trigger
> {
  size?: 'sm' | 'md' | 'lg';
}

export function SelectTrigger({
  className,
  size = 'md',
  children,
  ...props
}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md border border-line bg-surface text-fg',
        'transition-[color,background-color,border-color,box-shadow] duration-150 ease-[var(--k-ease)]',
        'hover:border-line-strong data-[placeholder]:text-subtle',
        'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:hover:border-line',
        'aria-invalid:border-danger',
        '[&>span]:line-clamp-1 [&>span]:text-left',
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        size === 'sm' && 'h-7 px-2 text-[12px]',
        size === 'md' && 'h-8 px-2.5 text-[13px]',
        size === 'lg' && 'h-9 px-3 text-sm',
        focusRingField,
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-3.5 text-subtle" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn(
        'flex cursor-default items-center justify-center py-1 text-subtle',
        className,
      )}
      {...props}
    >
      <ChevronUp className="size-3.5" aria-hidden="true" />
    </SelectPrimitive.ScrollUpButton>
  );
}

export function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn(
        'flex cursor-default items-center justify-center py-1 text-subtle',
        className,
      )}
      {...props}
    >
      <ChevronDown className="size-3.5" aria-hidden="true" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 5,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={sideOffset}
        className={cn(
          'relative z-50 max-h-72 min-w-32 overflow-hidden rounded-md border border-line bg-surface text-fg shadow-pop',
          'data-[state=open]:animate-scale-in',
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn(
        'px-2 py-1.5 text-[11px] font-medium tracking-wide text-subtle uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-7 text-[13px] outline-none select-none',
        'transition-colors duration-150 ease-[var(--k-ease)]',
        'data-[highlighted]:bg-surface-2 data-[highlighted]:text-fg',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-primary" aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('-mx-1 my-1 h-px bg-line', className)}
      {...props}
    />
  );
}
