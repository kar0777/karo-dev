import { RefreshCw, TriangleAlert } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { Button } from './button';
import { type IconLike, renderIcon } from './icon-slot';

export interface ErrorStateProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  icon?: IconLike;
  title?: React.ReactNode;
  /** Say what happened *and* what to do next. */
  description?: React.ReactNode;
  /** Machine-readable code shown in a mono chip — makes support tickets useful. */
  code?: string;
  /** A handler renders the standard Retry button; a node replaces it entirely. */
  retry?: (() => void) | React.ReactNode;
  retryLabel?: string;
  secondaryAction?: React.ReactNode;
  size?: 'sm' | 'md';
}

export function ErrorState({
  icon = TriangleAlert,
  title = 'Something went wrong',
  description = 'The request failed before it finished. Retry — if it keeps failing, the details below help support trace it.',
  code,
  retry,
  retryLabel = 'Retry',
  secondaryAction,
  size = 'md',
  className,
  children,
  ...props
}: ErrorStateProps) {
  const retryNode =
    typeof retry === 'function' ? (
      <Button variant="secondary" size="sm" iconLeft={<RefreshCw />} onClick={retry}>
        {retryLabel}
      </Button>
    ) : (
      retry
    );

  return (
    <div
      role="alert"
      data-slot="error-state"
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
        <div className="flex size-10 items-center justify-center rounded-lg border border-danger/30 bg-danger-soft text-danger">
          {renderIcon(icon, 'size-5')}
        </div>
        <h3 className="mt-3 text-[13px] font-medium text-fg">{title}</h3>
        {description ? (
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>
        ) : null}
        {code ? (
          <code className="mt-2.5 inline-flex items-center rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
            {code}
          </code>
        ) : null}
        {retryNode || secondaryAction ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {retryNode}
            {secondaryAction}
          </div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </div>
  );
}
