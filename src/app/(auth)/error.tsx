'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

/**
 * Error boundary for the auth screens.
 *
 * These pages read admin settings and the session, so the realistic failure is
 * an unreachable database rather than a render bug — and the useful advice is
 * therefore "retry", not "contact support". Scoped to the group so the split
 * layout, and the way back to the marketing site, stay on screen.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[karo] auth screen failed', error);
    // Worth reporting even though there is no session: a broken sign-in
    // screen is invisible to us and total for the user.
    reportClientError({ error, boundary: 'auth' });
  }, [error]);

  return (
    <div className="space-y-4">
      <ErrorState
        size="sm"
        title="This screen could not load"
        description="Karo could not reach the service that answers who you are. Nothing was submitted and no session was changed — retry, and if it keeps failing the server is probably still starting."
        retry={reset}
        retryLabel="Retry"
        code={error.digest}
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild variant="ghost" size="sm" className="flex-1">
          <Link href="/login">Back to sign in</Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="flex-1">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    </div>
  );
}
