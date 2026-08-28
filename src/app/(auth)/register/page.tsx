import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Lock } from 'lucide-react';

import { AuthHeading } from '@/components/auth/auth-heading';
import { firstParam, safeNextPath } from '@/components/auth/next-path';
import { RegisterForm } from '@/components/auth/register-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { isSignupEnabled } from '@/lib/auth/service';
import { getSession } from '@/lib/auth/session';
import { buildMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  title: 'Create an account',
  description:
    'Create a Karo account and get a personal workspace where your AI coding agent has a real sandboxed machine.',
  path: '/register',
  noIndex: true,
});

const AFTER_SIGNUP = '/app/onboarding';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next), AFTER_SIGNUP);

  const active = await getSession();
  if (active && !active.user.isSuspended) redirect(next);

  const signupEnabled = await isSignupEnabled();

  if (!signupEnabled) {
    return (
      <div className="space-y-6">
        <AuthHeading
          title="Sign-up is closed here"
          description="This Karo deployment does not accept public registrations."
        />

        <Alert variant="warning" icon={Lock}>
          <AlertTitle>You need an invitation</AlertTitle>
          <AlertDescription>
            <p>
              An administrator turned off public sign-up for this installation. Ask a team owner
              to send you an invitation — accepting it creates your account and puts you
              straight into their workspace.
            </p>
          </AlertDescription>
        </Alert>

        <Button asChild size="lg" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Create your Karo account"
        description="Your personal workspace, a sandboxed machine for the agent, and metering from the first token."
      />

      <RegisterForm next={next} />
    </div>
  );
}
