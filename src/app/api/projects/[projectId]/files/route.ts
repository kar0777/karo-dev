import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { iso, routeParam } from '@/app/api/_shared/route-helpers';
import { normalizeWorkspacePath } from '@/lib/agent/policy';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { projectFiles } from '@/lib/db/schema';

/**
 * `GET /api/projects/[projectId]/files` — the workspace file tree.
 *
 * Reads from `project_files`, not from the sandbox. The database is the durable
 * copy of a workspace: the sandbox may be asleep, destroyed or on a server that
 * is currently offline, and the file explorer must still open. Agent tools
 * mirror their writes into both, so the two agree while a machine is running.
 *
 * `?path=` returns one directory level (like `ls`); `?recursive=true` returns
 * the whole subtree, which is what the tree view asks for on first paint.
 */

export const dynamic = 'force-dynamic';

const query = z.object({
  path: z.string().max(1024).optional(),
  recursive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

type Entry = {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  language: string | null;
  hasPendingChange: boolean;
  pendingChangeKind: string | null;
  updatedAt: string | null;
};

export const GET = defineHandler({ auth: 'required', query }, async ({ params, query: q }) => {
  const projectId = routeParam(params, 'projectId');
  await requireApiProjectAccess(projectId, 'project.read');

  // An empty / missing / "." path means the workspace root, which
  // `normalizeWorkspacePath` deliberately rejects (it never returns '').
  const raw = (q.path ?? '').trim();
  const prefix = raw === '' || raw === '.' || raw === '/' ? '' : normalizeWorkspacePath(raw);

  const rows = await db
    .select({
      path: projectFiles.path,
      isDirectory: projectFiles.isDirectory,
      sizeBytes: projectFiles.sizeBytes,
      language: projectFiles.language,
      pendingChangeKind: projectFiles.pendingChangeKind,
      updatedAt: projectFiles.updatedAt,
    })
    .from(projectFiles)
    .where(eq(projectFiles.projectId, projectId))
    .orderBy(asc(projectFiles.path))
    .limit(5_000);

  const scoped = rows.filter((row) =>
    prefix === '' ? true : row.path === prefix || row.path.startsWith(`${prefix}/`),
  );

  const entries: Entry[] = q.recursive
    ? scoped
        .filter((row) => row.path !== prefix)
        .map((row) => ({
          path: row.path,
          name: row.path.split('/').pop() ?? row.path,
          isDirectory: row.isDirectory,
          sizeBytes: row.sizeBytes,
          language: row.language,
          hasPendingChange: row.pendingChangeKind !== null,
          pendingChangeKind: row.pendingChangeKind,
          updatedAt: iso(row.updatedAt),
        }))
    : collapseToLevel(scoped, prefix);

  entries.sort(
    (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
  );

  return json({
    path: prefix,
    recursive: q.recursive,
    files: entries,
    truncated: rows.length >= 5_000,
  });
});

/**
 * Directories are implicit — a file at `src/lib/util.ts` implies `src` and
 * `src/lib` without either having a row. One level of the tree is therefore the
 * set of distinct next path segments below the prefix.
 */
function collapseToLevel(
  rows: Array<{
    path: string;
    isDirectory: boolean;
    sizeBytes: number;
    language: string | null;
    pendingChangeKind: string | null;
    updatedAt: Date;
  }>,
  prefix: string,
): Entry[] {
  const byName = new Map<string, Entry>();

  for (const row of rows) {
    if (row.path === prefix) continue;
    const relative = prefix ? row.path.slice(prefix.length + 1) : row.path;
    const [head, ...rest] = relative.split('/');
    if (!head) continue;

    const fullPath = prefix ? `${prefix}/${head}` : head;
    const isDirectory = rest.length > 0 || row.isDirectory;

    const existing = byName.get(head);
    if (existing) {
      // Roll a directory's contents up into its own size and pending flag.
      existing.sizeBytes += rest.length > 0 ? row.sizeBytes : 0;
      existing.hasPendingChange ||= row.pendingChangeKind !== null;
      continue;
    }

    byName.set(head, {
      path: fullPath,
      name: head,
      isDirectory,
      sizeBytes: isDirectory && rest.length > 0 ? row.sizeBytes : row.sizeBytes,
      language: rest.length > 0 ? null : row.language,
      hasPendingChange: row.pendingChangeKind !== null,
      pendingChangeKind: rest.length > 0 ? null : row.pendingChangeKind,
      updatedAt: iso(row.updatedAt),
    });
  }

  return [...byName.values()];
}
