'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Play } from 'lucide-react';

import {
  AuthErrorAlert,
  describeAuthError,
  type AuthErrorView,
} from '@/components/auth/auth-error';
import { PasswordField } from '@/components/auth/password-field';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { fieldErrorsFromDetails, fieldErrorsOf, loginSchema } from '@/components/auth/schemas';
import { useSignedOutCsrf } from '@/components/auth/use-signed-out-csrf';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { apiFetch, ApiClientError } from '@/lib/client/api';

/**
 * Sign-in.
 *
 * There is no "remember me" checkbox on purpose: the session is a 30-day sliding
 * cookie for everyone, renewed while you keep using Karo and revocable from
 * Settings. A checkbox that only chooses between two lifetimes is a decision the
 * product should make, not the person trying to get to work.
 */

export type LoginFormProps = {
  /** Already validated as a same-origin path by the page. */
  next: string;
  demoEnabled: boolean;
  /** `?demo=1` — land the keyboard on the demo button. */
  autoFocusDemo: boolean;
  signupEnabled: boolean;
};

type Busy = 'idle' | 'credentials' | 'demo';

export function LoginForm({ next, demoEnabled, autoFocusDemo, signupEnabled }: LoginFormProps) {
  const router = useRouter();
  const formId = useId();
  const demoButtonRef = useRef<HTMLButtonElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>('idle');
  const [error, setError] = useState<AuthErrorView | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryIn, setRetryIn] = useState(0);

  useSignedOutCsrf();

  useEffect(() => {
    if (autoFocusDemo) demoButtonRef.current?.focus();
  }, [autoFocusDemo]);

  // Counts a rate-limit lockout down so the button re-enables on its own rather
  // than leaving the person to guess when "later" is.
  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = window.setInterval(() => {
      setRetryIn((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryIn]);

  const locked = retryIn > 0;
  const disabled = busy !== 'idle' || locked;

  function handleFailure(caught: unknown) {
    const view = describeAuthError(caught);
    setError(view);
    if (caught instanceof ApiClientError) {
      setFieldErrors(fieldErrorsFromDetails(caught.details));
      if (view.retryAfterSeconds && view.retryAfterSeconds > 0) {
        setRetryIn(Math.min(view.retryAfterSeconds, 900));
      }
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(null);
      setFieldErrors(fieldErrorsOf(parsed.error));
      return;
    }

    setError(null);
    setFieldErrors({});
    setBusy('credentials');

    try {
      await apiFetch('/api/auth/login', { json: parsed.data });
      // Keep the button busy through the navigation — resetting it here makes
      // the form flash "ready" for a frame before the app shell paints.
      router.replace(next);
      router.refresh();
    } catch (caught) {
      handleFailure(caught);
      setBusy('idle');
    }
  }

  async function onDemo() {
    if (disabled) return;
    setError(null);
    setFieldErrors({});
    setBusy('demo');

    try {
      await apiFetch('/api/auth/demo', { method: 'POST' });
      router.replace(next);
      router.refresh();
    } catch (caught) {
      handleFailure(caught);
      setBusy('idle');
    }
  }

  const emailId = `${formId}-email`;

  return (
    <div className="space-y-5">
      {error ? (
        <AuthErrorAlert view={error} countdownSeconds={locked ? retryIn : undefined} />
      ) : null}

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
            disabled={busy !== 'idle'}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
            required
          />
          {fieldErrors.email ? (
            <FieldError id={`${emailId}-error`}>{fieldErrors.email}</FieldError>
          ) : null}
        </Field>

        <PasswordField
          id={`${formId}-password`}
          name="password"
          label="Password"
          value={password}
          onValueChange={setPassword}
          autoComplete="current-password"
          disabled={busy !== 'idle'}
          error={fieldErrors.password}
          labelAside={
            <Link
              href="/forgot-password"
              className="rounded-sm font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          }
        />

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={busy === 'credentials'}
          disabled={disabled}
        >
          {locked ? `Locked for ${retryIn}s` : 'Sign in'}
        </Button>

        <p className="text-center text-[11px] text-subtle">
          Signing in starts a 30-day session on this device. You can end it from Settings at any
          time.
        </p>
      </form>

      {demoEnabled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-[11px] tracking-wide text-subtle uppercase">or</span>
            <Separator className="flex-1" />
          </div>

          <Button
            ref={demoButtonRef}
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={onDemo}
            loading={busy === 'demo'}
            disabled={disabled}
            iconLeft={<Play />}
          >
            Continue with the demo account
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-subtle">
            A seeded workspace with projects, sandboxes and usage history. Shared and reset
            regularly — do not put anything private in it.
          </p>
        </div>
      ) : null}

      <OAuthButtons />

      <p className="text-center text-[13px] text-muted">
        {signupEnabled ? (
          <>
            New to Karo?{' '}
            <Link
              href={
                next === '/app' ? '/register' : `/register?next=${encodeURIComponent(next)}`
              }
              className="inline-flex items-center gap-1 rounded-sm font-medium text-primary hover:underline"
            >
              Create an account
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </>
        ) : (
          <>
            Sign-up is invitation-only on this deployment. Ask a team owner for an invite link.
          </>
        )}
      </p>
    </div>
  );
}
