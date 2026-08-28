import { Inbox } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { type IconLike, renderIcon } from './icon-slot';

export interface EmptyStateProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  icon?: IconLike;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary call to action — pass a `<Button>`. */
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  /** `sm` fits inside a panel or a table body; `md` is for a full page region. */
  size?: 'sm' | 'md';
}

export function EmptyState({
  icon = Inbox,
  title,
  description,
  action,
  secondaryAction,
  size = 'md',
  className,
  children,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden rounded-lg text-center',
        size === 'sm' ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="karo-dotgrid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_55%_60%_at_50%_50%,#000,transparent)]"
      />
      <div className="relative flex flex-col items-center">
        <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface-2 text-subtle">
          {renderIcon(icon, 'size-5')}
        </div>
        <h3 className="mt-3 text-[13px] font-medium text-fg">{title}</h3>
        {description ? (
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>
        ) : null}
        {action || secondaryAction ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {action}
            {secondaryAction}
          </div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </div>
  );
}
