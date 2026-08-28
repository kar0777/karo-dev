'use client';

import * as React from 'react';

import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surfaced in the browser console so a support ticket can quote the digest,
    // and sent to the server so the ticket is not the first we hear of it.
    console.error('Settings failed to render', error);
    reportClientError({ error, boundary: 'settings' });
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <ErrorState
        title="Settings could not be loaded"
        description="Your account is untouched — this page failed to read from the database. Retry, and if it keeps failing check the platform status page."
        code={error.digest}
        retry={reset}
      />
    </div>
  );
}
