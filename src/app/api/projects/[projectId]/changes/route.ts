import { createTwoFilesPatch } from 'diff';
import { and, asc, eq, isNotNull } from 'drizzle-orm';

import { iso, routeParam } from '@/app/api/_shared/route-helpers';
import { countChanges } from '@/lib/agent/tools';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { projectFiles } from '@/lib/db/schema';

/**
 * `GET /api/projects/[projectId]/changes` — everything the agent has proposed
 * and nobody has decided on yet.
 *
 * A pending change lives on the file row itself (`pendingContent` +
 * `pendingChangeKind`) rather than in a separate table, which is what makes
 * "approve" a single UPDATE and guarantees a file can never have two competing
 * proposals in flight.
 *
 * Diffs are computed here rather than stored, so they always reflect the file's
 * *current* applied content — if the user edited the file by hand after the
 * agent proposed a change, the review screen shows that reality.
 */

export const dynamic = 'force-dynamic';

export const GET = defineHandler({ auth: 'required' }, async ({ params }) => {
  const projectId = routeParam(params, 'projectId');
  await requireApiProjectAccess(projectId, 'project.read');

  const rows = await db
    .select()
    .from(projectFiles)
    .where(
      and(eq(projectFiles.projectId, projectId), isNotNull(projectFiles.pendingChangeKind)),
    )
    .orderBy(asc(projectFiles.path))
    .limit(500);

  const changes = rows.map((row) => {
    const kind = row.pendingChangeKind ?? 'modified';
    const before = kind === 'created' ? '' : row.content;
    const after = kind === 'deleted' ? '' : (row.pendingContent ?? row.content);

    const diff = createTwoFilesPatch(
      `a/${row.path}`,
      `b/${row.path}`,
      before,
      after,
      undefined,
      undefined,
      { context: 3 },
    );
    const { additions, deletions } = countChanges(diff);

    return {
      path: row.path,
      kind,
      additions,
      deletions,
      pending: true,
      diff,
      language: row.language,
      sizeBytes: Buffer.byteLength(after, 'utf8'),
      runId: row.pendingByRunId,
      updatedAt: iso(row.updatedAt),
    };
  });

  return json({
    changes,
    totals: {
      files: changes.length,
      additions: changes.reduce((sum, change) => sum + change.additions, 0),
      deletions: changes.reduce((sum, change) => sum + change.deletions, 0),
    },
  });
});
