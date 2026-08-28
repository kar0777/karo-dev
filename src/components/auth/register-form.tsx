'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  AuthErrorAlert,
  describeAuthError,
  type AuthErrorView,
} from '@/components/auth/auth-error';
import { PasswordField } from '@/components/auth/password-field';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { PasswordStrength, isPasswordAcceptable } from '@/components/auth/password-strength';
import {
  fieldErrorsFromDetails,
  fieldErrorsOf,
  registerSchema,
} from '@/components/auth/schemas';
import { useSignedOutCsrf } from '@/components/auth/use-signed-out-csrf';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiClientError } from '@/lib/client/api';

/**
 * Registration.
 *
 * Client-side rules mirror the server exactly — the same Zod schema for shape,
 * the same `scorePassword` for strength — so the only failures that survive the
 * round trip are ones the browser genuinely could not know: a taken address, a
 * closed sign-up, a tripped limit.
 */

export type RegisterFormProps = {
  /**
   * Where to land once the account exists — `/app/onboarding` unless the person
   * arrived from a deep link. Already validated as a same-origin path.
   */
  next: string;
};

export function RegisterForm({ next }: RegisterFormProps) {
  const router = useRouter();
  const formId = useId();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AuthErrorView | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryIn, setRetryIn] = useState(0);

  useSignedOutCsrf();

  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = window.setInterval(() => {
      setRetryIn((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryIn]);

  const locked = retryIn > 0;
  const disabled = submitting || locked;

  const nameId = `${formId}-name`;
  const emailId = `${formId}-email`;
  const termsId = `${formId}-terms`;
  const strengthId = `${formId}-strength`;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;

    const parsed = registerSchema.safeParse({ name, email, password });
    const issues: Record<string, string> = parsed.success ? {} : fieldErrorsOf(parsed.error);

    if (!issues.password && !isPasswordAcceptable(password)) {
      issues.password = 'Not strong enough yet — fix the points listed under the meter.';
    }
    if (confirm !== password) {
      issues.confirm = 'The two passwords do not match.';
    }
    if (!accepted) {
      issues.terms = 'Accept the Terms of Service and Privacy Policy to continue.';
    }

    if (Object.keys(issues).length > 0 || !parsed.success) {
      setError(null);
      setFieldErrors(issues);
      return;
    }

    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      await apiFetch('/api/auth/register', { json: parsed.data });
      router.replace(next);
      router.refresh();
    } catch (caught) {
      const view = describeAuthError(caught);
      setError(view);
      if (caught instanceof ApiClientError) {
        setFieldErrors(fieldErrorsFromDetails(caught.details));
        if (view.retryAfterSeconds && view.retryAfterSeconds > 0) {
          setRetryIn(Math.min(view.retryAfterSeconds, 3600));
        }
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {error ? (
        <AuthErrorAlert view={error} countdownSeconds={locked ? retryIn : undefined} />
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field>
          <FieldLabel htmlFor={nameId} required>
            Name
          </FieldLabel>
          <Input
            id={nameId}
            name="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            inputSize="lg"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
            required
          />
          {fieldErrors.name ? (
            <FieldError id={`${nameId}-error`}>{fieldErrors.name}</FieldError>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor={emailId} required>
            Work email
          </FieldLabel>
          <Input
            id={emailId}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@company.com"
            inputSize="lg"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
            required
          />
          {fieldErrors.email ? (
            <FieldError id={`${emailId}-error`}>{fieldErrors.email}</FieldError>
          ) : null}
        </Field>

        <div className="space-y-2">
          <PasswordField
            id={`${formId}-password`}
            name="password"
            label="Password"
            value={password}
            onValueChange={setPassword}
            autoComplete="new-password"
            disabled={submitting}
            error={fieldErrors.password}
            describedBy={strengthId}
          />
          <PasswordStrength password={password} id={strengthId} />
        </div>

        <PasswordField
          id={`${formId}-confirm`}
          name="confirmPassword"
          label="Confirm password"
          value={confirm}
          onValueChange={setConfirm}
          autoComplete="new-password"
          disabled={submitting}
          error={fieldErrors.confirm}
        />

        <div className="space-y-1.5">
          <div className="flex items-start gap-2.5">
            <Checkbox
              id={termsId}
              checked={accepted}
              onCheckedChange={(value) => setAccepted(value === true)}
              disabled={submitting}
              aria-invalid={fieldErrors.terms ? true : undefined}
              aria-describedby={fieldErrors.terms ? `${termsId}-error` : undefined}
              className="mt-0.5"
            />
            <Label
              htmlFor={termsId}
              className="block text-[13px] leading-relaxed font-normal text-muted"
            >
              <span>
                I agree to the{' '}
                {/* Stops the label activating the checkbox when the link is clicked. */}
                <Link
                  href="/terms"
                  onClick={(event) => event.stopPropagation()}
                  className="rounded-sm font-medium text-primary hover:underline"
                >
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link
                  href="/privacy"
                  onClick={(event) => event.stopPropagation()}
                  className="rounded-sm font-medium text-primary hover:underline"
                >
                  Privacy Policy
                </Link>
                .
              </span>
            </Label>
          </div>
          {fieldErrors.terms ? (
            <FieldError id={`${termsId}-error`}>{fieldErrors.terms}</FieldError>
          ) : null}
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting}
          disabled={disabled}
        >
          {locked ? `Try again in ${retryIn}s` : 'Create account'}
        </Button>

        <p className="text-center text-[11px] leading-relaxed text-subtle">
          You get a personal workspace on the pay-as-you-go plan. No card is required, and every
          token and compute-second is metered before it is charged.
        </p>
      </form>

      <OAuthButtons />

      <p className="text-center text-[13px] text-muted">
        Already have an account?{' '}
        <Link href="/login" className="rounded-sm font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
