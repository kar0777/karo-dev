'use client';

import { useMemo } from 'react';
import { Check, Dot } from 'lucide-react';

import { MIN_PASSWORD_LENGTH, scorePassword } from '@/lib/crypto/password-policy';
import { cn } from '@/lib/utils';

/**
 * Live password strength.
 *
 * Scoring comes from `scorePassword` in `@/lib/crypto/password` — the exact
 * function the server validates with — so the meter can never promise something
 * registration will then reject. The returned `issues` are shown as concrete
 * instructions ("Mix upper and lower case") rather than being compressed into a
 * bar, because a bar tells you that you failed and not what to do about it.
 */

const SEGMENTS = 4;

const TONE: Record<0 | 1 | 2 | 3 | 4, { bar: string; text: string }> = {
  0: { bar: 'bg-danger', text: 'text-danger' },
  1: { bar: 'bg-danger', text: 'text-danger' },
  2: { bar: 'bg-warning', text: 'text-warning-soft-fg' },
  3: { bar: 'bg-primary', text: 'text-primary' },
  4: { bar: 'bg-success', text: 'text-success-soft-fg' },
};

/** Registration refuses anything below this; the meter says so before you submit. */
export const MIN_ACCEPTED_SCORE = 2;

export function isPasswordAcceptable(password: string): boolean {
  if (password.length < MIN_PASSWORD_LENGTH) return false;
  return scorePassword(password).score >= MIN_ACCEPTED_SCORE;
}

export function PasswordStrength({
  password,
  id,
  className,
}: {
  password: string;
  /** Point the input's `aria-describedby` here. */
  id: string;
  className?: string;
}) {
  const strength = useMemo(() => scorePassword(password), [password]);
  const empty = password.length === 0;

  // A score of 0 with characters typed still deserves one lit segment, or the
  // meter looks broken while you type.
  const filled = empty ? 0 : Math.max(1, strength.score);
  const tone = TONE[strength.score];
  const acceptable = !empty && strength.score >= MIN_ACCEPTED_SCORE;

  return (
    <div id={id} className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, index) => (
            <span
              key={index}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-150 ease-[var(--k-ease)]',
                index < filled ? tone.bar : 'bg-surface-3',
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            'w-16 shrink-0 text-right text-[11px] font-medium tabular-nums',
            empty ? 'text-subtle' : tone.text,
          )}
        >
          {empty ? '—' : strength.label}
        </span>
      </div>

      <div aria-live="polite">
        {empty ? (
          <p className="text-xs text-subtle">
            At least {MIN_PASSWORD_LENGTH} characters, mixed case, and a number or symbol.
          </p>
        ) : strength.issues.length > 0 ? (
          <ul className="space-y-0.5">
            {strength.issues.map((issue) => (
              <li key={issue} className="flex items-start gap-1 text-xs text-muted">
                <Dot className="mt-px size-3.5 shrink-0 text-subtle" aria-hidden="true" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-1 text-xs text-success-soft-fg">
            <Check className="size-3.5 shrink-0" aria-hidden="true" />
            This password will resist offline cracking.
          </p>
        )}
      </div>

      {!empty && !acceptable && strength.issues.length === 0 ? (
        <p className="text-xs text-muted">Add more length or variety before continuing.</p>
      ) : null}
    </div>
  );
}
