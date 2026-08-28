import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

export default function ProjectsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6" aria-busy="true">
      <span className="sr-only" role="status">
        Loading projects
      </span>

      <div className="border-b border-line pb-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
      </div>

      <div className="mt-4 space-y-4">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <Skeleton className="h-8 flex-1 rounded-md" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-7 w-40 rounded-md" />
            <Skeleton className="h-7 w-44 rounded-md" />
            <Skeleton className="h-7 w-44 rounded-md" />
            <Skeleton className="h-7 w-16 rounded-md" />
            <Skeleton className="h-7 w-28 rounded-md" />
          </div>
        </div>

        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="rounded-lg border border-line bg-surface p-3.5">
              <div className="flex items-start gap-2">
                <Skeleton className="size-7 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/5 rounded-sm" />
                  <Skeleton className="h-2.5 w-1/3 rounded-sm" />
                </div>
              </div>
              <SkeletonText lines={2} className="mt-3" />
              <div className="mt-3 flex gap-1.5">
                <Skeleton className="h-5 w-16 rounded-md" />
                <Skeleton className="h-5 w-20 rounded-md" />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                <Skeleton className="h-2.5 w-24 rounded-sm" />
                <Skeleton className="h-2.5 w-16 rounded-sm" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
