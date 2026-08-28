import { and, desc, eq, inArray } from 'drizzle-orm';

import { abortRun } from '@/app/api/_shared/active-runs';
import { requireConversationAccess } from '@/app/api/_shared/conversation-access';
import { routeParam } from '@/app/api/_shared/route-helpers';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { db } from '@/lib/db';
import { agentRuns, messages } from '@/lib/db/schema';

/**
 * `POST /api/conversations/[conversationId]/stop` — cancel the run in flight.
 *
 * Aborting the controller is the real mechanism: `runAgent` notices the signal
 * between chunks, stops asking the provider for more tokens, and writes the run
 * out as `cancelled`. Nothing further is charged.
 *
 * The database sweep afterwards is a *repair*, not the primary path. It exists
 * because a process can die mid-run and leave a row claiming to be `running`
 * forever — which would show a spinner that never resolves the next time the
 * user opens the chat. Rows older than the request that could not have an owner
 * are closed out here.
 */

export const dynamic = 'force-dynamic';

export const POST = defineHandler(
  {
    auth: 'required',
    audit: { action: AUDIT_ACTIONS.agentRunCancel, resourceType: 'conversation' },
  },
  async ({ params, setAudit }) => {
    const conversationId = routeParam(params, 'conversationId');
    const access = await requireConversationAccess(conversationId, 'agent.run');

    const { stopped, runId } = abortRun(conversationId);

    // Close out anything still marked live in the database. When the stream is
    // in this process `runAgent` will also write its own final state; both
    // paths converge on `cancelled`, so the order does not matter.
    const finishedAt = new Date();
    const cancelled = await db
      .update(agentRuns)
      .set({
        status: 'cancelled',
        stopReason: 'stopped_by_user',
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(agentRuns.conversationId, conversationId),
          inArray(agentRuns.status, ['queued', 'running']),
        ),
      )
      .returning({ id: agentRuns.id });

    await db
      .update(messages)
      .set({ status: 'stopped', finishReason: 'stopped_by_user', updatedAt: finishedAt })
      .where(
        and(
          eq(messages.conversationId, conversationId),
          inArray(messages.status, ['pending', 'streaming']),
        ),
      );

    const [latest] = await db
      .select({ id: agentRuns.id, status: agentRuns.status })
      .from(agentRuns)
      .where(eq(agentRuns.conversationId, conversationId))
      .orderBy(desc(agentRuns.createdAt))
      .limit(1);

    setAudit({
      teamId: access.team.id,
      resourceId: conversationId,
      severity: 'notice',
      summary: stopped
        ? 'Stopped the running agent response'
        : 'Requested a stop with no run in flight',
      metadata: { runId, cancelledRuns: cancelled.length, projectId: access.project.id },
    });

    return json({
      stopped,
      runId: runId ?? latest?.id ?? null,
      cancelledRuns: cancelled.length,
      // False means the run had already finished — the UI should just refresh
      // rather than showing an error.
      hadActiveRun: stopped || cancelled.length > 0,
    });
  },
);
