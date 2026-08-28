'use client';

import * as React from 'react';

import { Card } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

export type ExtensionsPageErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
  /** What failed, in the user's words: "the MCP server list". */
  subject: string;
  /** Concrete next step for this page. */
  hint: string;
  /**
   * Machine-readable name for the log, where `subject` is prose that can be
   * reworded at any time. Both boundaries that use this component pass one.
   */
  boundary?: string;
};

/**
 * Shared error boundary body for the extensions pages.
 *
 * The message says what did not load and what to do about it — a bare "Something
 * went wrong" leaves the user with nowhere to go.
 */
export function ExtensionsPageError({
  error,
  reset,
  subject,
  hint,
  boundary = 'extensions',
}: ExtensionsPageErrorProps) {
  React.useEffect(() => {
    // Surfaces the failure in the browser console for support to ask about,
    // without printing a stack trace into the page.
    console.error(`[karo] failed to load ${subject}`, error);
    reportClientError({ error, boundary });
  }, [error, subject, boundary]);

  return (
    <div className="p-4 sm:p-6">
      <Card>
        <ErrorState
          title={`Could not load ${subject}`}
          description={hint}
          code={error.digest}
          retry={reset}
          retryLabel="Try again"
        />
      </Card>
    </div>
  );
}
