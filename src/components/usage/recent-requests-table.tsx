import { ChevronLeft, ChevronRight, Receipt } from 'lucide-react';
import Link from 'next/link';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RecentRequest } from '@/lib/usage/analytics';
import { cn, formatDuration, formatMicroUsd, formatNumber } from '@/lib/utils';

/**
 * Request-level detail. Pagination is link-based so the whole table stays a
 * Server Component — the rows are already on the server, and a client cursor
 * would only add a second way to be out of date.
 */

export interface RecentRequestsTableProps {
  rows: readonly RecentRequest[];
  total: number;
  page: number;
  pageSize: number;
  /** Current query string without `page`, e.g. `range=30&projectId=prj_x`. */
  baseQuery: string;
}

const SETTLEMENT_LABEL: Record<string, string> = {
  quota: 'Plan',
  payg: 'Balance',
  overage: 'Overage',
  mixed: 'Plan + overage',
  byok: 'Your key',
};

function settlementVariant(settlement: string): BadgeProps['variant'] {
  switch (settlement) {
    case 'quota':
      return 'primary';
    case 'byok':
      return 'outline';
    case 'overage':
    case 'mixed':
      return 'ember';
    default:
      return 'neutral';
  }
}

function statusVariant(status: string): BadgeProps['variant'] {
  if (status === 'success') return 'success';
  if (status === 'cancelled') return 'neutral';
  return 'danger';
}

function timeLabel(iso: string): { time: string; date: string } {
  const date = new Date(iso);
  return {
    time: new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date),
    date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date),
  };
}

export function RecentRequestsTable({
  rows,
  total,
  page,
  pageSize,
  baseQuery,
}: RecentRequestsTableProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pageCount);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  const hrefFor = (target: number) => {
    const params = new URLSearchParams(baseQuery);
    if (target <= 1) params.delete('page');
    else params.set('page', String(target));
    const query = params.toString();
    return query ? `/app/usage?${query}#recent-requests` : '/app/usage#recent-requests';
  };

  return (
    <section
      id="recent-requests"
      aria-labelledby="recent-requests-title"
      className="scroll-mt-20 rounded-lg border border-line bg-surface shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2
            id="recent-requests-title"
            className="text-sm leading-tight font-semibold text-fg"
          >
            Recent requests
          </h2>
          <p className="mt-1 text-[12px] text-muted">
            Every metered call, newest first. Failed calls are recorded but never charged.
          </p>
        </div>
        {total > 0 ? (
          <p className="karo-numeric shrink-0 text-[11px] text-subtle">
            {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
          </p>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <EmptyState
          size="sm"
          icon={Receipt}
          title="No usage yet"
          description="Start a run and it will appear here within a few seconds."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Cached</TableHead>
                <TableHead className="text-right">Weighted</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const stamp = timeLabel(row.occurredAt);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      <span className="karo-numeric block text-fg">{stamp.time}</span>
                      <span className="karo-numeric block text-[11px] text-subtle">
                        {stamp.date}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-40">
                      {row.projectId && row.projectName ? (
                        <Link
                          href={`/app/projects/${row.projectId}`}
                          className="block truncate rounded-sm text-fg transition-colors duration-150 hover:text-primary"
                        >
                          {row.projectName}
                        </Link>
                      ) : (
                        <span className="text-subtle">No project</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-44">
                      <span className="block truncate text-fg">{row.modelName}</span>
                      {row.usedByok ? (
                        <span className="text-[11px] text-subtle">Own API key</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      {formatNumber(row.inputTokens)}
                    </TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      {formatNumber(row.outputTokens)}
                    </TableCell>
                    <TableCell className="karo-numeric text-right text-subtle">
                      {row.cachedInputTokens > 0 ? formatNumber(row.cachedInputTokens) : '—'}
                    </TableCell>
                    <TableCell className="karo-numeric text-right font-medium text-fg">
                      {formatNumber(row.weightedTokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          'karo-numeric font-medium',
                          row.chargedMicroUsd > 0 ? 'text-ember' : 'text-subtle',
                        )}
                      >
                        {formatMicroUsd(row.chargedMicroUsd, { precise: true })}
                      </span>
                      <span className="mt-0.5 block">
                        <Badge variant={settlementVariant(row.settlement)} size="sm">
                          {SETTLEMENT_LABEL[row.settlement] ?? row.settlement}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="karo-numeric text-right text-muted">
                      {row.latencyMs > 0 ? formatDuration(row.latencyMs) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)} size="sm">
                        {row.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {pageCount > 1 ? (
            <nav
              aria-label="Recent requests pages"
              className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5"
            >
              <p className="karo-numeric text-[11px] text-subtle">
                Page {current} of {pageCount}
              </p>
              <div className="flex items-center gap-1.5">
                {current > 1 ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={hrefFor(current - 1)} rel="prev">
                      <ChevronLeft aria-hidden="true" />
                      Previous
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled>
                    <ChevronLeft aria-hidden="true" />
                    Previous
                  </Button>
                )}
                {current < pageCount ? (
                  <Button asChild variant="secondary" size="sm">
                    <Link href={hrefFor(current + 1)} rel="next">
                      Next
                      <ChevronRight aria-hidden="true" />
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled>
                    Next
                    <ChevronRight aria-hidden="true" />
                  </Button>
                )}
              </div>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
