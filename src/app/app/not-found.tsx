import Link from 'next/link';
import { FolderSearch } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The `notFound()` boundary for everything under `/app`.
 *
 * This file has to exist, and its absence was a real dead end rather than a
 * cosmetic gap. `src/app/app/loading.tsx` puts every page in this segment behind
 * a Suspense boundary, so the shell is streamed before a page body runs. When a
 * page then called `notFound()` — the workspace does it for a project you cannot
 * reach, `/app/mcp/[serverId]` for an unknown server — there was no `not-found`
 * boundary inside the segment to swap in, and the nearest one lived outside the
 * `/app` layout. The stream never resolved: the user sat on "Loading Karo" with
 * three skeletons, forever, with nothing in the console.
 *
 * Rendering inside the app shell is deliberate. The sidebar, the team switcher
 * and the command palette stay usable, so a mistyped or stale link is a
 * two-second recovery instead of a trip back through the marketing site.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col justify-center px-4 py-16 sm:px-6">
      <EmptyState
        icon={FolderSearch}
        title="This does not exist, or is not yours"
        description="The project, conversation or server behind this link is gone, was renamed, or belongs to a team you are not a member of. Karo deliberately does not distinguish between those cases — telling you which one applied would confirm that someone else's resource exists."
        action={
          <div className="flex flex-col items-center gap-2 sm:flex-row">
            <Button asChild variant="primary" size="sm">
              <Link href="/app/projects">Your projects</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app">Back to Overview</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
