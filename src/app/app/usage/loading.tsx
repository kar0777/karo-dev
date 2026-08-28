import { Skeleton } from '@/components/ui/skeleton';

/** Mirrors the real layout so the page does not jump when data lands. */
export default function UsageLoading() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading usage analytics…</span>

      <div className="border-b border-line pb-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-2 h-3.5 w-full max-w-lg" />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Skeleton className="h-8 w-52 rounded-md" />
          <Skeleton className="h-8 w-44 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 bg-surface p-4">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-2.5 w-40" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <ChartPlaceholder key={index} />
        ))}
      </div>

      <ChartPlaceholder height={200} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <ChartPlaceholder key={index} />
        ))}
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <Skeleton className="h-3.5 w-36" />
        <div className="mt-3 flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-full rounded-sm" />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChartPlaceholder({ height = 220 }: { height?: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="mt-2 h-2.5 w-56" />
      </div>
      <div className="p-4">
        <div className="flex items-end gap-1.5" style={{ height }}>
          {Array.from({ length: 14 }, (_, index) => (
            <Skeleton
              key={index}
              className="flex-1 rounded-sm"
              style={{ height: `${28 + ((index * 41) % 62)}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
