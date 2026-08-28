import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { routeParam } from '@/app/api/_shared/route-helpers';
import { requireTerminalAccess } from '@/app/api/_shared/terminal-access';
import { evaluateCommand, resolveAgentPermissions } from '@/lib/agent/policy';
import { ConflictError, ForbiddenError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { terminalSessions } from '@/lib/db/schema';
import { rehydrateProvider, touchSandbox } from '@/lib/sandbox/service';

/**
 * `POST /api/terminal/[sessionId]/input` — keystrokes into the pty.
 *
 * Rate-limited under `api.default` rather than `terminal.command`: this is a
 * keystroke channel, and a 120/minute command budget would cut off anyone
 * typing at normal speed. The command budget belongs on `/exec`, which submits
 * whole commands.
 *
 * Policy still applies. When the payload ends in Enter, the line being
 * submitted is checked against the same deny rules the agent faces — those
 * rules protect the sandbox boundary, and a pty is not a way around them.
 * Destructive-but-legitimate commands go through: a human typing `rm -rf` into
 * their own shell has already confirmed it.
 */

export const dynamic = 'force-dynamic';

const body = z.object({
  data: z.string().max(8_000),
});

export const POST = defineHandler(
  { auth: 'required', rateLimit: 'api.default', body },
  async ({ params, body: input, user }) => {
    const sessionId = routeParam(params, 'sessionId');
    const access = await requireTerminalAccess(sessionId);
    const { session, sandbox } = access;

    if (!session.isActive) {
      throw new ConflictError('This terminal has exited.', {
        title: 'Terminal closed',
        description: 'The shell finished. Open a new terminal to keep working.',
      });
    }
    if (sandbox.status !== 'running') {
      throw new ConflictError(`The sandbox is ${sandbox.status}.`, {
        title: 'Sandbox is not running',
        description: 'Start the sandbox, then reconnect this terminal.',
        details: { status: sandbox.status },
      });
    }

    /* ---- Check the line being submitted -------------------------------- */

    const submitted = submittedLine(input.data);
    let history = session.history;

    if (submitted) {
      const permissions = {
        ...resolveAgentPermissions(
          (access.project?.permissions ?? null) as Parameters<
            typeof resolveAgentPermissions
          >[0],
          'auto',
        ),
        autoApproveCommands: true,
        autoApproveEdits: true,
        runCommands: true,
      };

      const verdict = evaluateCommand(submitted, permissions);
      if (verdict.decision === 'deny') {
        await recordAudit({
          action: AUDIT_ACTIONS.sandboxCommandDenied,
          teamId: access.team.id,
          userId: user.id,
          resourceType: 'sandbox',
          resourceId: sandbox.id,
          severity: 'warning',
          summary: `Blocked in terminal: ${submitted.slice(0, 120)}`,
          metadata: { rule: verdict.rule, reason: verdict.reason, sessionId: session.id },
        });

        throw new ForbiddenError(verdict.reason, {
          title: 'Command blocked',
          description:
            'This command would break the sandbox boundary, so Karo will not run it. Rewrite it to work inside /workspace.',
          details: { rule: verdict.rule },
        });
      }

      history = [...session.history, submitted].slice(-200);
    }

    await rehydrateProvider(sandbox).writeTerminal(sandbox.id, session.id, input.data);

    await db
      .update(terminalSessions)
      .set({
        lastActiveAt: new Date(),
        ...(submitted ? { history } : {}),
      })
      .where(eq(terminalSessions.id, session.id));

    await touchSandbox(sandbox.id);

    return json({ accepted: true, bytes: Buffer.byteLength(input.data, 'utf8') });
  },
);

/**
 * The line a payload submits, if any.
 *
 * xterm sends raw bytes: printable characters, control codes, escape
 * sequences. Only a payload ending in CR/LF actually runs something, and only
 * the text on that last line matters for policy.
 */
function submittedLine(data: string): string | null {
  if (!/[\r\n]$/.test(data)) return null;

  const line = data
    .replace(/\r?\n$/, '')
    .replace(/\r$/, '')
    // Strip CSI escape sequences (cursor moves, colours) before matching.
    .replace(/\[[0-9;?]*[a-zA-Z]/g, '')
    .trim();

  return line.length > 0 ? line : null;
}
