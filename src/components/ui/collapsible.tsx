'use client';

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;

/** See `accordion.tsx` — the keyframes depend on a Radix runtime variable. */
function CollapsibleMotion() {
  return (
    <style href="karo-collapsible-motion" precedence="default">
      {`@keyframes karo-collapsible-down{from{height:0;opacity:0}to{height:var(--radix-collapsible-content-height);opacity:1}}
@keyframes karo-collapsible-up{from{height:var(--radix-collapsible-content-height);opacity:1}to{height:0;opacity:0}}`}
    </style>
  );
}

export function CollapsibleContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      className={cn(
        'overflow-hidden',
        'data-[state=open]:animate-[karo-collapsible-down_0.18s_var(--k-ease)]',
        'data-[state=closed]:animate-[karo-collapsible-up_0.16s_var(--k-ease)]',
      )}
      {...props}
    >
      <CollapsibleMotion />
      <div className={className}>{children}</div>
    </CollapsiblePrimitive.CollapsibleContent>
  );
}
