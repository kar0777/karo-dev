'use client';

import Link from 'next/link';

import { Megaphone, Wrench } from 'lucide-react';

import { useSession } from '@/components/app/session-provider';
import type { ShellPlatformNotices } from '@/components/app/shell-data';
import { Button } from '@/components/ui/button';

/**
 * The two operator-controlled strips at the top of the app.
 *
 * Full-bleed rows rather than a toast or a badge, and neither is dismissible:
 * someone whose next click is about to be refused has to read the reason
 * *before* they click, and a message that can be dismissed is a message the
 * next person has not seen. They render from the shell's server data, so a
 * change reaches everyone on their next navigation with no extra request.
 *
 * The announcement is operator-authored text and is rendered as text — JSX
 * escapes it and nothing here goes near `dangerouslySetInnerHTML`. Reaching the
 * admin console is not a reason to be handed script injection into every page.
 */

export function PlatformNotices({ notices }: { notices: ShellPlatformNotices }) {
  const { user } = useSession();
  const isAdmin = user.platformRole === 'admin';

  return (
    <>
      {notices.maintenanceMode ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-warning-soft px-4 py-2"
        >
          <p className="flex items-center gap-2 text-[12.5px] text-warning-soft-fg">
            <Wrench className="size-4 shrink-0" aria-hidden="true" />
            {isAdmin
              ? 'Maintenance mode is on. You keep full access as a platform administrator; everyone else can read but not change anything.'
              : 'Maintenance mode is on. You can read everything as usual, but saving changes and starting new work will be refused until an administrator turns it off. Signing out still works.'}
          </p>
          {isAdmin ? (
            <Button asChild size="xs" variant="secondary">
              <Link href="/admin/settings">Platform settings</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {notices.announcement === '' ? null : (
        <div className="flex items-start gap-2 border-b border-line bg-surface-2 px-4 py-2">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
          <p className="text-[12.5px] leading-snug text-fg">{notices.announcement}</p>
        </div>
      )}
    </>
  );
}
