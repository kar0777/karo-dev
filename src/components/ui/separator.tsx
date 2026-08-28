import * as SeparatorPrimitive from '@radix-ui/react-separator';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export type SeparatorProps = React.ComponentProps<typeof SeparatorPrimitive.Root>;

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      orientation={orientation}
      decorative={decorative}
      className={cn(
        'shrink-0 bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px self-stretch',
        className,
      )}
      {...props}
    />
  );
}
