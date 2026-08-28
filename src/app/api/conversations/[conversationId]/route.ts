import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { requireConversationAccess } from '@/app/api/_shared/conversation-access';
import { routeParam, serializeConversation } from '@/app/api/_shared/route-helpers';
import { countChanges } from '@/lib/agent/tools';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { db } from '@/lib/db';
import {
  agentRuns,
  conversations,
  messageAttachments,
  messages,
  models,
  toolCalls,
  type Message,
} from '@/lib/db/schema';
import type {
  ChatFileChangeView,
  ChatMessageView,
  ChatToolCallView,
  PlanStepStatus,
  StreamUsage,
} from '@/lib/types/agent';

/**
 * `/api/conversations/[conversationId]` — load, rename, archive.
 *
 * `GET` rebuilds the exact transcript the user saw while it was streaming:
 * every persisted event type (text, thinking, tool calls, plan steps, usage)
 * is folded back into one `ChatMessageView` per message, so a page reload is
 * indistinguishable from having watched the run live.
 */

export const dynamic = 'force-dynamic';

export const GET = defineHandler({ auth: 'required' }, async ({ params }) => {
  const conversationId = routeParam(params, 'conversationId');
  const access = await requireConversationAccess(conversationId, 'project.read');

  const rows = await db
    .select({ message: messages, modelSlug: models.slug, modelName: models.displayName })
    .from(messages)
    .leftJoin(models, eq(messages.modelId, models.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sequence), asc(messages.createdAt))
    .limit(1_000);

  const messageIds = rows.map((row) => row.message.id);

  const calls = messageIds.length
    ? await db
        .select()
        .from(toolCalls)
        .where(inArray(toolCalls.messageId, messageIds))
        .orderBy(asc(toolCalls.sequence))
    : [];

  const attachments = messageIds.length
    ? await db
        .select()
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, messageIds))
    : [];

  const runs = await db
    .select({ id: agentRuns.id, steps: agentRuns.steps, status: agentRuns.status })
    .from(agentRuns)
    .where(eq(agentRuns.conversationId, conversationId))
    .orderBy(asc(agentRuns.createdAt))
    .limit(500);

  const stepsByRun = new Map(runs.map((run) => [run.id, run.steps]));

  const views: ChatMessageView[] = rows.map((row) => {
    const message = row.message;
    const messageCalls = calls.filter((call) => call.messageId === message.id);
    const planSteps = message.runId ? stepsByRun.get(message.runId) : undefined;

    return {
      id: message.id,
      role: message.role,
      content: message.content,
      thinking: message.thinking ?? undefined,
      status: message.status,
      createdAt: message.createdAt.toISOString(),
      modelSlug: row.modelSlug ?? undefined,
      modelDisplayName: row.modelName ?? undefined,
      agentMode: message.agentMode ?? undefined,
      toolCalls: messageCalls.map(toToolCallView),
      fileChanges: messageCalls.flatMap(toFileChangeViews),
      planSteps: planSteps?.length
        ? planSteps.map((step) => ({
            id: step.id,
            title: step.title,
            status: step.status as PlanStepStatus,
            detail: step.detail,
          }))
        : undefined,
      usage: toUsageView(message),
      error: message.errorMessage
        ? { code: 'internal' as const, message: message.errorMessage, retryable: true }
        : undefined,
      attachments: attachments
        .filter((attachment) => attachment.messageId === message.id)
        .map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          inlineContent: attachment.inlineContent ?? undefined,
        })),
    };
  });

  return json({
    conversation: serializeConversation(access.conversation),
    project: { id: access.project.id, name: access.project.name, slug: access.project.slug },
    role: access.role,
    messages: views,
  });
});

const patchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  modelId: z.string().trim().max(64).nullish(),
  agentMode: z.enum(['ask', 'plan', 'build', 'auto']).optional(),
  isPinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const PATCH = defineHandler(
  { auth: 'required', body: patchBody },
  async ({ params, body }) => {
    const conversationId = routeParam(params, 'conversationId');
    await requireConversationAccess(conversationId, 'agent.run');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.modelId !== undefined) patch.modelId = body.modelId ?? null;
    if (body.agentMode !== undefined) patch.agentMode = body.agentMode;
    if (body.isPinned !== undefined) patch.isPinned = body.isPinned;
    if (body.archived !== undefined) patch.archivedAt = body.archived ? new Date() : null;

    const updated = await db
      .update(conversations)
      .set(patch)
      .where(eq(conversations.id, conversationId))
      .returning();

    const conversation = updated[0];
    if (!conversation) {
      throw new Error('The conversation disappeared while it was being updated.');
    }

    return json({ conversation: serializeConversation(conversation) });
  },
);

/**
 * Archives by default. `?purge=true` removes the transcript for good — the
 * messages, tool calls and runs cascade with it, so this is the one call that
 * genuinely loses history.
 */
const deleteQuery = z.object({
  purge: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const DELETE = defineHandler(
  { auth: 'required', query: deleteQuery },
  async ({ params, query }) => {
    const conversationId = routeParam(params, 'conversationId');
    await requireConversationAccess(conversationId, 'agent.run');

    if (query.purge) {
      await db.delete(conversations).where(eq(conversations.id, conversationId));
      return json({ deleted: true, archived: false });
    }

    const archivedAt = new Date();
    await db
      .update(conversations)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(eq(conversations.id, conversationId));

    return json({ deleted: false, archived: true, archivedAt: archivedAt.toISOString() });
  },
);

/* ------------------------------------------------------------------ *
 *  View builders
 * ------------------------------------------------------------------ */

function toToolCallView(call: typeof toolCalls.$inferSelect): ChatToolCallView {
  return {
    id: call.id,
    toolName: call.toolName,
    source: (call.source as ChatToolCallView['source']) ?? 'builtin',
    sourceRef: call.sourceRef ?? undefined,
    title: call.resultSummary || call.toolName,
    args: (call.args as Record<string, unknown>) ?? {},
    output: call.result ?? '',
    status: call.status,
    requiresApproval: call.requiresApproval,
    approvalReason: call.rejectedReason ?? undefined,
    isError: call.isError,
    exitCode: call.exitCode ?? undefined,
    durationMs: call.durationMs,
  };
}

const FILE_TOOLS: Record<string, ChatFileChangeView['kind']> = {
  write_file: 'modified',
  edit_file: 'modified',
  delete_file: 'deleted',
};

/**
 * File changes are derived from the tool calls that made them rather than
 * stored twice. The unified diff the tool returned is the same text the
 * Changes tab renders, so counting it here cannot drift from what was shown.
 */
function toFileChangeViews(call: typeof toolCalls.$inferSelect): ChatFileChangeView[] {
  const kind = FILE_TOOLS[call.toolName];
  if (!kind) return [];

  const args = (call.args as Record<string, unknown> | null) ?? {};
  const path = typeof args.path === 'string' ? args.path : null;
  if (!path) return [];

  const output = call.result ?? '';
  const looksLikeDiff = output.includes('@@') || output.startsWith('Index:');
  const { additions, deletions } = looksLikeDiff
    ? countChanges(output)
    : { additions: 0, deletions: 0 };

  return [
    {
      path,
      kind:
        call.toolName === 'write_file' && additions > 0 && deletions === 0 ? 'created' : kind,
      additions,
      deletions,
      pending: call.status === 'awaiting_approval',
      diff: looksLikeDiff ? output : undefined,
    },
  ];
}

function toUsageView(message: Message): StreamUsage | undefined {
  if (message.role !== 'assistant') return undefined;
  if (!message.inputTokens && !message.outputTokens && !message.weightedTokens)
    return undefined;

  return {
    inputTokens: message.inputTokens,
    outputTokens: message.outputTokens,
    cachedInputTokens: message.cachedInputTokens,
    weightedTokens: message.weightedTokens,
    chargedMicroUsd: message.chargedMicroUsd,
    upstreamCostMicroUsd: message.upstreamCostMicroUsd,
    settlement: message.chargedMicroUsd > 0 ? 'payg' : 'quota',
    explanation: `${message.inputTokens.toLocaleString('en-US')} input + ${message.outputTokens.toLocaleString(
      'en-US',
    )} output = ${message.weightedTokens.toLocaleString('en-US')} weighted tokens`,
    latencyMs: message.latencyMs,
    timeToFirstTokenMs: message.timeToFirstTokenMs ?? undefined,
  };
}
