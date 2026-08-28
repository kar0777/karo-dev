import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function ApiKeysLoading() {
  return (
    <div className="space-y-5 p-4 sm:p-6" aria-busy="true" aria-label="Loading API keys">
      <div className="border-b border-line pb-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-2 h-3.5 w-96 max-w-full" />
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-3 w-80 max-w-full" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
