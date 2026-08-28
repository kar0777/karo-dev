import { and, asc, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { ExternalLink } from 'lucide-react';

import { IncidentsPanel, type AdminIncidentRow } from '@/components/admin/incidents-panel';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { incidents, type Incident } from '@/lib/db/schema';
import { getSetting } from '@/lib/settings';
import { formatCompactNumber, formatDuration } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Incidents',
  description: 'Open incidents, their severity and affected surface, and the resolved history.',
};

/**
 * Incidents.
 *
 * "Open" means exactly `status <> 'resolved'` — the same predicate the sidebar
 * badge (`src/app/admin/layout.tsx`) uses, with the same 50-row cap, so the
 * number in the rail and the number of rows here can never disagree. The
 * overview banner runs that predicate too but caps at 10, so it reports a
 * smaller figure once more than ten are open; that cap lives in
 * `src/app/admin/_data/overview.ts`.
 *
 * Open incidents are ordered worst-first: the `incident_severity` enum is
 * declared sev1 → sev4, and Postgres compares enums by declaration order, so an
 * ascending sort puts the page-one outage above the cosmetic bug.
 */

/** Matches `openIncidentCount()` in the admin layout. */
const OPEN_LIST_CAP = 50;

const RESOLVED_HISTORY_CAP = 50;

/**
 * Operator-set public status page. This page is currently its only reader — the
 * seed's description promises it to incident and provider-unavailable banners
 * too, but nothing else passes the key to `getSetting` yet.
 */
const STATUS_PAGE_SETTING_KEY = 'general.status_page_url';

/**
 * Maps both lists from a single clock reading, so every duration on the page
 * describes the same instant. The clock is read here rather than in the
 * component body, which has to stay pure for the React Compiler.
 */
function toIncidentRows(
  open: readonly Incident[],
  resolved: readonly Incident[],
): { open: AdminIncidentRow[]; resolved: AdminIncidentRow[] } {
  const now = Date.now();

  const map = (row: Incident): AdminIncidentRow => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    severity: row.severity,
    component: row.component,
    affectedTeams: row.affectedTeams,
    timeline: row.timeline,
    detectedAt: row.detectedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    elapsedMs: Math.max(0, (row.resolvedAt?.getTime() ?? now) - row.detectedAt.getTime()),
  });

  return { open: open.map(map), resolved: resolved.map(map) };
}

export default async function AdminIncidentsPage() {
  const { user: admin } = await requirePlatformAdmin();

  const [openRows, resolvedRows, resolvedStats, statusPageUrl] = await Promise.all([
    db
      .select()
      .from(incidents)
      .where(ne(incidents.status, 'resolved'))
      .orderBy(asc(incidents.severity), desc(incidents.detectedAt))
      .limit(OPEN_LIST_CAP),
    db
      .select()
      .from(incidents)
      .where(eq(incidents.status, 'resolved'))
      .orderBy(desc(incidents.resolvedAt))
      .limit(RESOLVED_HISTORY_CAP),
    db
      .select({
        total: sql<string>`count(*)`,
        meanSeconds: sql<
          string | null
        >`avg(extract(epoch from (${incidents.resolvedAt} - ${incidents.detectedAt})))`,
      })
      .from(incidents)
      .where(and(eq(incidents.status, 'resolved'), isNotNull(incidents.resolvedAt))),
    getSetting(STATUS_PAGE_SETTING_KEY, ''),
  ]);

  const rows = toIncidentRows(openRows, resolvedRows);

  const stats = resolvedStats[0];
  const resolvedTotal = Number(stats?.total ?? 0) || 0;
  const meanSeconds = Number(stats?.meanSeconds ?? 0) || 0;

  const urgent = rows.open.filter(
    (incident) => incident.severity === 'sev1' || incident.severity === 'sev2',
  ).length;
  const affectedTeams = rows.open.reduce((sum, incident) => sum + incident.affectedTeams, 0);
  const longestOpenMs = rows.open.reduce(
    (worst, incident) => Math.max(worst, incident.elapsedMs),
    0,
  );

  // The value is operator-supplied, so only an absolute HTTPS URL is turned into
  // a link — a relative or `javascript:` value is shown nowhere rather than
  // rendered into an anchor.
  const publicStatusHref = statusPageUrl.startsWith('https://') ? statusPageUrl : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Incidents"
        description="Degradations that affect customers, with the surface each one touched and how long it lasted. Status changes from this page are appended to the incident timeline and written to the audit log."
        actions={
          publicStatusHref ? (
            <Button variant="secondary" size="sm" asChild>
              <a href={publicStatusHref} target="_blank" rel="noreferrer noopener">
                Public status page
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          ) : null
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Open"
          value={formatCompactNumber(rows.open.length)}
          tone={rows.open.length > 0 ? 'ember' : 'default'}
          caption={
            rows.open.length === 0
              ? 'Nothing is degraded'
              : `${urgent} at sev1 or sev2 · longest open ${formatDuration(longestOpenMs)}`
          }
        />
        <Stat
          label="Teams affected"
          value={formatCompactNumber(affectedTeams)}
          caption="Summed from the figure filed on each open incident, so a team hit twice counts twice"
        />
        <Stat
          label="Mean time to resolve"
          value={resolvedTotal === 0 ? '—' : formatDuration(meanSeconds * 1000)}
          caption={
            resolvedTotal === 0
              ? 'No incident has been resolved yet'
              : `Across ${resolvedTotal} resolved incident${resolvedTotal === 1 ? '' : 's'}`
          }
        />
        <Stat
          label="Resolved"
          value={formatCompactNumber(resolvedTotal)}
          caption={
            resolvedTotal > RESOLVED_HISTORY_CAP
              ? `The table below shows the latest ${RESOLVED_HISTORY_CAP}`
              : 'All of them are listed below'
          }
        />
      </StatGrid>

      <IncidentsPanel
        open={rows.open}
        resolved={rows.resolved}
        adminName={admin.name || admin.email}
        openTruncated={rows.open.length === OPEN_LIST_CAP}
        openCap={OPEN_LIST_CAP}
      />

      <p className="text-[11px] leading-relaxed text-subtle">
        Incidents are filed deliberately, by an operator or by an external monitor writing to
        this table. Karo does not open one automatically from provider health, so a provider
        showing an error on the Providers page does not create a row here — file it, so
        customers see the same story on the status page that you see in this console.
      </p>
    </div>
  );
}
