'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRing } from './styles';

export type TabsVariant = 'line' | 'pill';

/** Set once on `TabsList` so every trigger below it matches automatically. */
const TabsVariantContext = React.createContext<TabsVariant>('line');

export const Tabs = TabsPrimitive.Root;

export interface TabsListProps extends React.ComponentProps<typeof TabsPrimitive.List> {
  variant?: TabsVariant;
}

export function TabsList({ className, variant = 'line', ...props }: TabsListProps) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={variant}
        className={cn(
          'flex items-center',
          variant === 'line' && 'h-9 w-full gap-4 border-b border-line',
          variant === 'pill' && 'h-8 w-fit gap-0.5 rounded-md bg-surface-2 p-0.5',
          className,
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-muted',
        'transition-[color,background-color,border-color,box-shadow] duration-150 ease-[var(--k-ease)]',
        'hover:text-fg disabled:pointer-events-none disabled:opacity-50',
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        variant === 'line' &&
          '-mb-px h-9 border-b-2 border-transparent px-0.5 data-[state=active]:border-primary data-[state=active]:text-fg',
        variant === 'pill' &&
          'h-7 rounded-sm px-2.5 data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('mt-3 rounded-md', focusRing, className)}
      {...props}
    />
  );
}
