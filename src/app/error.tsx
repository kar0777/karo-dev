'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LatticeBackdrop } from '@/components/brand/lattice';
import { KaroLogo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';

/**
 * Segment-level error boundary. Catches render and data-fetch failures
 * anywhere below the root layout; the layout itself (fonts, theme,
 * toaster) is still mounted, so this can use the full design system.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-thrown errors arrive here already redacted, carrying only a
    // digest. Logging keeps the client-side stack recoverable in dev, and
    // forwarding the digest is what lets an operator find the server line
    // a user is quoting off the screen.
    console.error('[karo] unhandled error', error);
    reportClientError({ error, boundary: 'root' });
  }, [error]);

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
      <LatticeBackdrop fade="top" opacity={70} />

      <Link
        href="/"
        className="absolute top-6 left-6 rounded-md transition-opacity hover:opacity-80"
        aria-label="Karo home"
      >
        <KaroLogo size={22} />
      </Link>

      <div className="w-full max-w-lg">
        <ErrorState
          title="Something broke on this page"
          description="The request failed before the page could finish rendering. Nothing you were working on was lost — retry first, and if it keeps failing, send us the code below."
          retry={reset}
          code={error.digest}
        />

        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button asChild variant="ghost" size="sm">
            <Link href="/app">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to dashboard
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href="mailto:support@karo.dev?subject=Karo%20error%20report">Email support</a>
          </Button>
        </div>
      </div>
    </main>
  );
}
