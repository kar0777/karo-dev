'use client';

import { Download } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { USAGE_RANGE_OPTIONS, type UsageRangeKey } from '@/components/usage/period';

/**
 * Period + project filter. Both live in the URL rather than component state:
 * a usage view is worth linking to, and it keeps the page a Server Component
 * that re-queries with the right window instead of over-fetching everything.
 */

export interface UsageControlsProps {
  range: UsageRangeKey;
  projectId: string | null;
  projects: ReadonlyArray<{ id: string; name: string }>;
}

const ALL_PROJECTS = '__all__';

export function UsageControls({ range, projectId, projects }: UsageControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  const push = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      // Any filter change invalidates the table cursor.
      next.delete('page');
      const query = next.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const exportParams = new URLSearchParams({ format: 'csv', range });
  if (projectId) exportParams.set('projectId', projectId);

  return (
    <div
      className="flex flex-wrap items-end gap-3 transition-opacity duration-150 aria-busy:opacity-60"
      aria-busy={pending || undefined}
    >
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="usage-range"
          className="text-[11px] tracking-wide text-subtle uppercase"
        >
          Period
        </Label>
        <SegmentedControl
          id="usage-range"
          aria-label="Reporting period"
          size="sm"
          options={USAGE_RANGE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
            title: option.title,
          }))}
          value={range}
          onValueChange={(value) => push({ range: value })}
        />
      </div>

      <div className="flex min-w-44 flex-col gap-1.5">
        <Label
          htmlFor="usage-project"
          className="text-[11px] tracking-wide text-subtle uppercase"
        >
          Project
        </Label>
        <Select
          value={projectId ?? ALL_PROJECTS}
          onValueChange={(value) => push({ projectId: value === ALL_PROJECTS ? null : value })}
        >
          <SelectTrigger id="usage-project" size="sm" aria-label="Filter by project">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button asChild variant="outline" size="sm">
        <a
          href={`/api/usage/export?${exportParams.toString()}`}
          download
          aria-label="Export this usage view as CSV"
        >
          <Download aria-hidden="true" />
          Export CSV
        </a>
      </Button>
    </div>
  );
}
