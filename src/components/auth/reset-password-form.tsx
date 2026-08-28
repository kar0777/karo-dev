'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleCheck, LinkIcon } from 'lucide-react';

import {
  AuthErrorAlert,
  describeAuthError,
  type AuthErrorView,
} from '@/components/auth/auth-error';
import { PasswordField } from '@/components/auth/password-field';
import { PasswordStrength, isPasswordAcceptable } from '@/components/auth/password-strength';
import {
  fieldErrorsFromDetails,
  fieldErrorsOf,
  resetPasswordSchema,
} from '@/components/auth/schemas';
import { useSignedOutCsrf } from '@/components/auth/use-signed-out-csrf';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { apiFetch, ApiClientError } from '@/lib/client/api';

/**
 * Choosing a new password from an emailed link.
 *
 * Reset tokens are single-use and expire in an hour, so "this link is dead" is a
 * routine outcome rather than an error — it gets its own state with the one
 * action that fixes it, not a red banner over a form that can no longer work.
 */

export type ResetPasswordFormProps = {
  /** `null` when the URL carried no `?token=`. */
  token: string | null;
};

type Stage = 'form' | 'expired' | 'done';

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const formId = useId();
  const strengthId = `${formId}-strength`;

  const [stage, setStage] = useState<Stage>(token ? 'form' : 'expired');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AuthErrorView | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useSignedOutCsrf();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !token) return;

    const parsed = resetPasswordSchema.safeParse({ token, password });
    const issues: Record<string, string> = parsed.success ? {} : fieldErrorsOf(parsed.error);

    if (!issues.password && !isPasswordAcceptable(password)) {
      issues.password = 'Not strong enough yet — fix the points listed under the meter.';
    }
    if (confirm !== password) {
      issues.confirm = 'The two passwords do not match.';
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
      await apiFetch('/api/auth/reset-password', { json: parsed.data });
      setStage('done');
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const details = fieldErrorsFromDetails(caught.details);
        // The service reports a dead token as a validation issue on `token`;
        // that is a different situation from a rejected password.
        if (details.token) {
          setStage('expired');
          setSubmitting(false);
          return;
        }
        setFieldErrors(details);
      }
      setError(describeAuthError(caught));
      setSubmitting(false);
    }
  }

  if (stage === 'expired') {
    return (
      <div className="space-y-5">
        <Alert variant="warning" icon={LinkIcon}>
          <AlertTitle>{token ? 'This link has expired' : 'This link is incomplete'}</AlertTitle>
          <AlertDescription>
            {token ? (
              <p>
                Reset links last one hour and can be used once — this one is past that, or it
                was already used. Your current password still works.
              </p>
            ) : (
              <p>
                The address you opened has no reset token in it. Email clients sometimes
                truncate long links; copying the whole URL usually fixes it.
              </p>
            )}
            <p className="mt-1.5">Request a fresh link and it will work straight away.</p>
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild size="lg" className="flex-1">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Button asChild variant="ghost" size="lg" className="flex-1">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="space-y-5">
        <Alert variant="success" icon={CircleCheck}>
          <AlertTitle>Password updated</AlertTitle>
          <AlertDescription>
            <p>
              Every other device has been signed out, and the address on this account is now
              confirmed. Sign in with the new password to continue.
            </p>
          </AlertDescription>
        </Alert>

        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => {
            router.replace('/login?reset=1');
            router.refresh();
          }}
        >
          Continue to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? <AuthErrorAlert view={error} /> : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-2">
          <PasswordField
            id={`${formId}-password`}
            name="password"
            label="New password"
            value={password}
            onValueChange={setPassword}
            autoComplete="new-password"
            disabled={submitting}
            error={fieldErrors.password}
            describedBy={strengthId}
            autoFocus
          />
          <PasswordStrength password={password} id={strengthId} />
        </div>

        <PasswordField
          id={`${formId}-confirm`}
          name="confirmPassword"
          label="Confirm new password"
          value={confirm}
          onValueChange={setConfirm}
          autoComplete="new-password"
          disabled={submitting}
          error={fieldErrors.confirm}
        />

        {fieldErrors.token ? <FieldError>{fieldErrors.token}</FieldError> : null}

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Set new password
        </Button>

        <p className="text-center text-[11px] leading-relaxed text-subtle">
          Setting a new password signs out every device currently using this account.
        </p>
      </form>
    </div>
  );
}
