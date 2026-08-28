import { eq } from 'drizzle-orm';

import { routeParam } from '@/app/api/_shared/route-helpers';
import { requireTerminalAccess } from '@/app/api/_shared/terminal-access';
import { ConflictError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { db } from '@/lib/db';
import { terminalSessions } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { rehydrateProvider, touchSandbox } from '@/lib/sandbox/service';
import type { TerminalChunk } from '@/lib/sandbox/types';
import { SSE_HEADERS, encodeSse } from '@/lib/types/agent';

/**
 * `GET /api/terminal/[sessionId]/stream` — the pty's output, as SSE.
 *
 * SSE rather than a WebSocket, for the same reasons the chat stream uses it:
 * terminal output is strictly server→client (keystrokes go back over
 * `/input`), it survives HTTP/2 and corporate proxies untouched, and a dropped
 * connection reconnects for free.
 *
 * Two details make a reconnect feel seamless:
 *  · the stored **scrollback** is replayed as the first frame, so the screen
 *    comes back rather than starting blank;
 *  · output is buffered and flushed to the row periodically instead of on every
 *    chunk — a `yes` loop must not turn into thousands of UPDATE statements.
 */

export const dynamic = 'force-dynamic';

const log = createLogger('api:terminal-stream');

/** Ring-buffer ceiling for persisted output. Roughly 400 lines of 80 columns. */
const MAX_SCROLLBACK_CHARS = 32_000;
const FLUSH_INTERVAL_MS = 3_000;

export const GET = defineHandler(
  { auth: 'required', rateLimit: 'api.default' },
  async ({ params, req }) => {
    const sessionId = routeParam(params, 'sessionId');
    const access = await requireTerminalAccess(sessionId);
    const { session, sandbox } = access;

    if (sandbox.status !== 'running') {
      throw new ConflictError(`The sandbox is ${sandbox.status}.`, {
        title: 'Sandbox is not running',
        description:
          sandbox.status === 'sleeping'
            ? 'Sandbox is asleep — start it from the Sandboxes panel, then reopen this terminal.'
            : 'Start the sandbox before attaching a terminal to it.',
        details: { status: sandbox.status },
      });
    }

    const provider = rehydrateProvider(sandbox);
    const controller = new AbortController();
    const onClientAbort = () => controller.abort();
    req.signal.addEventListener('abort', onClientAbort, { once: true });

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(streamController) {
        let clientGone = false;
        const send = (chunk: TerminalChunk) => {
          if (clientGone) return;
          try {
            streamController.enqueue(encoder.encode(encodeSse(chunk)));
          } catch {
            clientGone = true;
          }
        };

        let scrollback = session.scrollback;
        let dirty = false;
        let lastFlush = Date.now();
        let exitCode: number | null = null;

        const persist = async () => {
          if (!dirty) return;
          dirty = false;
          lastFlush = Date.now();
          try {
            await db
              .update(terminalSessions)
              .set({ scrollback, lastActiveAt: new Date() })
              .where(eq(terminalSessions.id, session.id));
          } catch (error) {
            log.warn('Could not persist terminal scrollback', {
              sessionId: session.id,
              error: String(error),
            });
          }
        };

        // Restore the screen before any new bytes arrive.
        if (scrollback) send({ type: 'stdout', data: scrollback });

        try {
          for await (const chunk of provider.streamTerminal(sandbox.id, {
            sessionId: session.id,
            shell: session.shell,
            cols: session.cols,
            rows: session.rows,
            cwd: session.cwd,
            signal: controller.signal,
          })) {
            send(chunk);

            if (chunk.type === 'stdout' || chunk.type === 'stderr') {
              scrollback = `${scrollback}${chunk.data}`.slice(-MAX_SCROLLBACK_CHARS);
              dirty = true;
              if (Date.now() - lastFlush > FLUSH_INTERVAL_MS) await persist();
            } else if (chunk.type === 'exit') {
              exitCode = chunk.exitCode;
              break;
            }

            if (controller.signal.aborted) break;
          }
        } catch (error) {
          log.warn('Terminal stream ended with an error', {
            sessionId: session.id,
            error: String(error),
          });
          send({
            type: 'error',
            message:
              'The connection to the sandbox dropped. Reopen the terminal — your files are untouched.',
          });
        } finally {
          await persist();

          // A disconnect is not an exit: the shell keeps running so a reconnect
          // lands back in the same session. Only a real exit closes the row.
          if (exitCode !== null) {
            await db
              .update(terminalSessions)
              .set({ isActive: false, exitCode, closedAt: new Date() })
              .where(eq(terminalSessions.id, session.id))
              .catch(() => undefined);
          }

          await touchSandbox(sandbox.id).catch(() => undefined);
          req.signal.removeEventListener('abort', onClientAbort);

          try {
            streamController.close();
          } catch {
            /* already closed by the client disconnecting */
          }
        }
      },

      cancel() {
        controller.abort();
      },
    });

    return new Response(stream, { headers: { ...SSE_HEADERS } });
  },
);
