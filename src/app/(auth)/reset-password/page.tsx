import type { Metadata } from 'next';

import { AuthHeading } from '@/components/auth/auth-heading';
import { firstParam } from '@/components/auth/next-path';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { buildMetadata } from '@/lib/metadata';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  title: 'Choose a new password',
  description: 'Set a new password for your Karo account.',
  path: '/reset-password',
  noIndex: true,
});

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = firstParam(params.token);
  // The token is only ever passed straight back to the API, which is what
  // validates it; length-capping here just keeps a junk URL out of the payload.
  const token = raw && raw.length <= 512 ? raw : null;

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Choose a new password"
        description="Pick something long. Length beats punctuation, and a passphrase you can actually remember beats both."
      />

      <ResetPasswordForm token={token} />
    </div>
  );
}
