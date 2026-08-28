import { z } from 'zod';

import { AUDIT_EXPORT_LIMIT, auditCsv, exportAuditLog } from '@/app/admin/_data/audit';
import { defineHandler } from '@/lib/api/handler';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';

/**
 * CSV export of the platform audit log.
 *
 * Buffered rather than streamed, unlike `/api/usage/export`: `exportAuditLog`
 * caps the result at `AUDIT_EXPORT_LIMIT` rows, which is small enough to hold in
 * memory and lets the handler report the exact row count in the audit event it
 * writes about itself.
 *
 * `requireApiPlatformAdmin()` answers 404 rather than 403 so the endpoint is
 * indistinguishable from a route that does not exist.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The same seven filters `/admin/audit` puts in its URL, under the same names. */
const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  action: z.string().trim().max(120).optional(),
  severity: z.enum(['all', 'info', 'notice', 'warning', 'critical']).default('all'),
  teamId: z.string().trim().max(80).optional(),
  userId: z.string().trim().max(80).optional(),
  from: z.string().regex(ISO_DATE, 'Use a YYYY-MM-DD date.').optional(),
  to: z.string().regex(ISO_DATE, 'Use a YYYY-MM-DD date.').optional(),
});

export const GET = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    query: querySchema,
    // Reading the whole log in one file is itself a privileged action, so it is
    // recorded. `admin.audit_export` has no entry in `AUDIT_ACTIONS` yet;
    // `auditActionLabel` renders the fallback ("Audit export") until it does.
    audit: { action: 'admin.audit_export', resourceType: 'audit_log', severity: 'notice' },
  },
  async ({ query, setAudit }) => {
    await requireApiPlatformAdmin();

    const filters = {
      q: query.q,
      action: query.action,
      severity: query.severity,
      teamId: query.teamId,
      userId: query.userId,
      from: query.from,
      to: query.to,
    };

    const rows = await exportAuditLog({ ...filters, page: 1 });
    const truncated = rows.length >= AUDIT_EXPORT_LIMIT;

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `karo-audit-${stamp}.csv`;

    setAudit({
      teamId: query.teamId ?? null,
      summary: `Exported ${rows.length} audit ${rows.length === 1 ? 'event' : 'events'} as CSV`,
      metadata: { filters, rows: rows.length, truncated, filename },
    });

    return new Response(auditCsv(rows), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        // A scripted consumer cannot tell a complete export from one that hit
        // the ceiling by looking at the rows, so the answer travels in a header.
        ...(truncated ? { 'x-karo-export-truncated': 'true' } : {}),
      },
    });
  },
);
