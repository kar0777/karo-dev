'use client';

import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { focusRing } from './styles';

export type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root>;

export function Slider({ className, value, defaultValue, ...props }: SliderProps) {
  // One thumb per value — the range API is an array even for a single handle.
  const thumbCount = React.useMemo(() => {
    if (Array.isArray(value)) return Math.max(value.length, 1);
    if (Array.isArray(defaultValue)) return Math.max(defaultValue.length, 1);
    return 1;
  }, [value, defaultValue]);

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      defaultValue={defaultValue}
      className={cn(
        'relative flex touch-none items-center select-none',
        'data-[orientation=horizontal]:h-4 data-[orientation=horizontal]:w-full',
        'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-4 data-[orientation=vertical]:flex-col',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-55',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative grow overflow-hidden rounded-full bg-surface-3',
          'data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full',
          'data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1',
        )}
      >
        <SliderPrimitive.Range
          className={cn(
            'absolute rounded-full bg-primary',
            'data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full',
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className={cn(
            'block size-3.5 shrink-0 rounded-full border-2 border-primary bg-surface shadow-sm',
            'transition-[box-shadow,transform] duration-150 ease-[var(--k-ease)]',
            'hover:scale-110 active:scale-105',
            focusRing,
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}
