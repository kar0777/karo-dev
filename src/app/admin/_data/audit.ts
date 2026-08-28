import 'server-only';

import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';

import { auditActionLabel } from '@/lib/audit';
import { db } from '@/lib/db';
import { auditEvents, teams, users } from '@/lib/db/schema';

/**
 * Audit-log reads.
 *
 * Metadata is already redacted at write time (`recordAudit` runs every payload
 * through `redactSecrets`), so this layer never has to think about secrets — it
 * only has to make the log searchable.
 */

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_LIMIT = 5_000;

export type AuditQuery = {
  q?: string;
  action?: string;
  severity?: string;
  teamId?: string;
  userId?: string;
  from?: string;
  to?: string;
  page: number;
};

export type AuditRow = {
  id: string;
  action: string;
  actionLabel: string;
  actorType: string;
  severity: string;
  summary: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
  teamName: string | null;
};

export type AuditResult = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageCount: number;
};

function parseDate(value: string | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function auditFilters(query: AuditQuery) {
  const clauses = [];

  const term = query.q?.trim();
  if (term) {
    const pattern = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    clauses.push(
      or(
        ilike(auditEvents.summary, pattern),
        ilike(auditEvents.action, pattern),
        ilike(auditEvents.resourceId, pattern),
      ),
    );
  }
  if (query.action) clauses.push(eq(auditEvents.action, query.action));
  if (query.severity && query.severity !== 'all') {
    clauses.push(sql`${auditEvents.severity}::text = ${query.severity}`);
  }
  if (query.teamId) clauses.push(eq(auditEvents.teamId, query.teamId));
  if (query.userId) clauses.push(eq(auditEvents.userId, query.userId));

  const from = parseDate(query.from);
  const to = parseDate(query.to, true);
  if (from) clauses.push(gte(auditEvents.createdAt, from));
  if (to) clauses.push(lte(auditEvents.createdAt, to));

  return clauses.length > 0 ? and(...clauses) : undefined;
}

async function selectAudit(query: AuditQuery, limit: number, offset: number) {
  return db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      actorType: auditEvents.actorType,
      severity: auditEvents.severity,
      summary: auditEvents.summary,
      resourceType: auditEvents.resourceType,
      resourceId: auditEvents.resourceId,
      metadata: auditEvents.metadata,
      ipAddress: auditEvents.ipAddress,
      userAgent: auditEvents.userAgent,
      createdAt: auditEvents.createdAt,
      userEmail: users.email,
      userName: users.name,
      teamName: teams.name,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.userId))
    .leftJoin(teams, eq(teams.id, auditEvents.teamId))
    .where(auditFilters(query))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function loadAuditLog(query: AuditQuery): Promise<AuditResult> {
  const page = Math.max(1, query.page);

  const [totalRows, rows] = await Promise.all([
    db.select({ value: count() }).from(auditEvents).where(auditFilters(query)),
    selectAudit(query, AUDIT_PAGE_SIZE, (page - 1) * AUDIT_PAGE_SIZE),
  ]);

  const total = totalRows[0]?.value ?? 0;

  return {
    rows: rows.map((row) => ({
      ...row,
      actionLabel: auditActionLabel(row.action),
      metadata: row.metadata ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}

/** Flat rows for the CSV export — same filters, no paging. */
export async function exportAuditLog(query: AuditQuery): Promise<AuditRow[]> {
  const rows = await selectAudit(query, AUDIT_EXPORT_LIMIT, 0);
  return rows.map((row) => ({
    ...row,
    actionLabel: auditActionLabel(row.action),
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Distinct actions present in the log — populates the filter dropdown. */
export async function auditActions(): Promise<string[]> {
  const rows = await db
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .groupBy(auditEvents.action)
    .orderBy(auditEvents.action);
  return rows.map((r) => r.action);
}

/** Teams that appear in the log, for the team filter. */
export async function auditTeams(): Promise<Array<{ id: string; name: string }>> {
  const rows = await db
    .select({ id: teams.id, name: teams.name })
    .from(auditEvents)
    .innerJoin(teams, eq(teams.id, auditEvents.teamId))
    .groupBy(teams.id, teams.name)
    .orderBy(teams.name)
    .limit(200);
  return rows;
}

const CSV_ESCAPE = /[",\n\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A leading =, +, - or @ turns a cell into a formula in Excel; prefix it.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return CSV_ESCAPE.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function auditCsv(rows: AuditRow[]): string {
  const header = [
    'timestamp',
    'action',
    'label',
    'severity',
    'actor_type',
    'user_email',
    'team',
    'resource_type',
    'resource_id',
    'summary',
    'ip_address',
    'metadata',
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.createdAt,
        row.action,
        row.actionLabel,
        row.severity,
        row.actorType,
        row.userEmail ?? '',
        row.teamName ?? '',
        row.resourceType,
        row.resourceId ?? '',
        row.summary,
        row.ipAddress ?? '',
        row.metadata,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
