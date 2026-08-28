'use client';

import * as React from 'react';

import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

/**
 * Usage is read-only, so a failure here is always recoverable: the data is
 * still in the database, we just could not read it this time.
 */
export default function UsageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Usage analytics failed to render', error);
    reportClientError({ error, boundary: 'usage' });
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <ErrorState
        title="Usage analytics could not be loaded"
        description="The metering data is safe — this was a problem reading it. Retry, and if it keeps failing pick a shorter period or clear the project filter."
        code={error.digest}
        retry={reset}
        retryLabel="Retry"
      />
    </div>
  );
}
