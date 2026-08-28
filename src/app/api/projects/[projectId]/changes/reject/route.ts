import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import { normalizeWorkspacePaths, routeParam } from '@/app/api/_shared/route-helpers';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { projectFiles } from '@/lib/db/schema';

/**
 * `POST /api/projects/[projectId]/changes/reject` — discard the agent's edits.
 *
 * Rejecting only clears the pending columns; the applied content is never
 * touched. A file the agent *created* and that was never approved has no
 * applied content at all, so its row goes away entirely — otherwise the tree
 * would keep showing an empty file nobody asked for.
 */

export const dynamic = 'force-dynamic';

const body = z.object({
  paths: z.array(z.string().min(1).max(1024)).min(1, 'Select at least one file.').max(500),
  reason: z.string().trim().max(500).optional(),
});

export const POST = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: AUDIT_ACTIONS.agentToolReject, resourceType: 'project_file' },
  },
  async ({ params, body: input, setAudit }) => {
    const projectId = routeParam(params, 'projectId');
    const access = await requireApiProjectAccess(projectId, 'agent.approve');

    const paths = normalizeWorkspacePaths(input.paths);

    const rows = await db
      .select()
      .from(projectFiles)
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          inArray(projectFiles.path, paths),
          isNotNull(projectFiles.pendingChangeKind),
        ),
      );

    const rejected: Array<{ path: string; kind: string; removed: boolean }> = [];
    const now = new Date();

    for (const row of rows) {
      // A never-approved creation has no earlier version to fall back to.
      const removeRow =
        row.pendingChangeKind === 'created' && row.version === 1 && row.content === '';

      if (removeRow) {
        await db.delete(projectFiles).where(eq(projectFiles.id, row.id));
      } else {
        await db
          .update(projectFiles)
          .set({
            pendingContent: null,
            pendingChangeKind: null,
            pendingByRunId: null,
            updatedAt: now,
          })
          .where(eq(projectFiles.id, row.id));
      }

      rejected.push({
        path: row.path,
        kind: row.pendingChangeKind ?? 'modified',
        removed: removeRow,
      });
    }

    const missing = paths.filter((path) => !rows.some((row) => row.path === path));

    setAudit({
      teamId: access.team.id,
      resourceId: projectId,
      severity: 'notice',
      summary: `Rejected ${rejected.length} agent change${rejected.length === 1 ? '' : 's'}`,
      metadata: {
        projectId,
        rejected: rejected.map((entry) => entry.path),
        missing,
        reason: input.reason,
      },
    });

    return json({ rejected, skipped: missing });
  },
);
