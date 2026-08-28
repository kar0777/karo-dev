import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiPlatformAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { incidents } from '@/lib/db/schema';

/**
 * Incident status transitions.
 *
 * `status` is what the admin sidebar badge and the overview banner count, so
 * moving an incident changes what every other operator sees. Two rules follow
 * from that: nothing here rewrites history — each transition appends a timeline
 * entry naming the operator — and `resolvedAt` is kept in lockstep with the
 * status, because the duration and mean-time-to-resolve figures are derived from
 * it rather than stored.
 */

const STATUSES = ['open', 'investigating', 'monitoring', 'resolved'] as const;

type IncidentStatus = (typeof STATUSES)[number];

const bodySchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(1000).optional(),
});

/** Recorded in the timeline when the operator adds no note of their own. */
const DEFAULT_NOTE: Record<IncidentStatus, string> = {
  open: 'Reopened.',
  investigating: 'Acknowledged; investigating.',
  monitoring: 'Mitigation applied; monitoring for recurrence.',
  resolved: 'Resolved.',
};

function paramIncidentId(params: Record<string, string | string[] | undefined>): string {
  const value = params.incidentId;
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new ValidationError('An incident id is required.');
  return id;
}

export const PATCH = defineHandler(
  {
    auth: 'required',
    rateLimit: 'api.default',
    body: bodySchema,
    audit: {
      action: AUDIT_ACTIONS.adminIncidentUpdate,
      resourceType: 'incident',
      severity: 'notice',
    },
  },
  async ({ body, params, setAudit }) => {
    const { user: actor } = await requireApiPlatformAdmin();
    const incidentId = paramIncidentId(params);

    const rows = await db.select().from(incidents).where(eq(incidents.id, incidentId)).limit(1);
    const current = rows[0];
    if (!current) throw new NotFoundError('That incident does not exist.');

    if (current.status === body.status) {
      throw new ConflictError(`This incident is already ${body.status}.`, {
        title: 'Nothing to change',
        description:
          'Another operator may have moved it while this view was open. Reload the page to see where it stands.',
      });
    }

    const now = new Date();
    const note = body.note && body.note.length > 0 ? body.note : DEFAULT_NOTE[body.status];

    const [updated] = await db
      .update(incidents)
      .set({
        status: body.status,
        resolvedAt: body.status === 'resolved' ? now : null,
        timeline: [
          ...current.timeline,
          { at: now.toISOString(), author: actor.name || actor.email, note },
        ],
        updatedAt: now,
      })
      .where(eq(incidents.id, incidentId))
      .returning();

    const summary = `Incident "${current.title}" moved from ${current.status} to ${body.status}`;

    setAudit({
      resourceId: incidentId,
      summary,
      // Resolving is good news; every other transition means something is still
      // wrong, and the audit log is read severity-first during a postmortem.
      severity: body.status === 'resolved' ? 'notice' : 'warning',
      metadata: {
        from: current.status,
        to: body.status,
        severity: current.severity,
        component: current.component,
        affectedTeams: current.affectedTeams,
        note,
      },
    });

    return json({
      ok: true,
      summary,
      status: updated?.status ?? body.status,
      resolvedAt: updated?.resolvedAt?.toISOString() ?? null,
    });
  },
);
