import { asc, eq } from 'drizzle-orm';

import { requireConversationAccess } from '@/app/api/_shared/conversation-access';
import { routeParam } from '@/app/api/_shared/route-helpers';
import { resolveModel } from '@/lib/ai';
import type { ChatMessage } from '@/lib/ai/types';
import { ConflictError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';
import { createLogger } from '@/lib/logger';
import { loadBillingContext, recordModelUsage } from '@/lib/usage/metering';

/**
 * `POST /api/conversations/[conversationId]/compact` — summarise the history.
 *
 * Compacting is **non-destructive**. Nothing is deleted; a `system` message
 * holding the summary is appended at the end of the transcript.
 *
 * That works because of how the runtime builds context: it walks messages
 * newest-first until it has filled its token budget. A summary written at the
 * *end* is therefore always in scope, while the raw turns it replaced fall out
 * naturally as the conversation grows. The user keeps every word they wrote,
 * and the agent keeps the meaning of the words it can no longer afford to read.
 *
 * The summary itself is a real model call, metered like any other. If the
 * provider is unavailable the route still succeeds with a deterministic
 * transcript digest — a slightly worse summary beats a failed action.
 */

export const dynamic = 'force-dynamic';

const log = createLogger('api:compact');

/** Turns kept verbatim in the prompt; older ones are what compacting is for. */
const SUMMARY_INPUT_LIMIT = 60;

export const POST = defineHandler(
  { auth: 'required', rateLimit: 'chat.message' },
  async ({ params, user }) => {
    const conversationId = routeParam(params, 'conversationId');
    const access = await requireConversationAccess(conversationId, 'agent.run');
    const { conversation, project, team } = access;

    const history = await db
      .select({
        role: messages.role,
        content: messages.content,
        sequence: messages.sequence,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.sequence))
      .limit(500);

    const usable = history.filter(
      (row) =>
        row.content.trim().length > 0 && (row.role === 'user' || row.role === 'assistant'),
    );

    if (usable.length < 4) {
      throw new ConflictError('There is not enough history to compact yet.', {
        title: 'Nothing to compact',
        description:
          'Compacting condenses a long conversation so the agent keeps its context. Come back after a few more turns.',
      });
    }

    const transcript = usable
      .slice(-SUMMARY_INPUT_LIMIT)
      .map((row) => `${row.role === 'user' ? 'User' : 'Assistant'}: ${row.content}`)
      .join('\n\n');

    let summary = '';
    let usedModel: string | null = null;

    try {
      const model = await resolveModel({ modelId: conversation.modelId, userId: user.id });
      const billing = await loadBillingContext(team.id);
      const startedAt = Date.now();

      const prompt: ChatMessage[] = [
        {
          role: 'system',
          content:
            'You compress engineering conversations. Produce a dense summary that another AI agent can use as its only memory of what happened. Cover: what the user is building, decisions already made, files and commands that matter, what is done, and what is still outstanding. Keep concrete names, paths and numbers. No preamble, no closing remarks.',
        },
        {
          role: 'user',
          content: `Project: ${project.name}\n${project.description || ''}\n\nConversation so far:\n\n${transcript}`,
        },
      ];

      let counts = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
      };

      for await (const chunk of model.provider.stream({
        modelSlug: model.modelSlug,
        messages: prompt,
        maxOutputTokens: Math.min(model.maxOutputTokens || 2_048, 2_048),
        requestId: conversationId,
        apiKey: model.byok?.apiKey,
        baseUrl: model.byok?.baseUrl,
      })) {
        if (chunk.type === 'text') summary += chunk.text;
        else if (chunk.type === 'usage') counts = chunk.usage;
      }

      usedModel = model.modelSlug;

      await recordModelUsage({
        context: billing,
        userId: user.id,
        projectId: project.id,
        conversationId,
        providerKey: model.providerKey,
        modelId: model.modelId,
        modelSlug: model.modelSlug,
        modelPriceId: model.priceId,
        counts,
        prices: model.prices,
        usedByok: Boolean(model.byok),
        latencyMs: Date.now() - startedAt,
        status: 'success',
      });
    } catch (error) {
      log.warn('Model summarisation failed — falling back to a transcript digest', {
        conversationId,
        error: String(error),
      });
    }

    if (!summary.trim()) summary = digest(usable, project.name);

    /* ---- Persist -------------------------------------------------------- */

    const sequence = conversation.messageCount + 1;
    const summaryMessageId = newId(ID_PREFIX.message);
    const now = new Date();

    await db.insert(messages).values({
      id: summaryMessageId,
      conversationId,
      role: 'system',
      content: `Summary of this conversation so far (compacted ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC):\n\n${summary.trim()}`,
      status: 'complete',
      sequence,
    });

    await db
      .update(conversations)
      .set({
        summary: summary.trim(),
        messageCount: sequence,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversationId));

    return json({
      summary: summary.trim(),
      messageId: summaryMessageId,
      summarisedMessages: usable.length,
      model: usedModel,
      /** Nothing was removed — say so, so the UI can reassure the user. */
      messagesRemoved: 0,
    });
  },
);

/**
 * Offline fallback. Not as good as a model summary, but it preserves the shape
 * of the conversation — who asked for what, and what the agent last said.
 */
function digest(rows: Array<{ role: string; content: string }>, projectName: string): string {
  const asks = rows
    .filter((row) => row.role === 'user')
    .slice(-12)
    .map((row) => `- ${firstLine(row.content)}`);

  const lastAssistant = rows.filter((row) => row.role === 'assistant').at(-1);

  return [
    `Project: ${projectName}.`,
    '',
    'What the user has asked for, in order:',
    ...asks,
    '',
    lastAssistant
      ? `Where the agent left off: ${firstLine(lastAssistant.content, 400)}`
      : 'The agent has not replied yet.',
    '',
    'This digest was generated locally because the summarisation model was unavailable.',
  ].join('\n');
}

function firstLine(text: string, max = 160): string {
  const line =
    text
      .split('\n')
      .find((candidate) => candidate.trim().length > 0)
      ?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
