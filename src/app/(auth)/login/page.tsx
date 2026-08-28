import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CircleCheck, MailCheck, ShieldAlert } from 'lucide-react';

import { AuthHeading } from '@/components/auth/auth-heading';
import { configuredOAuthProviders } from '@/lib/auth/oauth';
import { LoginForm } from '@/components/auth/login-form';
import { firstParam, safeNextPath } from '@/components/auth/next-path';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isSignupEnabled } from '@/lib/auth/service';
import { getSession } from '@/lib/auth/session';
import { publicConfig } from '@/lib/env';
import { buildMetadata } from '@/lib/metadata';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  title: 'Sign in',
  description:
    'Sign in to Karo — a cloud workspace where your AI coding agent has a real computer.',
  path: '/login',
  noIndex: true,
});

type SearchParams = Record<string, string | string[] | undefined>;

/** Notices the rest of the app hands over through the query string. */
const NOTICES = {
  account_suspended: {
    variant: 'danger' as const,
    icon: ShieldAlert,
    title: 'This account is suspended',
    body: 'A platform administrator suspended it. Your projects and data are untouched — contact support to have access restored.',
  },
  reset: {
    variant: 'success' as const,
    icon: CircleCheck,
    title: 'Password updated',
    body: 'Every device was signed out. Sign in with the new password to continue.',
  },
  verified: {
    variant: 'success' as const,
    icon: MailCheck,
    title: 'Email confirmed',
    body: 'Your address is confirmed. Sign in to pick up where you left off.',
  },
  signed_out: {
    variant: 'info' as const,
    icon: CircleCheck,
    title: 'Signed out',
    body: 'This session was ended on this device. Everything you were working on is saved.',
  },
  oauth_not_configured: {
    variant: 'info' as const,
    icon: ShieldAlert,
    title: 'OAuth is not enabled here',
    body: 'This deployment has no credentials for that sign-in provider. Use email and password, or ask the operator to configure it.',
  },
  oauth_denied: {
    variant: 'danger' as const,
    icon: ShieldAlert,
    title: 'Sign-in was cancelled',
    body: 'The sign-in was cancelled at the provider. Try again when ready.',
  },
  oauth_state: {
    variant: 'danger' as const,
    icon: ShieldAlert,
    title: 'Sign-in flow expired',
    body: 'The sign-in took too long or was started somewhere else. Start again — it only takes a moment.',
  },
  oauth_failed: {
    variant: 'danger' as const,
    icon: ShieldAlert,
    title: 'Sign-in failed',
    body: 'The provider did not complete the sign-in. Try again, or use email and password.',
  },
} as const;

function resolveNotice(params: SearchParams): (typeof NOTICES)[keyof typeof NOTICES] | null {
  if (firstParam(params.error) === 'account_suspended') return NOTICES.account_suspended;
  if (firstParam(params.reset) === '1') return NOTICES.reset;
  if (firstParam(params.verified) === '1') return NOTICES.verified;
  if (firstParam(params['signed-out']) === '1') return NOTICES.signed_out;
  const oauthError = firstParam(params.error);
  if (
    oauthError === 'oauth_not_configured' ||
    oauthError === 'oauth_denied' ||
    oauthError === 'oauth_state' ||
    oauthError === 'oauth_failed'
  ) {
    return NOTICES[oauthError];
  }
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));

  // Already signed in and not being told the account is suspended? There is
  // nothing to do on this screen.
  const active = await getSession();
  if (active && !active.user.isSuspended && firstParam(params.error) !== 'account_suspended') {
    redirect(next);
  }

  const config = publicConfig();
  // Both gates have to agree, or the button would 403 the moment it is pressed:
  // the environment allows demo sign-in at all, and an admin has left it on.
  const demoEnabled =
    config.allowDemoLogin &&
    (await getSetting(
      SETTING_KEYS.authDemoLoginEnabled,
      settingDefault(SETTING_KEYS.authDemoLoginEnabled),
    ));

  const signupEnabled = await isSignupEnabled();
  const notice = resolveNotice(params);
  const autoFocusDemo = demoEnabled && firstParam(params.demo) === '1';

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Sign in to Karo"
        description="Pick up your projects, sandboxes and running agents where you left them."
      />

      {notice ? (
        <Alert variant={notice.variant} icon={notice.icon}>
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>
            <p>{notice.body}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <LoginForm
        next={next}
        demoEnabled={demoEnabled}
        autoFocusDemo={autoFocusDemo}
        signupEnabled={signupEnabled}
        oauthProviders={configuredOAuthProviders()}
      />
    </div>
  );
}
