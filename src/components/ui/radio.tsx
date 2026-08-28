'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRing } from './styles';

export function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-2', className)}
      {...props}
    />
  );
}

export function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'peer inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface',
        'transition-[color,background-color,border-color,box-shadow] duration-150 ease-[var(--k-ease)]',
        'hover:border-primary',
        'data-[state=checked]:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-line-strong',
        'aria-invalid:border-danger',
        focusRing,
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <span className="block size-2 rounded-full bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}
