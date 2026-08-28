import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { iso, routeParam } from '@/app/api/_shared/route-helpers';
import { deleteFilesInSandbox, mirrorFilesToSandbox } from '@/app/api/_shared/workspace-sync';
import { normalizeWorkspacePath } from '@/lib/agent/policy';
import { languageFor } from '@/lib/agent/tools';
import { ConflictError, NotFoundError, QuotaExceededError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { sha256 } from '@/lib/crypto/secrets';
import { db } from '@/lib/db';
import { projectFiles } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';

/**
 * `/api/projects/[projectId]/files/content` — read, write and delete one file.
 *
 * Writes carry an optional `expectedVersion`. The editor sends the version it
 * loaded; if the agent (or another tab) saved in the meantime the write is
 * refused with a 409 instead of silently discarding their work.
 */

export const dynamic = 'force-dynamic';

const readQuery = z.object({
  path: z.string().min(1).max(1024),
  /** Return the agent's unapproved version instead of the applied one. */
  pending: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const GET = defineHandler(
  { auth: 'required', query: readQuery },
  async ({ params, query }) => {
    const projectId = routeParam(params, 'projectId');
    await requireApiProjectAccess(projectId, 'project.read');

    const path = normalizeWorkspacePath(query.path);
    const row = await loadFile(projectId, path);

    if (!row) {
      throw new NotFoundError(`No file at ${path}.`, {
        title: 'File not found',
        description:
          'It may have been renamed or deleted since this tab was opened. Refresh the file tree to see the current workspace.',
      });
    }

    const content =
      query.pending && row.pendingContent !== null ? row.pendingContent : row.content;

    return json({
      path: row.path,
      content,
      language: row.language ?? languageFor(row.path),
      sizeBytes: row.sizeBytes,
      isBinary: row.isBinary,
      version: row.version,
      contentHash: row.contentHash,
      pendingChangeKind: row.pendingChangeKind,
      hasPendingChange: row.pendingChangeKind !== null,
      updatedAt: iso(row.updatedAt),
    });
  },
);

const writeBody = z.object({
  path: z.string().min(1).max(1024),
  content: z.string(),
  expectedVersion: z.number().int().min(1).optional(),
});

export const PUT = defineHandler(
  {
    auth: 'required',
    body: writeBody,
    audit: { action: AUDIT_ACTIONS.projectFileWrite, resourceType: 'project_file' },
  },
  async ({ params, body, setAudit }) => {
    const projectId = routeParam(params, 'projectId');
    const access = await requireApiProjectAccess(projectId, 'project.file.write');

    const path = normalizeWorkspacePath(body.path);
    const maxBytes = await getSetting(
      SETTING_KEYS.limitsMaxUploadBytes,
      settingDefault(SETTING_KEYS.limitsMaxUploadBytes),
    );
    const sizeBytes = Buffer.byteLength(body.content, 'utf8');

    if (sizeBytes > maxBytes) {
      throw new QuotaExceededError(
        `That file is ${Math.round(sizeBytes / 1024)} KB and the limit is ${Math.round(
          maxBytes / 1024,
        )} KB. Split it up, or have the agent generate it inside the sandbox instead.`,
        { details: { sizeBytes, maxBytes } },
      );
    }

    const existing = await loadFile(projectId, path);

    if (
      body.expectedVersion !== undefined &&
      existing &&
      existing.version !== body.expectedVersion
    ) {
      throw new ConflictError('This file changed since you opened it.', {
        title: 'File changed elsewhere',
        description:
          'Someone — or the agent — saved a newer version. Reload the file to see their changes, then reapply yours.',
        details: { yourVersion: body.expectedVersion, currentVersion: existing.version },
      });
    }

    const now = new Date();
    const language = languageFor(path);
    const contentHash = sha256(body.content);

    const saved = existing
      ? (
          await db
            .update(projectFiles)
            .set({
              content: body.content,
              sizeBytes,
              contentHash,
              language,
              // A manual save resolves whatever the agent had proposed.
              pendingContent: null,
              pendingChangeKind: null,
              pendingByRunId: null,
              version: existing.version + 1,
              updatedAt: now,
            })
            .where(eq(projectFiles.id, existing.id))
            .returning()
        )[0]
      : (
          await db
            .insert(projectFiles)
            .values({
              id: newId(ID_PREFIX.projectFile),
              projectId,
              path,
              content: body.content,
              sizeBytes,
              contentHash,
              language,
              version: 1,
            })
            .returning()
        )[0];

    if (!saved) throw new NotFoundError('The file could not be saved.');

    await mirrorFilesToSandbox(projectId, [{ path, content: body.content }]);

    setAudit({
      teamId: access.team.id,
      resourceId: `${projectId}:${path}`,
      summary: `${existing ? 'Updated' : 'Created'} ${path}`,
      metadata: { projectId, path, sizeBytes, version: saved.version },
    });

    return json({
      path: saved.path,
      version: saved.version,
      sizeBytes: saved.sizeBytes,
      contentHash: saved.contentHash,
      language: saved.language,
      updatedAt: iso(saved.updatedAt),
      created: !existing,
    });
  },
);

const deleteQuery = z.object({ path: z.string().min(1).max(1024) });

export const DELETE = defineHandler(
  {
    auth: 'required',
    query: deleteQuery,
    audit: { action: AUDIT_ACTIONS.projectFileDelete, resourceType: 'project_file' },
  },
  async ({ params, query, setAudit }) => {
    const projectId = routeParam(params, 'projectId');
    const access = await requireApiProjectAccess(projectId, 'project.file.write');

    const path = normalizeWorkspacePath(query.path);
    const existing = await loadFile(projectId, path);

    if (!existing) {
      throw new NotFoundError(`No file at ${path}.`, {
        title: 'File not found',
        description: 'It has already been removed. Refresh the file tree to see the workspace.',
      });
    }

    await db.delete(projectFiles).where(eq(projectFiles.id, existing.id));
    await deleteFilesInSandbox(projectId, [path]);

    setAudit({
      teamId: access.team.id,
      resourceId: `${projectId}:${path}`,
      severity: 'notice',
      summary: `Deleted ${path}`,
      metadata: { projectId, path },
    });

    return json({ deleted: true, path });
  },
);

async function loadFile(projectId: string, path: string) {
  const rows = await db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)))
    .limit(1);
  return rows[0] ?? null;
}
