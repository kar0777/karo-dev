import * as ProgressPrimitive from '@radix-ui/react-progress';
import type * as React from 'react';

import { clamp, cn } from '@/lib/utils';

export type ProgressTone = 'primary' | 'ember' | 'danger' | 'success';

const TONES: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  ember: 'bg-ember',
  danger: 'bg-danger',
  success: 'bg-success',
};

export interface ProgressProps extends Omit<
  React.ComponentProps<typeof ProgressPrimitive.Root>,
  'value'
> {
  /** `null` renders the indeterminate state — use it while a total is unknown. */
  value?: number | null;
  max?: number;
  tone?: ProgressTone;
}

export function Progress({
  className,
  value = 0,
  max = 100,
  tone = 'primary',
  ...props
}: ProgressProps) {
  const indeterminate = value === null || value === undefined;
  const safeMax = max > 0 ? max : 100;
  const percent = indeterminate ? 0 : clamp((value / safeMax) * 100, 0, 100);

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={indeterminate ? null : value}
      max={safeMax}
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3',
        className,
      )}
      {...props}
    >
      {indeterminate ? (
        // Scoped to this component, so it lives here instead of globals.css.
        // React hoists and de-duplicates the tag by `href`.
        <style href="karo-progress-motion" precedence="default">
          {`@keyframes karo-progress-slide{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}`}
        </style>
      ) : null}
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full rounded-full',
          TONES[tone],
          indeterminate
            ? 'w-1/3 animate-[karo-progress-slide_1.15s_var(--k-ease)_infinite]'
            : 'w-full transition-transform duration-300 ease-[var(--k-ease)]',
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - percent}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
