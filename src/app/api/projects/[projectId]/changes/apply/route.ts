import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import { normalizeWorkspacePaths, routeParam } from '@/app/api/_shared/route-helpers';
import { deleteFilesInSandbox, mirrorFilesToSandbox } from '@/app/api/_shared/workspace-sync';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { projectFiles } from '@/lib/db/schema';

/**
 * `POST /api/projects/[projectId]/changes/apply` — approve the agent's edits.
 *
 * Approving promotes `pendingContent` to `content` and bumps the version, which
 * is the same shape a manual save produces — so the file's history stays
 * linear whether a human or the agent wrote the bytes.
 *
 * `paths: []` is rejected rather than silently treated as "all": approving
 * every outstanding diff must be an explicit request, never a bug in a caller
 * that forgot to populate its selection.
 */

export const dynamic = 'force-dynamic';

const body = z.object({
  paths: z.array(z.string().min(1).max(1024)).min(1, 'Select at least one file.').max(500),
});

export const POST = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: AUDIT_ACTIONS.projectFileWrite, resourceType: 'project_file' },
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

    const applied: Array<{ path: string; kind: string; version: number }> = [];
    const deletedPaths: string[] = [];
    const writtenFiles: Array<{ path: string; content: string }> = [];
    const now = new Date();

    for (const row of rows) {
      if (row.pendingChangeKind === 'deleted') {
        await db.delete(projectFiles).where(eq(projectFiles.id, row.id));
        deletedPaths.push(row.path);
        applied.push({ path: row.path, kind: 'deleted', version: row.version });
        continue;
      }

      const content = row.pendingContent ?? row.content;
      const version = row.version + 1;

      await db
        .update(projectFiles)
        .set({
          content,
          sizeBytes: Buffer.byteLength(content, 'utf8'),
          contentHash: sha256(content),
          pendingContent: null,
          pendingChangeKind: null,
          pendingByRunId: null,
          version,
          updatedAt: now,
        })
        .where(eq(projectFiles.id, row.id));

      writtenFiles.push({ path: row.path, content });
      applied.push({ path: row.path, kind: row.pendingChangeKind ?? 'modified', version });
    }

    await mirrorFilesToSandbox(projectId, writtenFiles);
    await deleteFilesInSandbox(projectId, deletedPaths);

    const missing = paths.filter((path) => !rows.some((row) => row.path === path));

    setAudit({
      teamId: access.team.id,
      resourceId: projectId,
      summary: `Approved ${applied.length} agent change${applied.length === 1 ? '' : 's'}`,
      metadata: { projectId, applied: applied.map((entry) => entry.path), missing },
    });

    return json({
      applied,
      /** Paths with nothing pending — already applied, rejected, or renamed. */
      skipped: missing,
    });
  },
);
