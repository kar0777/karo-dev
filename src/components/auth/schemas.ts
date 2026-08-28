import { z } from 'zod';

import { MIN_PASSWORD_LENGTH } from '@/lib/crypto/password-policy';

/**
 * The auth input contracts, defined once and used on both sides of the wire:
 * the route handlers parse with them, the forms validate with them. That is the
 * whole point — a rule that only exists on the server produces a round trip to
 * learn something the browser already knew, and a rule that only exists on the
 * client is not a rule at all.
 *
 * Password *strength* deliberately lives elsewhere (`scorePassword`), because it
 * is advisory in the meter and enforced in `@/lib/auth/service`.
 */

export const MAX_PASSWORD_LENGTH = 256;
export const MAX_NAME_LENGTH = 80;

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address')
  .max(320, 'That email address is too long')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address, like you@company.com'));

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`);

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the name you want to be called')
  .max(MAX_NAME_LENGTH, `Use at most ${MAX_NAME_LENGTH} characters`);

const tokenSchema = z
  .string()
  .trim()
  .min(1, 'This link is missing its token')
  .max(512, 'This link is malformed');

export const loginSchema = z.object({
  email: emailSchema,
  // Never apply strength rules to a sign-in: an account created before the
  // rules tightened must still be able to get in and change its password.
  password: z.string().min(1, 'Enter your password').max(MAX_PASSWORD_LENGTH),
});

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: tokenSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Flattens a `ZodError` into `{ field: firstMessage }`. Only the first issue per
 * field is kept — a control can show one message, and stacking three of them
 * under an input reads as shouting.
 */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'form';
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * Server-side validation issues arrive as `details: [{ path, message, code }]`
 * on the error envelope. This maps them back onto form fields so a rule that
 * only the server can check (a weak password, a taken address) still lands under
 * the right input instead of only in the banner.
 */
export function fieldErrorsFromDetails(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};

  const out: Record<string, string> = {};
  for (const entry of details) {
    if (!entry || typeof entry !== 'object') continue;
    const { path, message } = entry as { path?: unknown; message?: unknown };
    if (typeof path !== 'string' || typeof message !== 'string') continue;
    const key = path === '' ? 'form' : path;
    out[key] ??= message;
  }
  return out;
}
