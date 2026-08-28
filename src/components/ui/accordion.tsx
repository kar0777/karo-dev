'use client';

import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRing } from './styles';

export const Accordion = AccordionPrimitive.Root;

/**
 * Height keyframes need the Radix content-height variable, so they cannot be
 * static Tailwind utilities. React hoists and de-duplicates the tag by `href`.
 */
function AccordionMotion() {
  return (
    <style href="karo-accordion-motion" precedence="default">
      {`@keyframes karo-accordion-down{from{height:0;opacity:0}to{height:var(--radix-accordion-content-height);opacity:1}}
@keyframes karo-accordion-up{from{height:var(--radix-accordion-content-height);opacity:1}to{height:0;opacity:0}}`}
    </style>
  );
}

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-b border-line last:border-b-0', className)}
      {...props}
    />
  );
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'flex flex-1 items-center justify-between gap-3 rounded-sm py-3 text-left text-[13px] font-medium text-fg',
          'transition-colors duration-150 ease-[var(--k-ease)] hover:text-primary',
          'disabled:pointer-events-none disabled:opacity-55',
          '[&[data-state=open]>svg]:rotate-180',
          focusRing,
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown
          className="size-4 shrink-0 text-subtle transition-transform duration-150 ease-[var(--k-ease)]"
          aria-hidden="true"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={cn(
        'overflow-hidden text-[13px] text-muted',
        'data-[state=open]:animate-[karo-accordion-down_0.18s_var(--k-ease)]',
        'data-[state=closed]:animate-[karo-accordion-up_0.16s_var(--k-ease)]',
      )}
      {...props}
    >
      <AccordionMotion />
      <div className={cn('pt-0 pb-3', className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
