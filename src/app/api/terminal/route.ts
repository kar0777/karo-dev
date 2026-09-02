import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { serializeTerminalSession } from '@/app/api/_shared/route-helpers';
import { openTerminalSession } from '@/app/api/_shared/terminal-open';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { terminalSessions } from '@/lib/db/schema';

/**
 * `/api/terminal` — open a shell, or list the ones already open.
 *
 * A terminal session is a database row, not a socket. The row survives a page
 * reload, a redeploy and a sandbox restart, carrying the scrollback and command
 * history with it, so reopening the workspace restores the screen instead of
 * greeting the user with a blank prompt. `/[sessionId]/stream` attaches the
 * live byte stream to that row.
 */

export const dynamic = 'force-dynamic';

const listQuery = z.object({
  projectId: z.string().trim().max(64).optional(),
  sandboxId: z.string().trim().max(64).optional(),
  includeClosed: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const GET = defineHandler(
  { auth: 'required', query: listQuery },
  async ({ user, query }) => {
    const filters = [eq(terminalSessions.userId, user.id)];

    if (query.projectId) {
      await requireApiProjectAccess(query.projectId, 'terminal.use');
      filters.push(eq(terminalSessions.projectId, query.projectId));
    }
    if (query.sandboxId) {
      await requireSandboxAccess(query.sandboxId, 'terminal.use');
      filters.push(eq(terminalSessions.sandboxId, query.sandboxId));
    }
    if (!query.includeClosed) filters.push(eq(terminalSessions.isActive, true));

    const rows = await db
      .select()
      .from(terminalSessions)
      .where(and(...filters))
      .orderBy(desc(terminalSessions.lastActiveAt))
      .limit(50);

    return json({ sessions: rows.map(serializeTerminalSession) });
  },
);

const createBody = z.object({
  sandboxId: z.string().min(1).max(64),
  projectId: z.string().trim().max(64).optional(),
  shell: z.enum(['bash', 'sh', 'powershell', 'cmd']).optional(),
  cols: z.number().int().min(20).max(500).optional(),
  rows: z.number().int().min(5).max(200).optional(),
  title: z.string().trim().min(1).max(60).optional(),
  cwd: z.string().trim().max(1_024).optional(),
});

export const POST = defineHandler(
  { auth: 'required', body: createBody },
  async ({ body, user }) => {
    const access = await requireSandboxAccess(body.sandboxId, 'terminal.use');
    const shell = body.shell ?? access.project?.defaultShell ?? 'bash';

    const session = await openTerminalSession({
      sandbox: access.sandbox,
      project: access.project,
      user,
      shell,
      title: body.title,
      cols: body.cols,
      rows: body.rows,
      cwd: body.cwd,
    });

    return created({
      sessionId: session.id,
      title: session.title,
    });
  },
);
