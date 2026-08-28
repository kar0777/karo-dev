'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Field, FieldError, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A password input with a reveal toggle.
 *
 * The toggle is a real `<button>` inside the field rather than an overlay, so it
 * is reachable by keyboard and announces its state. Revealing is a deliberate
 * affordance: typing a 16-character passphrase blind into a signup form is how
 * people end up choosing "Password1!".
 */
export type PasswordFieldProps = {
  id?: string;
  name: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: string | undefined;
  hint?: React.ReactNode;
  /** Extra ids appended to `aria-describedby`, e.g. a strength meter. */
  describedBy?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  className?: string;
  /** Right-aligned slot next to the label — used for "Forgot password?". */
  labelAside?: React.ReactNode;
};

export function PasswordField({
  id,
  name,
  label,
  value,
  onValueChange,
  autoComplete,
  error,
  hint,
  describedBy,
  disabled = false,
  autoFocus = false,
  required = true,
  className,
  labelAside,
}: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-password`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [revealed, setRevealed] = useState(false);

  const described = [error ? errorId : null, hint ? hintId : null, describedBy ?? null]
    .filter(Boolean)
    .join(' ');

  return (
    <Field className={className} disabled={disabled}>
      <FieldLabel htmlFor={inputId} required={required} aside={labelAside}>
        {label}
      </FieldLabel>

      <div className="relative">
        <Input
          id={inputId}
          name={name}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          required={required}
          inputSize="lg"
          className="pr-10"
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          disabled={disabled}
          aria-controls={inputId}
          aria-pressed={revealed}
          className={cn(
            'absolute inset-y-0 right-0 inline-flex w-9 items-center justify-center rounded-r-md text-subtle',
            'transition-colors duration-150 ease-[var(--k-ease)] hover:text-fg',
            'disabled:pointer-events-none disabled:opacity-55',
          )}
        >
          {revealed ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
          <span className="sr-only">{revealed ? 'Hide password' : 'Show password'}</span>
        </button>
      </div>

      {hint ? <FieldHint id={hintId}>{hint}</FieldHint> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
