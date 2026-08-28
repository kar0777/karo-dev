'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { MailWarning } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';

/**
 * The UI half of `auth.requireEmailVerification`.
 *
 * The server decides *whether* this user is blocked — the app layout only
 * mounts the gate when the setting is on and the address is unconfirmed. This
 * component decides *where*: `usePathname` is exact, which the layout's
 * best-effort `currentPath()` header sniffing is not, and it re-evaluates
 * during client-side navigation without another round trip.
 *
 * Blocked routes get a card rather than a redirect. Redirecting to
 * `/verify-email` would take the sidebar with it, and the sidebar is how the
 * user reaches sign-out and the settings page where a mistyped address gets
 * corrected — the two things a blocked account most needs. On the routes that
 * stay open the same state is a banner, so the reason the rest of the app is
 * unavailable is never hidden.
 */

/**
 * Page routes that stay usable while blocked. Kept in step with the escape
 * hatches enumerated on `isBlockedByEmailVerification` — this is the page half
 * of the `/api/settings/` and `/api/billing/controls` prefixes `defineHandler`
 * leaves open.
 *
 * Billing is here because automatic top-up keeps charging a blocked account's
 * card from a scheduler the gate cannot see, and this page holds the switch
 * that stops it. Everything else on it — buying credit, changing plan, the
 * provider portal — is still refused by the API, which is the right way round:
 * a blocked account may stop money leaving, not start it.
 */
const OPEN_PREFIXES = ['/app/settings', '/app/billing'] as const;

export type EmailVerificationGateProps = {
  /** The address awaiting confirmation. Shown so a typo is obvious. */
  email: string;
  children: React.ReactNode;
};

export function EmailVerificationGate({ email, children }: EmailVerificationGateProps) {
  const pathname = usePathname() ?? '/app';
  const { resend, sending } = useResendVerification(email);

  const openRoute = OPEN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (openRoute) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-warning-soft px-4 py-2">
          <p className="flex items-center gap-2 text-[12.5px] text-warning-soft-fg">
            <MailWarning className="size-4 shrink-0" aria-hidden="true" />
            {email} is not confirmed yet, so the rest of Karo is closed until it is.
          </p>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => void resend()}
            loading={sending}
          >
            Send a new link
          </Button>
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="px-4 py-10">
      <EmptyState
        icon={MailWarning}
        title="Confirm your email to continue"
        description={`This Karo install requires a confirmed address before you can create or change anything. The link went to ${email} — open it and this screen goes away.`}
        action={
          <Button type="button" onClick={() => void resend()} loading={sending}>
            Send a new link
          </Button>
        }
        secondaryAction={
          <Button asChild variant="secondary">
            <Link href="/verify-email">Open the confirmation page</Link>
          </Button>
        }
      >
        <p className="max-w-sm text-[12px] leading-relaxed text-muted">
          Wrong address?{' '}
          <Link href="/app/settings" className="rounded-sm text-primary hover:underline">
            Change it in your settings
          </Link>{' '}
          — saving a new one sends the link there instead. Sign-out stays in the sidebar.
        </p>
      </EmptyState>
    </div>
  );
}

function useResendVerification(email: string): {
  resend: () => Promise<void>;
  sending: boolean;
} {
  const router = useRouter();
  const [sending, setSending] = React.useState(false);

  const resend = React.useCallback(async () => {
    setSending(true);
    try {
      const result = await apiFetch<{ alreadyVerified: boolean }>(
        '/api/auth/verify-email/resend',
        { method: 'POST' },
      );

      if (result?.alreadyVerified) {
        // Confirmed in another tab while this one sat here. The gate is decided
        // on the server, so only a refresh takes it back down.
        toast.success('Already confirmed', {
          description: 'Reloading so the rest of the app comes back.',
        });
        router.refresh();
        return;
      }

      toast.success(`New link sent to ${email}`, {
        description: 'It is valid for 24 hours and replaces any earlier link.',
      });
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setSending(false);
    }
  }, [email, router]);

  return { resend, sending };
}
