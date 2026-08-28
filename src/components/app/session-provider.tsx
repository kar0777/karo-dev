'use client';

import * as React from 'react';

import { setCsrfToken } from '@/lib/client/api';
import type { PlatformRole, TeamRole } from '@/lib/db/schema';
import { can, type Permission } from '@/lib/rbac/permissions';

/**
 * Client-side session context.
 *
 * The server layout already knows who the user is, so this carries that down
 * rather than making the browser re-fetch it. It also parks the CSRF token in
 * the API client, which is why every authenticated page must be inside this
 * provider — a mutation outside it would be rejected.
 */

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  platformRole: PlatformRole;
  isDemo: boolean;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  locale: string;
};

export type SessionTeam = {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  planKey: string;
  planName: string;
  planTier: 'payg' | 'lite' | 'pro' | 'scale' | 'ultra';
};

export type SessionValue = {
  user: SessionUser;
  team: SessionTeam;
  role: TeamRole;
  csrfToken: string;
  demoMode: boolean;
  /** Which mock providers are standing in for real integrations. */
  simulated: { ai: boolean; sandbox: boolean; billing: boolean };
};

const SessionContext = React.createContext<SessionValue | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: SessionValue;
  children: React.ReactNode;
}) {
  // Set synchronously during render so a mutation fired from a child's first
  // effect already has the token — an effect here would run too late.
  setCsrfToken(value.csrfToken);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = React.useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used inside <SessionProvider>.');
  }
  return value;
}

/** Non-throwing variant for components shared with public pages. */
export function useOptionalSession(): SessionValue | null {
  return React.useContext(SessionContext);
}

/** Mirrors the server-side RBAC check so the UI hides what it cannot do. */
export function usePermission(permission: Permission): boolean {
  const { role } = useSession();
  return can(role, permission);
}
