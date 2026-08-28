'use client';

import { cn } from '@/lib/utils';

/**
 * Live strength meter.
 *
 * This mirrors the rules in `scorePassword` (`@/lib/crypto/password`) rather
 * than importing them: that module pulls in `node:crypto` for the scrypt half
 * and cannot be bundled for the browser. The server stays authoritative — it
 * re-scores every password and rejects anything below "Fair" with the same
 * wording, so a client that lied about the score still fails the request.
 */

export const MIN_PASSWORD_LENGTH = 10;

const COMMON = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  'qwertyui',
  'letmein1',
  'iloveyou',
  'admin123',
  'welcome1',
  'changeme',
]);

const LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

export type Strength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: (typeof LABELS)[number];
  issues: string[];
};

export function scoreLocally(password: string): Strength {
  const issues: string[] = [];
  let score = 0;

  if (password.length < MIN_PASSWORD_LENGTH) issues.push('Use at least 10 characters');
  else score += password.length >= 16 ? 2 : 1;

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    issues.push('Mix upper and lower case');
  } else {
    score += 1;
  }

  if (!/\d/.test(password) && !/[^A-Za-z0-9]/.test(password)) {
    issues.push('Add a number or symbol');
  } else {
    score += 1;
  }

  if (COMMON.has(password.toLowerCase())) {
    issues.push('This password is too common');
    score = 0;
  }
  if (/^(.)\1+$/.test(password)) {
    issues.push('Avoid repeated characters');
    score = 0;
  }

  const clamped = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  return { score: clamped, label: LABELS[clamped], issues };
}

const BAR_TONES = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-primary', 'bg-success'] as const;

const TEXT_TONES = [
  'text-danger',
  'text-danger',
  'text-warning',
  'text-primary',
  'text-success',
] as const;

export function PasswordStrength({ password, id }: { password: string; id?: string }) {
  const strength = scoreLocally(password);
  const filled = password.length === 0 ? 0 : strength.score + 1;

  return (
    <div id={id} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((index) => (
            <span
              key={index}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-200 ease-[var(--k-ease)]',
                index < filled ? BAR_TONES[strength.score] : 'bg-surface-3',
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            'w-16 shrink-0 text-right text-[11px] font-medium',
            password.length === 0 ? 'text-subtle' : TEXT_TONES[strength.score],
          )}
        >
          {password.length === 0 ? '—' : strength.label}
        </span>
      </div>

      <p className="text-xs text-subtle" aria-live="polite">
        {password.length === 0
          ? 'At least 10 characters, with mixed case and a number or symbol.'
          : strength.issues.length > 0
            ? strength.issues.join(' · ')
            : 'Strong enough to resist offline cracking.'}
      </p>
    </div>
  );
}
