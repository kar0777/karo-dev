'use client';

import * as React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

/**
 * Error boundary for everything under `/app`.
 *
 * Next passes a `digest` in production instead of the message — that string is
 * the only way support can find the matching server log line, so it is shown
 * verbatim rather than swallowed.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[karo] app route error', error);
    reportClientError({ error, boundary: 'app' });
  }, [error]);

  const isNetwork =
    typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col justify-center px-4 py-16 sm:px-6">
      <ErrorState
        title={isNetwork ? 'You appear to be offline' : 'This page could not be loaded'}
        description={
          isNetwork
            ? 'Karo could not reach the server. Your work is saved — reconnect and retry, nothing was lost.'
            : 'The server failed while rendering this page. Retrying often works; if it does not, the code below identifies the exact failure in our logs.'
        }
        code={error.digest ?? error.message.slice(0, 120)}
        retry={reset}
        retryLabel="Try again"
        secondaryAction={
          <Button asChild variant="ghost" size="sm">
            <Link href="/app">Back to Overview</Link>
          </Button>
        }
      />
    </div>
  );
}
