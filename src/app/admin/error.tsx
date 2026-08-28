'use client';

import * as React from 'react';

import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

/**
 * Segment-level boundary. Most admin failures are a database that is down or a
 * migration that has not run — the copy says both, because "try again" alone
 * is useless advice when the cause is structural.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[karo:admin] page render failed', error);
    reportClientError({ error, boundary: 'admin' });
  }, [error]);

  return (
    <div className="py-10">
      <ErrorState
        title="This admin view could not load"
        description="The query behind this page failed. If the database is reachable, check that migrations have been applied (npm run db:push) and that the seed has run — several admin views read tables that only exist after a migration."
        code={error.digest ?? error.message.slice(0, 120)}
        retry={reset}
        retryLabel="Try again"
      />
    </div>
  );
}
