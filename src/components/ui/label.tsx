import * as LabelPrimitive from '@radix-ui/react-label';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export type LabelProps = React.ComponentProps<typeof LabelPrimitive.Root>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'inline-flex items-center gap-1.5 text-[13px] leading-none font-medium text-fg select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-60',
        'group-data-[disabled=true]:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
