import { and, asc, eq, isNotNull } from 'drizzle-orm';

import { routeParam } from '@/app/api/_shared/route-helpers';
import { runningSandboxForProject } from '@/app/api/_shared/workspace-sync';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { projectFiles, type Sandbox } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { rehydrateProvider } from '@/lib/sandbox/service';

/**
 * `GET /api/projects/[projectId]/git` — working-tree status.
 *
 * Two sources, in order of truth:
 *
 *  1. **The real repository**, when a sandbox is running and `/workspace` is a
 *     git checkout. `git status --porcelain=v2 --branch` is parsed, so what the
 *     UI shows is what git says — including the branch, ahead/behind counts and
 *     files the agent staged.
 *  2. **The pending-change ledger**, otherwise. With no machine (or no repo)
 *     Karo still knows which files the agent has touched and has not had
 *     approved, which is the question the Changes tab actually asks.
 *
 * The response says which one it used so the UI never claims more certainty
 * than it has.
 */

export const dynamic = 'force-dynamic';

const log = createLogger('api:git');

type FileStatus = { path: string; status: string };

export const GET = defineHandler({ auth: 'required' }, async ({ params }) => {
  const projectId = routeParam(params, 'projectId');
  const access = await requireApiProjectAccess(projectId, 'project.read');
  const project = access.project;

  const sandbox = await runningSandboxForProject(projectId);

  if (sandbox) {
    const real = await readRealGitStatus(sandbox);
    if (real) {
      return json({
        source: 'sandbox' as const,
        available: true,
        branch: real.branch || project.gitBranch,
        remoteUrl: project.gitRemoteUrl,
        ahead: real.ahead,
        behind: real.behind,
        staged: real.staged,
        unstaged: real.unstaged,
        untracked: real.untracked,
        clean: real.staged.length + real.unstaged.length + real.untracked.length === 0,
        message: null,
      });
    }
  }

  const pending = await db
    .select({ path: projectFiles.path, kind: projectFiles.pendingChangeKind })
    .from(projectFiles)
    .where(
      and(eq(projectFiles.projectId, projectId), isNotNull(projectFiles.pendingChangeKind)),
    )
    .orderBy(asc(projectFiles.path))
    .limit(500);

  const untracked = pending
    .filter((row) => row.kind === 'created')
    .map((row) => ({ path: row.path, status: 'added' }));
  const unstaged = pending
    .filter((row) => row.kind !== 'created')
    .map((row) => ({
      path: row.path,
      status: row.kind === 'deleted' ? 'deleted' : 'modified',
    }));

  return json({
    source: 'workspace' as const,
    available: false,
    branch: project.gitBranch,
    remoteUrl: project.gitRemoteUrl,
    ahead: 0,
    behind: 0,
    staged: [] as FileStatus[],
    unstaged,
    untracked,
    clean: unstaged.length + untracked.length === 0,
    message: sandbox
      ? 'This workspace is not a git repository yet. Ask the agent to run `git init`, or connect a remote in project settings.'
      : 'Start the sandbox to read live git status. Until then this shows the changes the agent has proposed.',
  });
});

type RealStatus = {
  branch: string;
  ahead: number;
  behind: number;
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: FileStatus[];
};

async function readRealGitStatus(sandbox: Sandbox): Promise<RealStatus | null> {
  try {
    const result = await rehydrateProvider(sandbox).execute(sandbox.id, {
      command: 'git status --porcelain=v2 --branch --untracked-files=all',
      cwd: '/workspace',
      timeoutSeconds: 20,
    });

    // A non-zero exit is almost always "not a git repository", which is a
    // normal state for a fresh workspace — fall through to the ledger view.
    if (result.exitCode !== 0) return null;
    return parsePorcelainV2(result.stdout);
  } catch (error) {
    log.warn('Could not read git status from the sandbox', {
      sandboxId: sandbox.id,
      provider: sandbox.provider,
      error: String(error),
    });
    return null;
  }
}

/**
 * Parses `git status --porcelain=v2 --branch`.
 *
 * v2 rather than v1 because it reports branch, ahead/behind and the staged vs
 * worktree halves of the status code as separate, unambiguous fields — v1
 * requires guessing at column positions once paths contain spaces.
 */
function parsePorcelainV2(stdout: string): RealStatus {
  const status: RealStatus = {
    branch: '',
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
  };

  for (const line of stdout.split('\n')) {
    if (!line) continue;

    if (line.startsWith('# branch.head ')) {
      status.branch = line.slice('# branch.head '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const parts = line.slice('# branch.ab '.length).trim().split(/\s+/);
      status.ahead = Math.abs(Number.parseInt(parts[0] ?? '+0', 10)) || 0;
      status.behind = Math.abs(Number.parseInt(parts[1] ?? '-0', 10)) || 0;
      continue;
    }
    if (line.startsWith('# ')) continue;

    // `? <path>` — untracked.
    if (line.startsWith('? ')) {
      status.untracked.push({ path: line.slice(2).trim(), status: 'untracked' });
      continue;
    }
    // `! <path>` — ignored; not interesting to the review UI.
    if (line.startsWith('! ')) continue;

    // `1 XY ...  <path>` (ordinary) or `2 XY ... <path>\t<orig>` (renamed).
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const fields = line.split(' ');
      const xy = fields[1] ?? '..';
      const path = (
        line.startsWith('2 ')
          ? fields.slice(9).join(' ').split('\t')[0]
          : fields.slice(8).join(' ')
      )?.trim();
      if (!path) continue;

      const stagedCode = xy[0] ?? '.';
      const worktreeCode = xy[1] ?? '.';
      if (stagedCode !== '.') status.staged.push({ path, status: describeCode(stagedCode) });
      if (worktreeCode !== '.')
        status.unstaged.push({ path, status: describeCode(worktreeCode) });
      continue;
    }

    // `u XY ...` — unmerged paths.
    if (line.startsWith('u ')) {
      const path = line.split(' ').slice(10).join(' ').trim();
      if (path) status.unstaged.push({ path, status: 'conflicted' });
    }
  }

  return status;
}

function describeCode(code: string): string {
  switch (code) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'U':
      return 'conflicted';
    default:
      return 'changed';
  }
}
