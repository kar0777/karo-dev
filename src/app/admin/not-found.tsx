import Link from 'next/link';
import { SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * The `notFound()` boundary for the admin console.
 *
 * Defensive rather than a fix for a live bug: no admin page calls `notFound()`
 * today. The hazard is structural, though — `src/app/admin/loading.tsx` wraps
 * this whole segment in a Suspense boundary, and without a `not-found` boundary
 * inside it the first `notFound()` anyone adds would hang on the loading
 * skeleton instead of rendering anything. That is exactly what happened under
 * `/app`. The next admin detail page should not have to rediscover it.
 */
export default function AdminNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col justify-center px-4 py-16 sm:px-6">
      <EmptyState
        icon={SearchX}
        title="No such record"
        description="Whatever this link pointed at is not in the database any more. If you followed it from an audit entry, the row it referred to has since been deleted — the audit trail keeps the reference on purpose, so the history stays readable."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin">Back to Overview</Link>
          </Button>
        }
      />
    </div>
  );
}
