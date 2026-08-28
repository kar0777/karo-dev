import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shared loading shape for admin routes. Matching the real layout's rhythm
 * means the page does not jump when data lands.
 */
export function AdminPageSkeleton({
  stats = 4,
  rows = 8,
  chart = false,
}: {
  stats?: number;
  rows?: number;
  chart?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading admin data</span>

      <div className="border-b border-line pb-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-3.5 w-72" />
      </div>

      {stats > 0 ? (
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: stats }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2 bg-surface p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ) : null}

      {chart ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="mt-4 h-56 w-full" />
        </div>
      ) : null}

      <div className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="divide-y divide-line">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-2.5">
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
