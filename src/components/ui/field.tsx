import { CircleAlert } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { Label } from './label';

export interface FieldProps extends React.ComponentProps<'div'> {
  disabled?: boolean;
}

/** One form row: label, control, then hint or error. */
export function Field({ className, disabled, ...props }: FieldProps) {
  return (
    <div
      data-slot="field"
      data-disabled={disabled ? 'true' : undefined}
      className={cn('group space-y-1.5', className)}
      {...props}
    />
  );
}

export interface FieldLabelProps extends React.ComponentProps<typeof Label> {
  required?: boolean;
  /** Right-aligned helper, e.g. "Optional" or a character counter. */
  aside?: React.ReactNode;
}

export function FieldLabel({
  className,
  children,
  required,
  aside,
  ...props
}: FieldLabelProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className={className} {...props}>
        {children}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {aside ? <span className="text-[11px] text-subtle">{aside}</span> : null}
    </div>
  );
}

export function FieldHint({ className, children, ...props }: React.ComponentProps<'p'>) {
  if (children === null || children === undefined || children === false) return null;
  return (
    <p data-slot="field-hint" className={cn('text-xs text-subtle', className)} {...props}>
      {children}
    </p>
  );
}

export function FieldError({ className, children, ...props }: React.ComponentProps<'p'>) {
  if (children === null || children === undefined || children === false) return null;
  return (
    <p
      role="alert"
      data-slot="field-error"
      className={cn('flex items-start gap-1 text-xs text-danger', className)}
      {...props}
    >
      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
