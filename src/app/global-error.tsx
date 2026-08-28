'use client';

import { useEffect } from 'react';
import { LatticeBackdrop } from '@/components/brand/lattice';
import { KaroLogo } from '@/components/brand/logo';
import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/client/report-error';
import './globals.css';

/**
 * Last-resort boundary. This replaces the root layout entirely, so it
 * owns `<html>` and `<body>` and cannot rely on anything the layout
 * normally provides — no theme provider, no font variables, no toaster.
 *
 * Consequences, all deliberate:
 *  · `<html class="dark">` is hard-coded, matching the app's default
 *    theme, because next-themes is not mounted to resolve one;
 *  · the font stack is written out inline, because `--font-inter` is
 *    only defined by the root layout and an unresolved `var()` would
 *    drop the whole declaration back to the browser's default serif.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[karo] fatal error', error);
    // The root layout is gone here, so the CSRF token this app normally
    // attaches does not exist — which is why the intake route accepts an
    // unauthenticated POST. See its docblock.
    reportClientError({ error, boundary: 'global' });
  }, [error]);

  return (
    <html lang="en" className="dark h-full">
      <body
        className="min-h-dvh bg-bg text-fg antialiased"
        style={{
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        }}
      >
        <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
          <LatticeBackdrop fade="top" opacity={70} />

          <div className="absolute top-6 left-6">
            <KaroLogo size={22} />
          </div>

          <div className="w-full max-w-lg">
            <ErrorState
              title="Karo failed to start this page"
              description="The application crashed before it could render anything. Reloading usually clears it. If it happens twice in a row, the platform is likely having an incident — check status.karo.dev or send us the code below."
              retry={reset}
              code={error.digest}
            />

            <p className="mt-6 text-center text-xs text-subtle">
              <a
                href="mailto:support@karo.dev?subject=Karo%20fatal%20error"
                className="underline decoration-line-strong underline-offset-2 hover:text-fg"
              >
                support@karo.dev
              </a>
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
