import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, Sparkles, TriangleAlert } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { type IconLike, renderIcon } from './icon-slot';

export const alertVariants = cva('relative flex w-full gap-2.5 rounded-md border px-3 py-2.5', {
  variants: {
    variant: {
      info: 'border-info/25 bg-info-soft text-info-soft-fg',
      success: 'border-success/25 bg-success-soft text-success-soft-fg',
      warning: 'border-warning/30 bg-warning-soft text-warning-soft-fg',
      danger: 'border-danger/30 bg-danger-soft text-danger-soft-fg',
      primary: 'border-primary/25 bg-primary-soft text-primary-soft-fg',
    },
  },
  defaultVariants: { variant: 'info' },
});

const DEFAULT_ICON = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  primary: Sparkles,
} as const;

export interface AlertProps
  extends React.ComponentProps<'div'>, VariantProps<typeof alertVariants> {
  /** `null` drops the icon; anything else replaces the variant default. */
  icon?: IconLike | null;
}

export function Alert({ className, variant = 'info', icon, children, ...props }: AlertProps) {
  const resolved = variant ?? 'info';
  const iconNode = icon === null ? null : renderIcon(icon ?? DEFAULT_ICON[resolved], 'size-4');

  return (
    <div
      // Danger and warning interrupt; the rest are just context.
      role={resolved === 'danger' || resolved === 'warning' ? 'alert' : 'note'}
      data-slot="alert"
      className={cn(alertVariants({ variant: resolved }), className)}
      {...props}
    >
      {iconNode ? (
        <span aria-hidden="true" className="mt-px shrink-0">
          {iconNode}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 text-[13px] leading-snug">{children}</div>
    </div>
  );
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="alert-title"
      className={cn('font-medium tracking-tight', className)}
      {...props}
    />
  );
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('opacity-90 [&:not(:first-child)]:mt-1 [&_p]:leading-relaxed', className)}
      {...props}
    />
  );
}
