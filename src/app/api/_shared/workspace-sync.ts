import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { sandboxes, type Sandbox } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { rehydrateProvider } from '@/lib/sandbox/service';

/**
 * Keeping `/workspace` in step with `project_files`.
 *
 * The database row is the durable copy of a workspace; the sandbox filesystem
 * is a cache of it. Writes therefore always land in Postgres first and are
 * mirrored into the machine afterwards, **best effort** — a sleeping sandbox,
 * an offline BYOS worker or a provider hiccup must never make a save fail. The
 * next time a sandbox starts it is re-seeded from these same rows, so the two
 * converge without any repair logic.
 */

const log = createLogger('api:workspace-sync');

export async function runningSandboxForProject(projectId: string): Promise<Sandbox | null> {
  const rows = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.projectId, projectId), eq(sandboxes.status, 'running')))
    .limit(1);
  return rows[0] ?? null;
}

export async function mirrorFilesToSandbox(
  projectId: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  if (files.length === 0) return;

  const sandbox = await runningSandboxForProject(projectId);
  if (!sandbox) return;

  try {
    await rehydrateProvider(sandbox).uploadFiles(sandbox.id, files);
  } catch (error) {
    log.warn('Could not mirror files into the sandbox', {
      projectId,
      sandboxId: sandbox.id,
      count: files.length,
      error: String(error),
    });
  }
}

export async function deleteFilesInSandbox(projectId: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const sandbox = await runningSandboxForProject(projectId);
  if (!sandbox) return;

  const provider = rehydrateProvider(sandbox);
  for (const path of paths) {
    try {
      await provider.deleteFile(sandbox.id, path);
    } catch (error) {
      log.warn('Could not delete a file inside the sandbox', {
        projectId,
        sandboxId: sandbox.id,
        path,
        error: String(error),
      });
    }
  }
}
