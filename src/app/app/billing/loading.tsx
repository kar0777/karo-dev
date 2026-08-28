import { Skeleton } from '@/components/ui/skeleton';

export default function BillingLoading() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading billing…</span>

      <div className="border-b border-line pb-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="mt-2 h-3.5 w-full max-w-md" />
      </div>

      <div className="rounded-lg border border-line bg-surface shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="w-full max-w-sm">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="mt-2 h-6 w-40" />
            <Skeleton className="mt-2 h-3 w-full" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="bg-surface px-4 py-3">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mt-2 h-3.5 w-28" />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-24 rounded-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-2 h-3 w-full max-w-xs" />
            <Skeleton className="mt-4 h-8 w-32" />
            <div className="mt-4 flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, row) => (
                <Skeleton key={row} className="h-7 w-full rounded-sm" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
        <Skeleton className="h-3.5 w-16" />
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-44 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
