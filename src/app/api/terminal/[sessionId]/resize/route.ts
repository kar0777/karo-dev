import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { routeParam, serializeTerminalSession } from '@/app/api/_shared/route-helpers';
import { requireTerminalAccess } from '@/app/api/_shared/terminal-access';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { terminalSessions } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { rehydrateProvider } from '@/lib/sandbox/service';

/**
 * `POST /api/terminal/[sessionId]/resize` — tell the pty its new geometry.
 *
 * The dimensions are stored on the session row as well as pushed to the
 * provider, so a reconnect re-attaches at the size the user last had rather
 * than snapping back to 80×24 and rewrapping their scrollback.
 *
 * A provider that cannot be reached is logged and shrugged off: the wrong
 * column count is a cosmetic problem, and failing the request would surface a
 * red toast every time somebody drags a panel divider.
 */

export const dynamic = 'force-dynamic';

const log = createLogger('api:terminal-resize');

const body = z.object({
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(200),
});

export const POST = defineHandler(
  { auth: 'required', body },
  async ({ params, body: input }) => {
    const sessionId = routeParam(params, 'sessionId');
    const access = await requireTerminalAccess(sessionId);
    const { session, sandbox } = access;

    let applied = false;
    if (sandbox.status === 'running' && session.isActive) {
      try {
        await rehydrateProvider(sandbox).resizeTerminal(
          sandbox.id,
          session.id,
          input.cols,
          input.rows,
        );
        applied = true;
      } catch (error) {
        log.warn('Could not resize the pty', { sessionId: session.id, error: String(error) });
      }
    }

    const updated = await db
      .update(terminalSessions)
      .set({ cols: input.cols, rows: input.rows, lastActiveAt: new Date() })
      .where(eq(terminalSessions.id, session.id))
      .returning();

    const row = updated[0] ?? session;

    return json({
      session: serializeTerminalSession(row),
      /** False when the size was remembered but the live pty did not get it. */
      applied,
    });
  },
);
