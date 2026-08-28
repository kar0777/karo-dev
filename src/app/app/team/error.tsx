'use client';

import * as React from 'react';

import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

export default function TeamError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Team page failed to render', error);
    reportClientError({ error, boundary: 'team' });
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <ErrorState
        title="The team roster could not be loaded"
        description="Nobody was added or removed — this page failed to read the membership list. Retry, and if it persists your team is unaffected."
        code={error.digest}
        retry={reset}
      />
    </div>
  );
}
