import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { serializeTerminalSession } from '@/app/api/_shared/route-helpers';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { ConflictError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { terminalSessions } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { startSandbox } from '@/lib/sandbox/service';
import { loadBillingContext } from '@/lib/usage/metering';

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

    // Shells are a plan capability: `powershell` on a Linux sandbox needs an
    // image the smaller tiers do not get.
    const billing = await loadBillingContext(access.team.id);
    const allowedShells = billing.plan.allowedShells ?? ['bash'];
    if (!allowedShells.includes(shell)) {
      throw new ConflictError(
        `The ${billing.plan.name} plan does not include the ${shell} shell.`,
        {
          title: 'Shell not available',
          description: `This plan can use: ${allowedShells.join(', ')}. Pick one of those, or upgrade to unlock more.`,
          details: { allowedShells },
        },
      );
    }

    // Opening a terminal is an unambiguous request for a machine.
    if (access.sandbox.status === 'sleeping' || access.sandbox.status === 'stopped') {
      await startSandbox(access.sandbox.id, { userId: user.id, reason: 'terminal' });
    }

    const sessionId = newId(ID_PREFIX.terminalSession);
    const inserted = await db
      .insert(terminalSessions)
      .values({
        id: sessionId,
        sandboxId: access.sandbox.id,
        projectId: body.projectId ?? access.sandbox.projectId,
        userId: user.id,
        title: body.title ?? 'Terminal',
        shell,
        cwd: body.cwd ?? '/workspace',
        cols: body.cols ?? 80,
        rows: body.rows ?? 24,
        isActive: true,
      })
      .returning();

    const session = inserted[0];
    if (!session) throw new Error('The terminal session could not be created.');

    return created({
      sessionId: session.id,
      session: serializeTerminalSession(session),
    });
  },
);
