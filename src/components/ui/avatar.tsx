'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export const avatarVariants = cva(
  'relative flex shrink-0 overflow-hidden rounded-md border border-line bg-surface-2 select-none',
  {
    variants: {
      size: {
        xs: 'size-5 text-[9px]',
        sm: 'size-6 text-[10px]',
        md: 'size-8 text-[11px]',
        lg: 'size-10 text-[13px]',
        xl: 'size-14 text-base',
      },
      shape: {
        square: 'rounded-md',
        circle: 'rounded-full',
      },
    },
    defaultVariants: { size: 'md', shape: 'square' },
  },
);

export interface AvatarProps
  extends
    React.ComponentProps<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {}

export function Avatar({ className, size, shape, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(avatarVariants({ size, shape }), className)}
      {...props}
    />
  );
}

export function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full object-cover', className)}
      {...props}
    />
  );
}

export function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center bg-surface-3 font-medium tracking-wide text-muted uppercase',
        className,
      )}
      {...props}
    />
  );
}
