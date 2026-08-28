import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface Breadcrumb {
  label: React.ReactNode;
  href?: string;
}

export interface PageHeaderProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned controls — usually one primary button plus a menu. */
  actions?: React.ReactNode;
  breadcrumbs?: readonly Breadcrumb[];
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
  children,
  ...props
}: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={cn('border-b border-line pb-3', className)}
      {...props}
    >
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-1.5">
          <ol className="flex flex-wrap items-center gap-1 text-[12px] text-subtle">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <li key={index} className="flex items-center gap-1">
                  {index > 0 ? (
                    <ChevronRight className="size-3 shrink-0 text-subtle" aria-hidden="true" />
                  ) : null}
                  {crumb.href && !last ? (
                    <Link
                      href={crumb.href}
                      className="rounded-sm transition-colors duration-150 ease-[var(--k-ease)] hover:text-fg"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={last ? 'page' : undefined}
                      className={cn(last && 'text-muted')}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg leading-tight font-semibold text-fg">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
