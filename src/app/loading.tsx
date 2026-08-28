import { KaroMark } from '@/components/brand/logo';
import { Spinner } from '@/components/ui/spinner';

/**
 * Root-level suspense fallback. Deliberately quiet — it appears for the
 * few hundred milliseconds between a navigation and the first server
 * payload, so it must not flash layout. Route segments that know their
 * shape render a skeleton instead of falling back to this.
 */
export default function Loading() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4"
      role="status"
      aria-live="polite"
    >
      <div className="animate-fade-in flex flex-col items-center gap-3">
        <KaroMark size={36} className="text-line-strong" />
        <Spinner size="sm" className="text-subtle" />
      </div>
      <span className="sr-only">Loading Karo</span>
    </div>
  );
}
