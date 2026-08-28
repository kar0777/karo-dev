import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { Spinner } from './spinner';
import { focusRing } from './styles';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none',
    'transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-[var(--k-ease)]',
    'disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover active:translate-y-px',
        secondary:
          'border border-line bg-surface-2 text-fg hover:border-line-strong hover:bg-surface-3 active:translate-y-px',
        ghost: 'bg-transparent text-muted hover:bg-surface-2 hover:text-fg',
        outline:
          'border border-line-strong bg-transparent text-fg hover:bg-surface-2 active:translate-y-px',
        danger: 'bg-danger text-danger-fg shadow-sm hover:bg-danger/88 active:translate-y-px',
        subtle: 'bg-surface-3 text-fg hover:bg-line active:translate-y-px',
        link: 'bg-transparent text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: "h-6 gap-1 rounded-sm px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-7 px-2.5 text-[13px]',
        md: 'h-8 px-3 text-[13px]',
        lg: 'h-10 px-4 text-sm',
        'icon-sm': "size-7 gap-0 p-0 [&_svg:not([class*='size-'])]:size-3.5",
        icon: 'size-8 gap-0 p-0',
      },
    },
    compoundVariants: [
      // A link is text, not a box — it must not carry the control's box metrics.
      { variant: 'link', class: 'h-auto rounded-sm px-0 py-0' },
    ],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a `<button>` (e.g. a `next/link`). */
  asChild?: boolean;
  /** Swaps the leading icon for a spinner and blocks interaction. */
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

function spinnerSizeFor(size: ButtonProps['size']): 'xs' | 'sm' | 'md' {
  if (size === 'xs' || size === 'icon-sm') return 'xs';
  if (size === 'lg') return 'md';
  return 'sm';
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  iconLeft,
  iconRight,
  children,
  disabled,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  const iconOnly = size === 'icon' || size === 'icon-sm';
  const blocked = Boolean(disabled) || loading;

  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      disabled={asChild ? undefined : blocked}
      aria-disabled={asChild && blocked ? true : undefined}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {asChild ? (
        children
      ) : loading ? (
        <>
          <Spinner size={spinnerSizeFor(size)} label={null} />
          {iconOnly ? null : children}
        </>
      ) : (
        <>
          {iconLeft}
          {children}
          {iconRight}
        </>
      )}
    </Comp>
  );
}
