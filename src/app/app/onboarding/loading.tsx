import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

export default function OnboardingLoading() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading setup
      </span>

      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="hidden space-y-2 lg:block">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex items-start gap-2.5 px-2 py-1.5">
              <Skeleton className="size-5 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-2.5 w-3/4 rounded-sm" />
                <Skeleton className="h-2 w-1/2 rounded-sm" />
              </div>
            </div>
          ))}
        </div>

        <div>
          <Skeleton className="h-5 w-72 max-w-full" />
          <SkeletonText lines={2} className="mt-2 max-w-xl" />
          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="rounded-lg border border-line bg-surface p-3.5">
                <Skeleton className="h-3 w-2/3 rounded-sm" />
                <SkeletonText lines={2} className="mt-2.5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
