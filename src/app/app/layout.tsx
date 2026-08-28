import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app/app-shell';
import { SessionProvider, type SessionValue } from '@/components/app/session-provider';
import { loadShellContext } from '@/components/app/shell-data';
import { ACTIVE_TEAM_COOKIE } from '@/components/app/team-switcher';
import { EmailVerificationGate } from '@/components/auth/email-verification-gate';
import { I18nProvider } from '@/components/i18n-provider';
import { getActiveTeam, isBlockedByEmailVerification, requireUser } from '@/lib/auth/guards';
import { getCsrfToken } from '@/lib/auth/session';
import { publicConfig } from '@/lib/env';
import { resolveLocale } from '@/lib/i18n-server';

export const dynamic = 'force-dynamic';

const ONBOARDING_PATH = '/app/onboarding';

/**
 * Best-effort current path.
 *
 * Layouts are not given the pathname, and Karo enforces auth in layouts rather
 * than middleware — so this reads whatever the runtime happens to expose. It
 * returns `null` when it genuinely cannot tell, and the caller must then *not*
 * redirect: guessing wrong here would bounce `/app/onboarding` to itself
 * forever. The pages that matter re-check the flag themselves, and the shell
 * shows a persistent "finish setup" banner, so nothing is lost when this
 * returns null.
 */
async function currentPath(): Promise<string | null> {
  try {
    const headerList = await headers();
    for (const name of ['x-karo-pathname', 'x-invoke-path', 'x-pathname', 'x-matched-path']) {
      const value = headerList.get(name);
      if (value?.startsWith('/')) return value;
    }
    const nextUrl = headerList.get('next-url');
    if (nextUrl?.startsWith('/')) return nextUrl;
  } catch {
    /* outside a request scope */
  }
  return null;
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, session } = await requireUser();

  const cookieStore = await cookies();
  const requestedTeamId = cookieStore.get(ACTIVE_TEAM_COOKIE)?.value ?? null;

  // A cookie naming a team you have since left must degrade to your default
  // workspace, not to an error page.
  const active = await getActiveTeam(user.id, requestedTeamId).catch(() =>
    getActiveTeam(user.id, null),
  );

  const onboardingComplete = user.onboardingCompletedAt !== null;
  const emailBlocked = await isBlockedByEmailVerification(user);

  // The gate below replaces onboarding with a blocking card, so bouncing an
  // unconfirmed account into it would leave them one redirect away from
  // `/app/settings` — the page that exists precisely so someone who mistyped
  // their own address can correct it. Onboarding waits until they are back.
  if (!onboardingComplete && !emailBlocked) {
    const path = await currentPath();
    if (path && !path.startsWith(ONBOARDING_PATH)) redirect(ONBOARDING_PATH);
  }

  const [context, csrfToken] = await Promise.all([
    loadShellContext(user.id, active.team.id),
    getCsrfToken(),
  ]);

  const config = publicConfig();

  // The user's saved choice wins; `Accept-Language` only decides for someone who
  // has never picked. This layout is already `force-dynamic`, so reading either
  // costs nothing extra here.
  const locale = await resolveLocale(user);

  const sessionValue: SessionValue = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      platformRole: user.platformRole,
      isDemo: user.isDemo,
      emailVerified: user.emailVerifiedAt !== null,
      onboardingCompleted: onboardingComplete,
      locale: user.locale,
    },
    team: {
      id: active.team.id,
      name: active.team.name,
      slug: active.team.slug,
      isPersonal: active.team.isPersonal,
      planKey: context.plan.key,
      planName: context.plan.name,
      planTier: context.plan.tier,
    },
    role: active.role,
    csrfToken: csrfToken ?? session.csrfToken,
    demoMode: config.demoMode,
    simulated: {
      ai: config.aiProvider === 'mock',
      sandbox: config.sandboxProvider === 'mock',
      billing: config.billingProvider === 'mock',
    },
  };

  return (
    <I18nProvider locale={locale}>
      <SessionProvider value={sessionValue}>
        <AppShell
          teams={context.teams}
          quota={context.quota}
          planName={context.plan.name}
          planTier={context.plan.tier}
          subscribed={context.plan.subscribed}
          projects={context.projects}
          notifications={context.notifications}
          unreadNotifications={context.unreadNotifications}
          platform={context.platform}
          onboardingComplete={onboardingComplete}
        >
          {/*
          The verification gate sits *inside* the shell rather than redirecting:
          the sidebar is what keeps sign-out and the settings page — where a
          mistyped address is fixed — one click away while everything else is
          blocked. The API refuses the matching writes regardless of what is
          rendered here; this half only stops a user walking into forms that
          cannot submit.
        */}
          {emailBlocked ? (
            <EmailVerificationGate email={user.email}>{children}</EmailVerificationGate>
          ) : (
            children
          )}
        </AppShell>
      </SessionProvider>
    </I18nProvider>
  );
}
