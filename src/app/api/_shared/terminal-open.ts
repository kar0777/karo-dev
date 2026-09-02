import 'server-only';

import { ConflictError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import {
  terminalSessions,
  type Project,
  type Sandbox,
  type User,
  type ShellKind,
} from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { startSandbox } from '@/lib/sandbox/service';
import { loadBillingContext } from '@/lib/usage/metering';

/**
 * Opens a terminal session — the one code path behind both `POST /api/terminal`
 * and any feature that needs a shell prepared for the user (the CLI-agents
 * launcher). Does the plan shell check, wakes a sleeping machine, and writes
 * the session row that survives reloads and redeploys.
 */
export async function openTerminalSession(options: {
  sandbox: Sandbox;
  project: Project | null;
  user: User;
  shell: ShellKind;
  title?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
}): Promise<{ id: string; title: string }> {
  const { sandbox, project, user } = options;

  // Shells are a plan capability: `powershell` on a Linux sandbox needs an
  // image the smaller tiers do not get.
  const billing = await loadBillingContext(sandbox.teamId);
  const allowedShells = billing.plan.allowedShells ?? ['bash'];
  if (!allowedShells.includes(options.shell)) {
    throw new ConflictError(
      `The ${billing.plan.name} plan does not include the ${options.shell} shell.`,
      {
        title: 'Shell not available',
        description: `This plan can use: ${allowedShells.join(', ')}. Pick one of those, or upgrade to unlock more.`,
        details: { allowedShells },
      },
    );
  }

  // Opening a terminal is an unambiguous request for a machine.
  if (sandbox.status === 'sleeping' || sandbox.status === 'stopped') {
    await startSandbox(sandbox.id, { userId: user.id, reason: 'terminal' });
  }

  const sessionId = newId(ID_PREFIX.terminalSession);
  const inserted = await db
    .insert(terminalSessions)
    .values({
      id: sessionId,
      sandboxId: sandbox.id,
      projectId: project?.id ?? sandbox.projectId,
      userId: user.id,
      title: options.title ?? 'Terminal',
      shell: options.shell,
      cwd: options.cwd ?? '/workspace',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      isActive: true,
    })
    .returning();

  const session = inserted[0];
  if (!session) throw new Error('The terminal session could not be created.');

  return { id: session.id, title: session.title };
}
