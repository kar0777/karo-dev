'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { SegmentedControl } from '@/components/ui/segmented';

/**
 * The window every analytics page is scoped to. It lives in the URL rather
 * than in component state so a link to a spike is a link to the same spike.
 */
export function PeriodPicker({
  value,
  options = [7, 14, 30, 90],
}: {
  value: number;
  options?: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  return (
    <SegmentedControl
      size="sm"
      aria-label="Reporting period"
      disabled={pending}
      value={String(value)}
      options={options.map((days) => ({ value: String(days), label: `${days}d` }))}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams?.toString() ?? '');
        params.set('days', next);
        startTransition(() => {
          router.push(`${pathname}?${params.toString()}`, { scroll: false });
        });
      }}
    />
  );
}
