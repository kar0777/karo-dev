import type { Metadata } from 'next';

import { AuthHeading } from '@/components/auth/auth-heading';
import { firstParam, safeNextPath } from '@/components/auth/next-path';
import { VerifyEmailClient } from '@/components/auth/verify-email-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isEmailVerificationEnforced } from '@/lib/auth/guards';
import { getSession } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { buildMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  title: 'Confirm your email',
  description: 'Confirm the email address on your Karo account.',
  path: '/verify-email',
  noIndex: true,
});

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = firstParam(params.token);
  const token = raw && raw.length <= 512 ? raw : null;
  const next = safeNextPath(firstParam(params.next));

  // The session is what lets the client tell "already confirmed" apart from
  // "expired" — the token is consumed either way, so the database cannot.
  const [active, enforced] = await Promise.all([getSession(), isEmailVerificationEnforced()]);

  // With the toggle on, "skip for now" buys the user nothing but a blocked app,
  // so the stakes are stated here rather than discovered one click later.
  const blockedAddress =
    enforced && active && !active.user.emailVerifiedAt ? active.user.email : null;

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Confirm your email"
        description="Confirming the address lets Karo warn you about quota and balance before a run is blocked."
      />

      {blockedAddress ? (
        <Alert variant="warning">
          <AlertTitle>This install requires a confirmed address</AlertTitle>
          <AlertDescription>
            <p>
              Until {blockedAddress} is confirmed, Karo keeps everything except your own
              settings closed. Skipping only postpones it.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <VerifyEmailClient
        token={token}
        signedIn={Boolean(active)}
        alreadyVerified={Boolean(active?.user.emailVerifiedAt)}
        email={active?.user.email ?? null}
        next={next}
        consoleEmail={env.EMAIL_TRANSPORT === 'console'}
      />
    </div>
  );
}
