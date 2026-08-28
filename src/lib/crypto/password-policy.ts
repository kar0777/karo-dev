/**
 * What counts as an acceptable password — and nothing else.
 *
 * This is deliberately free of `node:crypto`. It used to live next to the scrypt
 * hashing in `password.ts`, whose own comment described `scorePassword` as
 * "shared by the client meter and the server-side registration validator" — but
 * the two were never actually separated, so every client that wanted the shared
 * half pulled the hashing half with it.
 *
 * That was not a tidiness problem. `password.ts` calls `promisify(scrypt)` at
 * module scope, and in a browser bundle `crypto.scrypt` is an empty shim, so the
 * call throws `The "original" argument must be of type Function` while the module
 * is still evaluating. Every auth form imported this chain, so the whole sign-in
 * screen died on hydration — server-rendered HTML looked perfect, which is why
 * curl and status-code smoke tests never noticed.
 *
 * Keep this module dependency-free. `password.ts` is marked `server-only`, so if
 * a client ever reaches the hashing again the build fails instead of the browser.
 */

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too weak' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  issues: string[];
};

const COMMON_PASSWORDS = new Set([
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

/** Shared by the client meter and the server-side registration validator. */
export function scorePassword(password: string): PasswordStrength {
  const issues: string[] = [];
  let score = 0;

  if (password.length < 10) issues.push('Use at least 10 characters');
  else score += password.length >= 16 ? 2 : 1;

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password))
    issues.push('Mix upper and lower case');
  else score += 1;

  if (!/\d/.test(password) && !/[^A-Za-z0-9]/.test(password))
    issues.push('Add a number or symbol');
  else score += 1;

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    issues.push('This password is too common');
    score = 0;
  }

  if (/^(.)\1+$/.test(password)) {
    issues.push('Avoid repeated characters');
    score = 0;
  }

  const clamped = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
  return { score: clamped, label: labels[clamped], issues };
}

export const MIN_PASSWORD_LENGTH = 10;
