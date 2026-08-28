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
 * `POST /api/terminal/[sessionId]/kill` — interrupt or close a shell.
 *
 * Two different intents behind one button:
 *  · `close: false` (default) sends an interrupt — the Ctrl-C that stops a
 *    runaway process but leaves the prompt sitting there;
 *  · `close: true` also ends the session row, which is what the tab's ✕ does.
 *
 * The row is closed even when the provider call fails. A terminal the user has
 * dismissed must not reappear in the tab strip on the next reload just because
 * a sandbox was unreachable for a moment.
 */

export const dynamic = 'force-dynamic';

const log = createLogger('api:terminal-kill');

const body = z
  .object({
    close: z.boolean().optional(),
  })
  .default({});

export const POST = defineHandler(
  { auth: 'required', body },
  async ({ params, body: input }) => {
    const sessionId = routeParam(params, 'sessionId');
    const access = await requireTerminalAccess(sessionId);
    const { session, sandbox } = access;

    let signalled = false;
    if (sandbox.status === 'running') {
      try {
        await rehydrateProvider(sandbox).killTerminal(sandbox.id, session.id);
        signalled = true;
      } catch (error) {
        log.warn('Could not signal the pty', { sessionId: session.id, error: String(error) });
      }
    }

    const close = input.close ?? false;
    const now = new Date();

    const updated = await db
      .update(terminalSessions)
      .set({
        lastActiveAt: now,
        ...(close ? { isActive: false, closedAt: now } : {}),
      })
      .where(eq(terminalSessions.id, session.id))
      .returning();

    return json({
      session: serializeTerminalSession(updated[0] ?? session),
      signalled,
      closed: close,
    });
  },
);
