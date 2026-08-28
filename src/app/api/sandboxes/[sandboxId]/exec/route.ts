import { z } from 'zod';

import { routeParam } from '@/app/api/_shared/route-helpers';
import { requireSandboxAccess } from '@/app/api/_shared/sandbox-access';
import { evaluateCommand, resolveAgentPermissions } from '@/lib/agent/policy';
import { ConflictError, ForbiddenError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { rehydrateProvider, startSandbox, touchSandbox } from '@/lib/sandbox/service';
import { SETTING_KEYS, getSetting, settingDefault } from '@/lib/settings';

/**
 * `POST /api/sandboxes/[sandboxId]/exec` — run one command and wait for it.
 *
 * This is the *user's* terminal, not the agent's, and the policy is applied
 * accordingly:
 *
 *  · **`deny` verdicts are enforced.** Those rules exist to stop a sandbox
 *    escape — mounting the docker socket, reading cloud metadata, sharing host
 *    namespaces — and they are not the user's to waive.
 *  · **`confirm` verdicts are allowed and audited.** `rm -rf build/` needs a
 *    confirmation step when an *agent* proposes it; when a human types it into
 *    their own machine, the typing was the confirmation. Blocking it would just
 *    teach people that the terminal is broken.
 *
 * A sleeping sandbox is woken automatically rather than returning an error —
 * "run this" is an unambiguous instruction to have a machine.
 */

export const dynamic = 'force-dynamic';

const body = z.object({
  command: z.string().trim().min(1, 'Type a command to run.').max(8_000),
  cwd: z.string().trim().max(1_024).optional(),
  shell: z.enum(['bash', 'sh', 'powershell', 'cmd']).optional(),
  timeoutSeconds: z.number().int().min(1).max(900).optional(),
});

export const POST = defineHandler(
  { auth: 'required', rateLimit: 'terminal.command', body },
  async ({ params, body: input, user }) => {
    const sandboxId = routeParam(params, 'sandboxId');
    const access = await requireSandboxAccess(sandboxId, 'terminal.use');

    /* ---- Policy ------------------------------------------------------- */

    const permissions = {
      ...resolveAgentPermissions(
        (access.project?.permissions ?? null) as Parameters<typeof resolveAgentPermissions>[0],
        'auto',
      ),
      // The human at the keyboard is the confirmation.
      autoApproveCommands: true,
      autoApproveEdits: true,
      runCommands: true,
    };

    const verdict = evaluateCommand(input.command, permissions);

    if (verdict.decision === 'deny') {
      await recordAudit({
        action: AUDIT_ACTIONS.sandboxCommandDenied,
        teamId: access.team.id,
        userId: user.id,
        resourceType: 'sandbox',
        resourceId: access.sandbox.id,
        severity: 'warning',
        summary: `Blocked: ${input.command.slice(0, 120)}`,
        metadata: { rule: verdict.rule, reason: verdict.reason },
      });

      throw new ForbiddenError(verdict.reason, {
        title: 'Command blocked',
        description:
          'This command would break the sandbox boundary, so Karo will not run it. Rewrite it to work inside /workspace.',
        details: { rule: verdict.rule },
      });
    }

    /* ---- Make sure there is a machine --------------------------------- */

    let sandbox = access.sandbox;
    let woken = false;

    if (sandbox.status === 'sleeping' || sandbox.status === 'stopped') {
      sandbox = await startSandbox(sandbox.id, { userId: user.id, reason: 'exec' });
      woken = true;
    } else if (sandbox.status !== 'running') {
      throw new ConflictError(`The sandbox is ${sandbox.status}.`, {
        title: 'Sandbox is not ready',
        description:
          sandbox.status === 'failed'
            ? 'It failed to start. Restart it from the Sandboxes panel, and check the status message for the reason.'
            : 'Give it a moment to finish coming up, then run the command again.',
        details: { status: sandbox.status },
      });
    }

    /* ---- Run ----------------------------------------------------------- */

    const defaultTimeout = await getSetting(
      SETTING_KEYS.agentToolTimeoutSeconds,
      settingDefault(SETTING_KEYS.agentToolTimeoutSeconds),
    );

    const result = await rehydrateProvider(sandbox).execute(sandbox.id, {
      command: input.command,
      shell: input.shell ?? access.project?.defaultShell ?? 'bash',
      cwd: input.cwd,
      timeoutSeconds: input.timeoutSeconds ?? defaultTimeout,
    });

    await touchSandbox(sandbox.id);

    await recordAudit({
      action: AUDIT_ACTIONS.sandboxCommand,
      teamId: access.team.id,
      userId: user.id,
      resourceType: 'sandbox',
      resourceId: sandbox.id,
      severity: verdict.decision === 'confirm' ? 'notice' : 'info',
      summary: `$ ${input.command.slice(0, 160)}`,
      metadata: {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        rule: verdict.rule,
        projectId: access.project?.id ?? null,
      },
    });

    return json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      truncated: result.truncated,
      sandboxWoken: woken,
      /** Set when the policy flagged the command as destructive but let it run. */
      warning: verdict.decision === 'confirm' ? verdict.reason : null,
    });
  },
);
