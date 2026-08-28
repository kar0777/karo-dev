'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiClientError } from '@/lib/client/api';

/**
 * Turns whatever a form catches into an Alert that says what happened and what
 * to do next.
 *
 * Sign-in in particular must not collapse three very different situations into
 * one red box: a typo, a suspended account and a tripped rate limit each need a
 * different next action from the person reading them.
 */

export type AuthErrorView = {
  variant: 'danger' | 'warning' | 'info';
  title: string;
  message: string;
  /** Seconds remaining before a retry is worth attempting. */
  retryAfterSeconds?: number;
};

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function describeAuthError(error: unknown): AuthErrorView {
  if (offline()) {
    return {
      variant: 'warning',
      title: "You're offline",
      message:
        'Karo could not reach the server. Check your connection — nothing was submitted, so you can retry as soon as you are back.',
    };
  }

  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'rate_limited':
        return {
          variant: 'warning',
          title: 'Too many attempts',
          message:
            'Sign-in is temporarily blocked for this address to slow down guessing. Nothing is wrong with your account.',
          retryAfterSeconds: error.retryAfterSeconds,
        };
      case 'unauthorized':
        return {
          variant: 'danger',
          title: 'That email and password do not match',
          message:
            'Check for a typo, or reset your password if you are not sure what it is. We do not say which of the two was wrong.',
        };
      case 'csrf_failed':
        return {
          variant: 'warning',
          title: 'This page went stale',
          message:
            'Your browser sent a request Karo could not verify — usually an old tab. Reload the page and try again; nothing was changed.',
        };
      default:
        return {
          variant: error.status >= 500 ? 'warning' : 'danger',
          title: error.title,
          message: error.message,
        };
    }
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      variant: 'info',
      title: 'Cancelled',
      message: 'The request was cancelled before it finished. Try again.',
    };
  }

  return {
    variant: 'warning',
    title: 'Karo could not reach the server',
    message:
      error instanceof Error && error.message
        ? error.message
        : 'The request did not complete. Retry in a moment — if it keeps failing, the server may be restarting.',
  };
}

export function AuthErrorAlert({
  view,
  countdownSeconds,
}: {
  view: AuthErrorView;
  /** Live remaining seconds, when the caller is running a retry countdown. */
  countdownSeconds?: number;
}) {
  const showCountdown = typeof countdownSeconds === 'number' && countdownSeconds > 0;

  return (
    <Alert variant={view.variant}>
      <AlertTitle>{view.title}</AlertTitle>
      <AlertDescription>
        <p>{view.message}</p>
        {showCountdown ? (
          <p className="mt-1 karo-numeric">
            Try again in {countdownSeconds} {countdownSeconds === 1 ? 'second' : 'seconds'}.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
