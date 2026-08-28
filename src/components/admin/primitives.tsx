import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { cn, formatMicroUsd, formatPercent } from '@/lib/utils';

/**
 * Small server-renderable pieces shared by every admin table. They exist so
 * that "money" and "margin" look identical on the overview, the usage page and
 * the cost page — an operator should never have to check whether two columns
 * mean the same thing.
 */

export function Money({
  microUsd,
  precise = false,
  className,
}: {
  microUsd: number;
  precise?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('karo-numeric tabular-nums', className)}>
      {formatMicroUsd(microUsd, { precise })}
    </span>
  );
}

/** Signed money where the sign is the point — margins, deficits, deltas. */
export function SignedMoney({
  microUsd,
  invert = false,
  className,
}: {
  microUsd: number;
  /** Set when a negative number is the good outcome (e.g. cost reduction). */
  invert?: boolean;
  className?: string;
}) {
  const positive = microUsd >= 0;
  const good = invert ? !positive : positive;
  return (
    <span
      className={cn(
        'karo-numeric tabular-nums font-medium',
        microUsd === 0 ? 'text-muted' : good ? 'text-success' : 'text-danger',
        className,
      )}
    >
      {microUsd > 0 ? '+' : ''}
      {formatMicroUsd(microUsd)}
    </span>
  );
}

export function MarginPercent({ fraction }: { fraction: number | null }) {
  if (fraction === null) {
    return (
      <span className="karo-numeric text-subtle" title="No revenue in this window">
        —
      </span>
    );
  }
  const tone = fraction >= 0.35 ? 'text-success' : fraction >= 0.1 ? 'text-fg' : 'text-danger';
  return (
    <span className={cn('karo-numeric tabular-nums font-medium', tone)}>
      {formatPercent(fraction, 1)}
    </span>
  );
}

const PLAN_TIER_VARIANT: Record<string, React.ComponentProps<typeof Badge>['variant']> = {
  payg: 'neutral',
  lite: 'info',
  pro: 'primary',
  scale: 'ember',
  ultra: 'warning',
};

export function PlanBadge({ tier, name }: { tier: string; name: string }) {
  return (
    <Badge variant={PLAN_TIER_VARIANT[tier] ?? 'neutral'} size="sm">
      {name}
    </Badge>
  );
}

const SEVERITY_VARIANT: Record<string, React.ComponentProps<typeof Badge>['variant']> = {
  info: 'neutral',
  notice: 'info',
  warning: 'warning',
  critical: 'danger',
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant={SEVERITY_VARIANT[severity] ?? 'neutral'} size="sm">
      {severity}
    </Badge>
  );
}

/** A labelled figure inside a panel — denser than a full `Stat` tile. */
export function MiniStat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'primary' | 'ember' | 'danger' | 'success';
}) {
  const toneClass = {
    default: 'text-fg',
    primary: 'text-primary',
    ember: 'text-ember',
    danger: 'text-danger',
    success: 'text-success',
  }[tone];

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium tracking-wide text-subtle uppercase">
        {label}
      </span>
      <span className={cn('karo-numeric text-[15px] leading-tight font-semibold', toneClass)}>
        {value}
      </span>
      {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
    </div>
  );
}

/** Section wrapper with a title bar — used wherever a `Card` would be too soft. */
export function AdminPanel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm leading-tight font-semibold text-fg">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-[12px] leading-snug text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}
