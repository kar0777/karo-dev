import { Card, CardContent } from '@/components/ui/card';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

/** Shared loading shell for the extensions pages. Matches their real layout. */
export function ExtensionsPageSkeleton({
  rows = 5,
  variant = 'table',
}: {
  rows?: number;
  variant?: 'table' | 'grid';
}) {
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="space-y-2 border-b border-line pb-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-5 w-56" />
        <SkeletonText lines={2} className="max-w-2xl" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8 w-full max-w-sm" />
          <Skeleton className="h-8 w-32" />
        </CardContent>
      </Card>

      {variant === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: rows }).map((_, index) => (
            <Card key={index}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-8 rounded-md" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <SkeletonText lines={2} />
                <Skeleton className="h-7 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            {Array.from({ length: rows }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="h-4 grow" />
                <Skeleton className="hidden h-4 w-20 sm:block" />
                <Skeleton className="hidden h-4 w-24 md:block" />
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
