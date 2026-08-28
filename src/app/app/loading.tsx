import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

/**
 * Overview skeleton. The shapes mirror the real page exactly, so the layout
 * does not jump when the data lands.
 */
export default function OverviewLoading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your workspace overview
      </span>

      <div className="border-b border-line pb-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="mt-2 h-3 w-80 max-w-full" />
      </div>

      <div className="mt-5 space-y-5">
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2 bg-surface p-4">
              <Skeleton className="h-2.5 w-24 rounded-sm" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-2.5 w-4/5 rounded-sm" />
            </div>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface xl:col-span-2">
            <div className="border-b border-line px-4 py-3">
              <Skeleton className="h-3.5 w-44" />
            </div>
            <div className="grid gap-1.5 p-2 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="rounded-md border border-line p-3">
                  <Skeleton className="h-3 w-1/2" />
                  <SkeletonText lines={2} className="mt-2" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line px-4 py-3">
              <Skeleton className="h-3.5 w-40" />
            </div>
            <div className="p-4">
              <Skeleton className="h-40 w-full rounded-md" />
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface xl:col-span-2">
            <div className="border-b border-line px-4 py-3">
              <Skeleton className="h-3.5 w-36" />
            </div>
            <ul className="divide-y divide-line">
              {Array.from({ length: 4 }, (_, index) => (
                <li key={index} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="size-2.5 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-2/5" />
                    <Skeleton className="h-2.5 w-1/3" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line px-4 py-3">
              <Skeleton className="h-3.5 w-28" />
            </div>
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-2.5 w-3/4" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
