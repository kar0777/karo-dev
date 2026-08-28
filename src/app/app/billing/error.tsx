'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

/**
 * A failure to *render* billing never means a failure to *charge* — the two
 * systems are independent, and saying so here prevents a support ticket.
 */
export default function BillingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('Billing page failed to render', error);
    reportClientError({ error, boundary: 'billing' });
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <ErrorState
        title="Billing could not be loaded"
        description="Your plan, balance and invoices are unaffected — this was a problem reading them. Retry, and if it persists contact support with the code below."
        code={error.digest}
        retry={reset}
        retryLabel="Retry"
        secondaryAction={
          <Button asChild variant="ghost" size="sm">
            <a href="/app/usage">Open usage instead</a>
          </Button>
        }
      />
    </div>
  );
}
