import type { Metadata } from 'next';

import { AuthHeading } from '@/components/auth/auth-heading';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { firstParam } from '@/components/auth/next-path';
import { env } from '@/lib/env';
import { buildMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  title: 'Reset your password',
  description: 'Request a password reset link for your Karo account.',
  path: '/forgot-password',
  noIndex: true,
});

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const emailParam = firstParam(params.email) ?? '';

  // Whether mail actually leaves the box is a deployment fact the person filling
  // in this form needs, and it is not a secret.
  const consoleEmail = env.EMAIL_TRANSPORT === 'console';

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Reset your password"
        description="Give us the address on the account and we will send a one-hour, single-use link."
      />

      <ForgotPasswordForm consoleEmail={consoleEmail} initialEmail={emailParam.slice(0, 320)} />
    </div>
  );
}
