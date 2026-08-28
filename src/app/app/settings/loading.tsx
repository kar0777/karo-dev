import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

export default function SettingsLoading() {
  return (
    <div className="space-y-5 p-4 sm:p-6" aria-busy="true" aria-label="Loading settings">
      <div className="border-b border-line pb-3">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="mt-2 h-3.5 w-80 max-w-full" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)]">
        <div className="flex gap-1 lg:flex-col">
          {Array.from({ length: 7 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-24 shrink-0 lg:w-full" />
          ))}
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-2 h-3 w-72 max-w-full" />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-full" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-full" />
              </div>
            </div>
            <SkeletonText lines={3} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
