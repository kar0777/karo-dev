'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleCheck, Hourglass, MailCheck, MailQuestion } from 'lucide-react';

import {
  AuthErrorAlert,
  describeAuthError,
  type AuthErrorView,
} from '@/components/auth/auth-error';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch, ApiClientError } from '@/lib/client/api';

/**
 * Email confirmation.
 *
 * The token is consumed on mount, which means the state machine has to cope with
 * a link that has already been used — indistinguishable from an expired one at
 * the database level. The signed-in session settles it: if this account is
 * already confirmed, a dead token means "you did this already", not "too late".
 */

export type VerifyEmailClientProps = {
  /** `?token=` from the URL; `null` when someone opened the page directly. */
  token: string | null;
  /** True when a session exists — resending needs one. */
  signedIn: boolean;
  /** True when the signed-in account is already confirmed. */
  alreadyVerified: boolean;
  /** Address of the signed-in account, for the confirmation copy. */
  email: string | null;
  /** Where to continue to once the address is confirmed. */
  next: string;
  /** True when this deployment prints email to the server log. */
  consoleEmail: boolean;
};

type Stage = 'verifying' | 'verified' | 'already' | 'expired' | 'awaiting' | 'failed';

export function VerifyEmailClient({
  token,
  signedIn,
  alreadyVerified,
  email,
  next,
  consoleEmail,
}: VerifyEmailClientProps) {
  const router = useRouter();

  const initial: Stage = token ? 'verifying' : alreadyVerified ? 'already' : 'awaiting';
  const [stage, setStage] = useState<Stage>(initial);
  const [error, setError] = useState<AuthErrorView | null>(null);
  const [resending, setResending] = useState(false);
  const [resentTo, setResentTo] = useState<string | null>(null);

  // Strict Mode runs effects twice in development; a verification token is
  // single-use, so the second run would report a perfectly good link as dead.
  const attempted = useRef(false);

  const verify = useCallback(
    async (value: string) => {
      setStage('verifying');
      setError(null);

      try {
        await apiFetch('/api/auth/verify-email', { json: { token: value } });
        setStage('verified');
        router.refresh();
      } catch (caught) {
        if (caught instanceof ApiClientError) {
          if (alreadyVerified) {
            setStage('already');
            return;
          }
          if (caught.status === 400 || caught.status === 404) {
            setStage('expired');
            return;
          }
        }
        setError(describeAuthError(caught));
        setStage('failed');
      }
    },
    [alreadyVerified, router],
  );

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    void verify(token);
  }, [token, verify]);

  async function onResend() {
    if (resending) return;
    setResending(true);
    setError(null);

    try {
      const result = await apiFetch<{ alreadyVerified: boolean }>(
        '/api/auth/verify-email/resend',
        { method: 'POST' },
      );
      if (result?.alreadyVerified) {
        setStage('already');
      } else {
        setResentTo(email);
        setStage('awaiting');
      }
    } catch (caught) {
      setError(describeAuthError(caught));
    } finally {
      setResending(false);
    }
  }

  const resendButton = signedIn ? (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="flex-1"
      onClick={onResend}
      loading={resending}
    >
      Send a new link
    </Button>
  ) : (
    <Button asChild variant="secondary" size="lg" className="flex-1">
      <Link href="/login">Sign in to request a new link</Link>
    </Button>
  );

  const continueButton = (
    <Button
      type="button"
      size="lg"
      className="flex-1"
      onClick={() => {
        router.replace(signedIn ? next : '/login');
        router.refresh();
      }}
    >
      {signedIn ? 'Continue to Karo' : 'Continue to sign in'}
    </Button>
  );

  return (
    <div className="space-y-5">
      {stage === 'verifying' ? (
        <div
          className="flex items-center gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-3 text-[13px] text-muted"
          aria-live="polite"
        >
          <Spinner size="sm" label={null} />
          <span>Confirming your address…</span>
        </div>
      ) : null}

      {stage === 'verified' ? (
        <Alert variant="success" icon={CircleCheck}>
          <AlertTitle>Email confirmed</AlertTitle>
          <AlertDescription>
            <p>
              {email ? <>{email} is confirmed.</> : <>Your address is confirmed.</>} Quota and
              billing alerts will now reach you before they bite.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {stage === 'already' ? (
        <Alert variant="info" icon={MailCheck}>
          <AlertTitle>Already confirmed</AlertTitle>
          <AlertDescription>
            <p>
              {email ? <>{email} was</> : <>This address was</>} confirmed earlier, so this link
              had nothing left to do. Nothing is wrong — carry on.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {stage === 'expired' ? (
        <Alert variant="warning" icon={Hourglass}>
          <AlertTitle>This link has expired</AlertTitle>
          <AlertDescription>
            <p>
              Confirmation links last 24 hours and can be used once. This one is past that, or a
              newer link replaced it.
            </p>
            <p className="mt-1.5">
              {signedIn
                ? 'Send a fresh one and open it from the same browser.'
                : 'Sign in first — the resend button needs to know which account to send to.'}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {stage === 'awaiting' ? (
        <Alert
          variant={resentTo ? 'success' : 'info'}
          icon={resentTo ? MailCheck : MailQuestion}
        >
          <AlertTitle>
            {resentTo ? `New link sent to ${resentTo}` : 'Open the link from your email'}
          </AlertTitle>
          <AlertDescription>
            <p>
              {resentTo
                ? 'It is valid for 24 hours and replaces any earlier link. Open it in this browser.'
                : 'This page confirms an address when you arrive from the link in your inbox. There is no token in the current URL, so there is nothing to confirm yet.'}
            </p>
            {consoleEmail ? (
              <p className="mt-1.5">
                No mail server is configured here — the link was written to the terminal running
                Karo, inside the boxed “outgoing email” block.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? <AuthErrorAlert view={error} /> : null}

      {stage === 'verifying' ? null : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {stage === 'verified' || stage === 'already' ? continueButton : resendButton}
          {stage === 'verified' || stage === 'already' ? null : (
            <Button asChild variant="ghost" size="lg" className="flex-1">
              <Link href={signedIn ? next : '/login'}>
                {signedIn ? 'Skip for now' : 'Back to sign in'}
              </Link>
            </Button>
          )}
        </div>
      )}

      {stage === 'failed' && token ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => void verify(token)}
        >
          Try confirming again
        </Button>
      ) : null}
    </div>
  );
}
