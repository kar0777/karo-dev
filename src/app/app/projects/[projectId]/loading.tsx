import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

/**
 * Workspace skeleton.
 *
 * Same geometry as the real thing — one viewport tall, three columns, a tab
 * strip on top and a status bar underneath — so nothing jumps when the data
 * lands. The `3rem` matches the authenticated shell's header above this route.
 */
export default function ProjectWorkspaceLoading() {
  return (
    <div
      aria-busy="true"
      className="flex min-h-0 flex-col overflow-hidden bg-bg"
      style={{ height: 'calc(100dvh - 3rem)' }}
    >
      <span className="sr-only" role="status">
        Opening the project workspace
      </span>

      {/* Tab strip */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 py-1.5">
        <Skeleton className="size-7 rounded-md" />
        {[56, 52, 64, 68, 56, 64].map((width, index) => (
          <Skeleton key={index} className="h-7 rounded-md" style={{ width }} />
        ))}
        <Skeleton className="ml-auto size-7 rounded-md" />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Explorer */}
        <div className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex xl:w-72">
          <div className="border-b border-line px-2 py-2">
            <Skeleton className="h-7 w-full rounded-md" />
          </div>
          <div className="border-b border-line px-2 py-2">
            <Skeleton className="h-7 w-full rounded-md" />
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 px-2 py-2">
            {[80, 62, 92, 70, 55, 84, 66, 74, 58, 88, 64, 72].map((width, index) => (
              <Skeleton
                key={index}
                className="h-3 rounded-sm"
                style={{ width: `${width}%`, marginLeft: index % 3 === 0 ? 0 : 12 }}
              />
            ))}
          </div>
          <div className="border-t border-line px-2 py-2">
            <Skeleton className="h-3 w-28 rounded-sm" />
          </div>
        </div>

        {/* Chat, the default pane */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-52" />
              <Skeleton className="h-2.5 w-36 rounded-sm" />
            </div>
            <Skeleton className="h-7 w-20 rounded-md" />
            <Skeleton className="h-7 w-16 rounded-md" />
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-hidden px-4 py-4">
            {[0, 1].map((row) => (
              <div key={row} className="mx-auto w-full max-w-3xl space-y-2">
                <Skeleton className="ml-auto h-8 w-2/5 rounded-lg" />
                <SkeletonText lines={4} />
              </div>
            ))}
          </div>

          <div className="shrink-0 border-t border-line px-3 py-3">
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        </div>

        {/* Agent, machine and cost */}
        <div className="hidden w-72 shrink-0 flex-col gap-px border-l border-line bg-surface lg:flex">
          {[0, 1, 2, 3].map((section) => (
            <div key={section} className="border-b border-line px-3 py-3">
              <Skeleton className="h-2.5 w-24 rounded-sm" />
              <div className="mt-2 space-y-2">
                <Skeleton className="h-7 w-full rounded-md" />
                <Skeleton className="h-1.5 w-full rounded-full" />
                <Skeleton className="h-2.5 w-4/5 rounded-sm" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-3 border-t border-line bg-surface px-3 py-1.5">
        <Skeleton className="h-2.5 w-20 rounded-sm" />
        <Skeleton className="h-2.5 w-28 rounded-sm" />
        <Skeleton className="h-2.5 w-40 rounded-sm" />
      </div>
    </div>
  );
}
