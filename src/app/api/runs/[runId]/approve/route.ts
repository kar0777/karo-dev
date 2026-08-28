import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { routeParam } from '@/app/api/_shared/route-helpers';
import { normalizeWorkspacePath, resolveAgentPermissions } from '@/lib/agent/policy';
import { BUILTIN_TOOL_HANDLERS, type ToolContext } from '@/lib/agent/tools';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { agentRuns, projectFiles, sandboxes, toolCalls } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { rehydrateProvider } from '@/lib/sandbox/service';
import type { ChatFileChangeView } from '@/lib/types/agent';

/**
 * `POST /api/runs/[runId]/approve` — decide on a tool call the agent paused on.
 *
 * When a tool hits a `confirm` verdict the runtime stops the loop and persists
 * the call as `awaiting_approval`. Approving here **actually runs it**: the same
 * handler, the same arguments, the same sandbox — only with the auto-approve
 * flags raised, because the human just supplied the approval those flags stand
 * in for. Anything else would mean the button only *looked* like it did
 * something.
 *
 * Rejecting discards the proposal, including any pending file content the tool
 * had staged, so the Changes tab and the chat agree on what happened.
 */

export const dynamic = 'force-dynamic';

const log = createLogger('api:approval');

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'delete_file']);

const body = z.object({
  toolCallId: z.string().min(1).max(64),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional(),
});

export const POST = defineHandler(
  {
    auth: 'required',
    body,
    audit: { action: AUDIT_ACTIONS.agentToolApprove, resourceType: 'tool_call' },
  },
  async ({ params, body: input, user, setAudit }) => {
    const runId = routeParam(params, 'runId');

    const runRows = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
    const run = runRows[0];
    if (!run) {
      throw new NotFoundError('Agent run not found.', {
        title: 'Run not found',
        description:
          'This run is no longer available. Reload the conversation to see its state.',
      });
    }

    const access = await requireApiProjectAccess(run.projectId, 'agent.approve');

    const callRows = await db
      .select()
      .from(toolCalls)
      .where(and(eq(toolCalls.id, input.toolCallId), eq(toolCalls.runId, runId)))
      .limit(1);

    const call = callRows[0];
    if (!call) {
      throw new NotFoundError('Tool call not found in this run.', {
        title: 'Nothing to approve',
        description: 'This step is not part of the run. Reload the conversation and try again.',
      });
    }

    if (call.status !== 'awaiting_approval') {
      throw new ConflictError(`This step was already ${call.status}.`, {
        title: 'Already decided',
        description:
          'Someone on your team — or you, in another tab — has already answered this. Reload the conversation to see the outcome.',
        details: { status: call.status },
      });
    }

    const args = (call.args as Record<string, unknown> | null) ?? {};
    const now = new Date();

    /* ---- Reject --------------------------------------------------------- */

    if (input.decision === 'reject') {
      await db
        .update(toolCalls)
        .set({
          status: 'rejected',
          rejectedReason: input.reason ?? 'Rejected by a reviewer.',
          resultSummary: 'Rejected before it ran',
          approvedById: user.id,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(toolCalls.id, call.id));

      const discarded = await discardPendingFile(run.projectId, call.toolName, args);
      await settleRun(runId, run.status);

      // Approve and reject are different events; `setAudit` can only enrich the
      // configured action, so the rejection is written by hand.
      setAudit({ record: false });
      await recordAudit({
        action: AUDIT_ACTIONS.agentToolReject,
        teamId: access.team.id,
        userId: user.id,
        resourceType: 'tool_call',
        resourceId: call.id,
        severity: 'notice',
        summary: `Rejected ${call.toolName}`,
        metadata: { runId, toolName: call.toolName, reason: input.reason, discarded },
      });

      return json({
        toolCallId: call.id,
        decision: 'reject' as const,
        status: 'rejected' as const,
        discardedPath: discarded,
        fileChanges: [] as ChatFileChangeView[],
      });
    }

    /* ---- Approve: run it for real --------------------------------------- */

    const handler = BUILTIN_TOOL_HANDLERS[call.toolName];
    if (!handler) {
      throw new ConflictError(`Karo no longer provides the "${call.toolName}" tool.`, {
        title: 'Tool unavailable',
        description:
          'The tool this step needs is not installed any more. Reject the step and ask the agent for another approach.',
      });
    }

    const sandboxRows = await db
      .select()
      .from(sandboxes)
      .where(and(eq(sandboxes.projectId, run.projectId), eq(sandboxes.status, 'running')))
      .limit(1);
    const sandbox = sandboxRows[0] ?? null;

    // The reviewer *is* the approval, so the auto-approve gates are raised for
    // this single call. Every other permission — network, docker, delete — is
    // still whatever the project grants.
    const permissions = {
      ...resolveAgentPermissions(
        access.project.permissions as Parameters<typeof resolveAgentPermissions>[0],
        run.mode,
      ),
      autoApproveEdits: true,
      autoApproveCommands: true,
    };

    const fileChanges: ChatFileChangeView[] = [];
    const context: ToolContext = {
      projectId: run.projectId,
      sandboxId: sandbox?.id ?? null,
      provider: sandbox ? rehydrateProvider(sandbox) : null,
      permissions,
      knownSecrets: Object.values(
        (access.project.envVars as Record<string, string> | null) ?? {},
      ).filter((value) => typeof value === 'string' && value.length >= 8),
      runId,
      onFileChange: (change) => fileChanges.push(change),
    };

    const startedAt = Date.now();
    let result;
    try {
      result = await handler(args, context);
    } catch (error) {
      log.error('Approved tool call failed', {
        runId,
        toolCallId: call.id,
        error: String(error),
      });
      result = {
        output: error instanceof Error ? error.message : 'The tool failed after approval.',
        summary: 'Failed after approval',
        isError: true,
      };
    }

    const durationMs = Date.now() - startedAt;

    await db
      .update(toolCalls)
      .set({
        result: result.output.slice(0, 100_000),
        resultSummary: result.summary,
        status: result.isError ? 'failed' : 'succeeded',
        isError: result.isError,
        exitCode: result.exitCode ?? null,
        durationMs,
        approvedById: user.id,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(toolCalls.id, call.id));

    await settleRun(runId, run.status);

    setAudit({
      teamId: access.team.id,
      resourceId: call.id,
      summary: `Approved and ran ${call.toolName}`,
      metadata: {
        runId,
        toolName: call.toolName,
        durationMs,
        isError: result.isError,
        sandboxId: sandbox?.id ?? null,
      },
    });

    return json({
      toolCallId: call.id,
      decision: 'approve' as const,
      status: result.isError ? ('failed' as const) : ('succeeded' as const),
      summary: result.summary,
      output: result.output.slice(0, 24_000),
      isError: result.isError,
      exitCode: result.exitCode ?? null,
      durationMs,
      fileChanges,
      /** True when the agent needs another turn to continue from here. */
      needsFollowUp: !result.isError,
    });
  },
);

/**
 * A rejected file tool leaves staged content behind. Clearing it keeps the
 * Changes tab from offering a diff the user has already said no to.
 */
async function discardPendingFile(
  projectId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  if (!FILE_TOOLS.has(toolName)) return null;
  if (typeof args.path !== 'string') return null;

  let path: string;
  try {
    path = normalizeWorkspacePath(args.path);
  } catch {
    return null;
  }

  const rows = await db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path)))
    .limit(1);

  const row = rows[0];
  if (!row || row.pendingChangeKind === null) return null;

  // A rejected *creation* has no earlier version to fall back to.
  if (row.pendingChangeKind === 'created' && row.version === 1 && row.content === '') {
    await db.delete(projectFiles).where(eq(projectFiles.id, row.id));
  } else {
    await db
      .update(projectFiles)
      .set({
        pendingContent: null,
        pendingChangeKind: null,
        pendingByRunId: null,
        updatedAt: new Date(),
      })
      .where(eq(projectFiles.id, row.id));
  }

  return path;
}

/**
 * A run that was parked on approval is finished once nothing is still waiting.
 * Leaving it `awaiting_approval` would keep a banner on screen with no button
 * left to press.
 */
async function settleRun(runId: string, currentStatus: string): Promise<void> {
  if (currentStatus !== 'awaiting_approval') return;

  const pending = await db
    .select({ id: toolCalls.id })
    .from(toolCalls)
    .where(and(eq(toolCalls.runId, runId), inArray(toolCalls.status, ['awaiting_approval'])))
    .limit(1);

  if (pending.length > 0) return;

  const now = new Date();
  await db
    .update(agentRuns)
    .set({ status: 'succeeded', finishedAt: now, updatedAt: now })
    .where(eq(agentRuns.id, runId));
}
