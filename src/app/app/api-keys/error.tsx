'use client';

import * as React from 'react';

import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

export default function ApiKeysError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('API keys page failed to render', error);
    reportClientError({ error, boundary: 'api-keys' });
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <ErrorState
        title="API keys could not be loaded"
        description="Your stored keys are untouched and still encrypted — this page just failed to read them. Retry, or come back in a moment."
        code={error.digest}
        retry={reset}
      />
    </div>
  );
}
