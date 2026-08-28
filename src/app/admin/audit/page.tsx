import { ChevronLeft, ChevronRight, Download, ScrollText, Search } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';

import { AdminPanel, SeverityBadge } from '@/components/admin/primitives';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, inputVariants } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { auditActionLabel } from '@/lib/audit';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { cn, formatCompactNumber, formatDateTime, formatNumber, pluralize } from '@/lib/utils';

import {
  AUDIT_EXPORT_LIMIT,
  AUDIT_PAGE_SIZE,
  auditActions,
  auditTeams,
  loadAuditLog,
} from '../_data/audit';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Audit log',
  description: 'Every privileged action on the platform, searchable and exportable as CSV.',
};

/* ------------------------------------------------------------------ *
 *  Filters
 * ------------------------------------------------------------------ */

/**
 * The filter set, in the URL. It carries exactly the fields `AuditQuery`
 * accepts, under the same names, so a link to a view is also the query string
 * the CSV route parses — an operator can hand either to a colleague.
 */
type AuditFilters = {
  q: string;
  action: string;
  severity: string;
  teamId: string;
  userId: string;
  from: string;
  to: string;
};

/**
 * Mirrors the `.limit(200)` inside `auditTeams()`. The tile caption has to say so
 * when the cap is reached, because the list is ordered by name — not by recency —
 * so the missing teams are the tail of the alphabet, not old ones.
 */
const AUDIT_TEAM_OPTION_CAP = 200;

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'Any severity' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'notice', label: 'Notice' },
  { value: 'info', label: 'Info' },
] as const;

/**
 * An event whose `userId` is null but whose actor type is `user` was written by
 * somebody whose account has since been deleted — the column is `set null` on
 * delete, deliberately, so removing an account cannot erase its trail.
 */
const ACTOR_LABEL: Record<string, string> = {
  user: 'Deleted account',
  system: 'System',
  agent: 'Agent',
  worker: 'Worker',
  webhook: 'Webhook',
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Only the filters that are actually set, so clean views keep clean URLs. */
function filterParams(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.action) params.set('action', filters.action);
  if (filters.severity !== 'all') params.set('severity', filters.severity);
  if (filters.teamId) params.set('teamId', filters.teamId);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params;
}

function pageHref(filters: AuditFilters, page: number): string {
  const params = filterParams(filters);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/admin/audit?${query}` : '/admin/audit';
}

function exportHref(filters: AuditFilters): string {
  const query = filterParams(filters).toString();
  return query ? `/api/admin/audit/export?${query}` : '/api/admin/audit/export';
}

/**
 * A native `<select>` rather than the kit's Radix `Select`: the whole filter bar
 * is one GET form inside a Server Component, so every control has to submit
 * without a client boundary. It borrows `Input`'s own recipe rather than
 * restating it, so the field ring, hover border and disabled treatment can never
 * drift from the text inputs sitting beside it. The narrower padding is the one
 * deliberate difference — a select also has to fit its own arrow.
 */
const SELECT_CLASS = cn(inputVariants({ inputSize: 'md' }), 'px-2');

function FilterField({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[10px] font-medium tracking-wide text-subtle uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Page
 * ------------------------------------------------------------------ */

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout already guards `/admin`, but this page renders IP addresses and
  // whole request payloads, so it re-asserts rather than inheriting the check.
  // `getSession()` is memoised per request, so the second call costs nothing.
  await requirePlatformAdmin();
  const params = await searchParams;

  const filters: AuditFilters = {
    q: firstParam(params.q) ?? '',
    action: firstParam(params.action) ?? '',
    severity: firstParam(params.severity) ?? 'all',
    teamId: firstParam(params.teamId) ?? '',
    userId: firstParam(params.userId) ?? '',
    from: firstParam(params.from) ?? '',
    to: firstParam(params.to) ?? '',
  };
  const page = Math.max(1, Number.parseInt(firstParam(params.page) ?? '1', 10) || 1);
  const hasFilters = filterParams(filters).toString() !== '';

  const [log, actions, teams] = await Promise.all([
    loadAuditLog({ ...filters, page }),
    auditActions(),
    auditTeams(),
  ]);

  const firstRow = (page - 1) * AUDIT_PAGE_SIZE + 1;
  const lastRow = firstRow + log.rows.length - 1;
  const truncatedExport = log.total > AUDIT_EXPORT_LIMIT;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Audit log"
        description="Every privileged action on the platform, written by the server that performed it. Nothing in this console edits or removes an event; the one way an event leaves the log is with the team it belongs to, which deletes its events along with it."
        actions={
          <Button asChild variant="outline" size="sm">
            <a
              href={exportHref(filters)}
              download
              aria-label="Export the filtered audit log as CSV"
            >
              <Download aria-hidden="true" />
              Export CSV
            </a>
          </Button>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Matching events"
          value={formatCompactNumber(log.total)}
          tone={hasFilters ? 'primary' : 'default'}
          caption={
            hasFilters ? 'Events matching the filters below' : 'Every event ever recorded'
          }
        />
        <Stat
          label="Action keys"
          value={formatNumber(actions.length)}
          caption="Distinct actions present in the whole log"
        />
        <Stat
          label="Teams involved"
          value={formatNumber(teams.length)}
          caption={
            teams.length >= AUDIT_TEAM_OPTION_CAP
              ? `Teams with at least one event — the filter lists the first ${AUDIT_TEAM_OPTION_CAP} by name`
              : 'Teams with at least one event in the whole log'
          }
        />
        <Stat
          label="Export ceiling"
          value={formatCompactNumber(AUDIT_EXPORT_LIMIT)}
          tone={truncatedExport ? 'ember' : 'default'}
          caption={
            truncatedExport
              ? `The CSV stops after the newest ${formatNumber(AUDIT_EXPORT_LIMIT)} of ${formatNumber(log.total)} matches`
              : 'Rows per CSV — every current match fits in one file'
          }
        />
      </StatGrid>

      <AdminPanel
        title="Events"
        description="Newest first. Every payload is redacted before it is written: a field named like a credential, or a value shaped like one, is stored as [redacted]. Nothing on this page is a live secret."
        actions={
          log.rows.length > 0 ? (
            <p className="karo-numeric shrink-0 text-[11px] text-subtle">
              {formatNumber(firstRow)}–{formatNumber(lastRow)} of {formatNumber(log.total)}
            </p>
          ) : null
        }
      >
        <form method="get" action="/admin/audit" className="border-b border-line px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label="Free text" htmlFor="audit-q" className="lg:col-span-2">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle"
                  aria-hidden="true"
                />
                <Input
                  id="audit-q"
                  name="q"
                  defaultValue={filters.q}
                  // The export route's schema caps this at 200 and the actor id
                  // at 80. Capping the fields too keeps the "Export CSV" link
                  // from being a 400 for a filter the page itself accepted.
                  maxLength={200}
                  placeholder="Summary, action key or resource id"
                  className="pl-8"
                />
              </div>
            </FilterField>

            <FilterField label="Action" htmlFor="audit-action">
              <select
                id="audit-action"
                name="action"
                defaultValue={filters.action}
                className={SELECT_CLASS}
              >
                <option value="">Any action</option>
                {actions.map((action) => (
                  <option key={action} value={action}>
                    {auditActionLabel(action)} — {action}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Severity" htmlFor="audit-severity">
              <select
                id="audit-severity"
                name="severity"
                defaultValue={filters.severity}
                className={SELECT_CLASS}
              >
                {SEVERITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Team" htmlFor="audit-team">
              <select
                id="audit-team"
                name="teamId"
                defaultValue={filters.teamId}
                className={SELECT_CLASS}
              >
                <option value="">Any team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Actor id" htmlFor="audit-user">
              <Input
                id="audit-user"
                name="userId"
                defaultValue={filters.userId}
                maxLength={80}
                mono
                placeholder="usr_…"
              />
            </FilterField>

            <FilterField label="From (UTC)" htmlFor="audit-from">
              <Input id="audit-from" name="from" type="date" defaultValue={filters.from} />
            </FilterField>

            <FilterField label="To (UTC)" htmlFor="audit-to">
              <Input id="audit-to" name="to" type="date" defaultValue={filters.to} />
            </FilterField>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-xl text-[11px] leading-snug text-muted">
              Free text matches the summary, the action key and the resource id — not names,
              emails or metadata. Both dates are inclusive and read as UTC days. An actor id is
              matched exactly, and no page in this console prints one, so the field only helps
              when you already have the id in hand.
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {hasFilters ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/admin/audit">Reset</Link>
                </Button>
              ) : null}
              <Button type="submit" variant="secondary" size="sm">
                Apply filters
              </Button>
            </div>
          </div>
        </form>

        {log.rows.length === 0 ? (
          log.total > 0 ? (
            <EmptyState
              size="sm"
              icon={ScrollText}
              title={`Page ${page} is past the end of this view`}
              description={`This view holds ${formatNumber(log.total)} ${pluralize(log.total, 'event')} across ${formatNumber(log.pageCount)} ${pluralize(log.pageCount, 'page')}, at ${AUDIT_PAGE_SIZE} rows per page.`}
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, log.pageCount)}>
                    Go to page {log.pageCount}
                  </Link>
                </Button>
              }
            />
          ) : hasFilters ? (
            <EmptyState
              size="sm"
              icon={Search}
              title="No events match these filters"
              description="Widen the date range or drop the action filter. Free text only matches the summary, the action key and the resource id — it does not search inside metadata."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href="/admin/audit">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              size="sm"
              icon={ScrollText}
              title="Nothing has been recorded yet"
              description="Karo writes an event whenever somebody signs in, changes a plan, runs a command in a sandbox or rotates an API key. The first one will appear here, newest at the top."
            />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="hidden sm:table-cell">Actor</TableHead>
                <TableHead className="hidden lg:table-cell">Team</TableHead>
                <TableHead className="hidden xl:table-cell">Resource</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="hidden xl:table-cell">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {log.rows.map((row) => {
                const metadataKeys = row.metadata ? Object.keys(row.metadata) : [];
                return (
                  <TableRow key={row.id}>
                    <TableCell className="karo-numeric align-top whitespace-nowrap text-muted">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="align-top">
                      <SeverityBadge severity={row.severity} />
                    </TableCell>
                    <TableCell className="max-w-[13rem] align-top">
                      <span className="block truncate font-medium text-fg">
                        {row.actionLabel}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-subtle">
                        {row.action}
                      </span>
                    </TableCell>
                    <TableCell className="hidden max-w-[14rem] align-top sm:table-cell">
                      {row.userEmail ? (
                        <>
                          <span className="block truncate text-fg">
                            {row.userName || row.userEmail}
                          </span>
                          <span className="block truncate text-[11px] text-subtle">
                            {row.actorType === 'user' ? '' : `${row.actorType} · `}
                            {row.userEmail}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">
                          {ACTOR_LABEL[row.actorType] ?? row.actorType}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-[10rem] truncate align-top text-muted lg:table-cell">
                      {row.teamName ?? '—'}
                    </TableCell>
                    <TableCell className="hidden max-w-[12rem] align-top xl:table-cell">
                      {row.resourceType || row.resourceId ? (
                        <>
                          <span className="block truncate text-muted">
                            {row.resourceType || 'unspecified'}
                          </span>
                          {row.resourceId ? (
                            <span className="block truncate font-mono text-[11px] text-subtle">
                              {row.resourceId}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[26rem] min-w-[14rem] align-top">
                      <span className="block text-fg">{row.summary}</span>
                      {metadataKeys.length > 0 ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-subtle hover:text-fg">
                            {metadataKeys.length}{' '}
                            {pluralize(metadataKeys.length, 'metadata field')}
                          </summary>
                          <pre className="mt-1 max-h-52 overflow-auto rounded-md border border-line bg-bg-inset p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
                            {JSON.stringify(row.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className="karo-numeric hidden align-top font-mono text-[11px] text-subtle xl:table-cell"
                      title={row.userAgent ?? undefined}
                    >
                      {row.ipAddress ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {log.pageCount > 1 ? (
          <nav
            aria-label="Audit log pages"
            className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5"
          >
            <p className="karo-numeric text-[11px] text-subtle">
              Page {formatNumber(page)} of {formatNumber(log.pageCount)} · {AUDIT_PAGE_SIZE}{' '}
              rows per page
            </p>
            <div className="flex items-center gap-1.5">
              {page > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, page - 1)} rel="prev">
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
              {page < log.pageCount ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, page + 1)} rel="next">
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
      </AdminPanel>

      <p className="text-[11px] leading-relaxed text-subtle">
        Timestamps are rendered in the server's timezone; the CSV carries them as UTC ISO
        strings. The export applies the filters above and stops at the newest{' '}
        {formatNumber(AUDIT_EXPORT_LIMIT)} rows, so narrow the date range before exporting a
        busy period. Exporting is itself a privileged action and is recorded in this log.
      </p>
    </div>
  );
}
