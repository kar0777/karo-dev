'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, MailCheck, Terminal } from 'lucide-react';

import {
  AuthErrorAlert,
  describeAuthError,
  type AuthErrorView,
} from '@/components/auth/auth-error';
import { fieldErrorsOf, forgotPasswordSchema } from '@/components/auth/schemas';
import { useSignedOutCsrf } from '@/components/auth/use-signed-out-csrf';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { apiFetch, ApiClientError } from '@/lib/client/api';

/**
 * Password reset request.
 *
 * The confirmation panel is identical whether or not the address exists, and it
 * is shown for *every* accepted submission. Anything else — a different message,
 * a different delay, a field-level "no such account" — turns this form into an
 * account-enumeration oracle.
 */

export type ForgotPasswordFormProps = {
  /**
   * True when this deployment writes email to the server log instead of sending
   * it. Saying so is the difference between "it works" and "nothing arrived".
   */
  consoleEmail: boolean;
  /** Pre-fills the field when the person came from a failed sign-in. */
  initialEmail?: string;
};

export function ForgotPasswordForm({
  consoleEmail,
  initialEmail = '',
}: ForgotPasswordFormProps) {
  const formId = useId();
  const emailId = `${formId}-email`;

  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
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

  async function submit(address: string) {
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      await apiFetch('/api/auth/forgot-password', { json: { email: address } });
      setSentTo(address);
      setRetryIn(30);
    } catch (caught) {
      const view = describeAuthError(caught);
      setError(view);
      if (caught instanceof ApiClientError && view.retryAfterSeconds) {
        setRetryIn(Math.min(view.retryAfterSeconds, 3600));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setError(null);
      setFieldErrors(fieldErrorsOf(parsed.error));
      return;
    }
    await submit(parsed.data.email);
  }

  if (sentTo) {
    return (
      <div className="space-y-5">
        <Alert variant="success" icon={MailCheck}>
          <AlertTitle>Check {sentTo}</AlertTitle>
          <AlertDescription>
            <p>
              If an account exists for that address, a reset link is on its way. It is valid for
              one hour and can be used once. Setting a new password signs you out of every
              device.
            </p>
            <p className="mt-1.5">
              Nothing after a few minutes? Look in spam, then confirm you typed the address you
              signed up with.
            </p>
          </AlertDescription>
        </Alert>

        {consoleEmail ? (
          <Alert variant="info" icon={Terminal}>
            <AlertTitle>This deployment prints email to the server log</AlertTitle>
            <AlertDescription>
              No mail server is configured, so the reset link was written to the terminal
              running Karo. Look for the boxed “outgoing email” block and copy the link from it.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? <AuthErrorAlert view={error} countdownSeconds={retryIn} /> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="flex-1"
            onClick={() => void submit(sentTo)}
            loading={submitting}
            disabled={submitting || retryIn > 0}
          >
            {retryIn > 0 ? `Send again in ${retryIn}s` : 'Send the link again'}
          </Button>
          <Button asChild variant="ghost" size="lg" className="flex-1">
            <Link href="/login">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to sign in
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? <AuthErrorAlert view={error} countdownSeconds={retryIn} /> : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field>
          <FieldLabel htmlFor={emailId} required>
            Email
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
            autoFocus
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
            required
          />
          {fieldErrors.email ? (
            <FieldError id={`${emailId}-error`}>{fieldErrors.email}</FieldError>
          ) : null}
        </Field>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting}
          disabled={submitting || retryIn > 0}
        >
          {retryIn > 0 ? `Try again in ${retryIn}s` : 'Send reset link'}
        </Button>
      </form>

      <p className="text-center text-[13px] text-muted">
        Remembered it?{' '}
        <Link href="/login" className="rounded-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
