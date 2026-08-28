import 'server-only';

import { eq } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { terminalSessions, type TerminalSession } from '@/lib/db/schema';
import { requireSandboxAccess, type SandboxAccess } from './sandbox-access';

/**
 * Resolves a terminal session and the caller's right to attach to it.
 *
 * Terminals are **personal**, unlike the sandbox they run on. Two people in the
 * same team each get their own shell, history and scrollback; sharing one would
 * mean their keystrokes interleave in the same pty. So ownership is checked in
 * addition to team access, and a session belonging to someone else reports 404
 * exactly like one that never existed.
 */
export type TerminalAccess = SandboxAccess & { session: TerminalSession };

export async function requireTerminalAccess(sessionId: string): Promise<TerminalAccess> {
  const rows = await db
    .select()
    .from(terminalSessions)
    .where(eq(terminalSessions.id, sessionId))
    .limit(1);

  const session = rows[0];
  if (!session) throw notFound();

  const access = await requireSandboxAccess(session.sandboxId, 'terminal.use');
  if (session.userId !== access.user.id) throw notFound();

  return { ...access, session };
}

function notFound(): NotFoundError {
  return new NotFoundError('Terminal session not found.', {
    title: 'Terminal closed',
    description:
      'This shell is no longer open — it may have exited, or its sandbox was destroyed. Open a new terminal to continue.',
  });
}
