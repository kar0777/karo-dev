import { Skeleton } from '@/components/ui/skeleton';

/**
 * Auth screens are dynamic — they read admin settings and the current session —
 * so there is a real, if short, wait. The skeleton mirrors the heading and the
 * two-field form so the layout does not jump when the page arrives.
 */
export default function AuthLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="space-y-2">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-full max-w-xs" />
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-10 w-full" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="mx-auto h-3.5 w-52" />
      </div>
    </div>
  );
}
