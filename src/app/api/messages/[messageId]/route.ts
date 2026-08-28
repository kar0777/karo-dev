import { and, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { requireConversationAccess } from '@/app/api/_shared/conversation-access';
import { routeParam } from '@/app/api/_shared/route-helpers';
import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema';

/**
 * `DELETE /api/messages/[messageId]` — truncate the conversation from here.
 *
 * This is the "edit and resend" primitive. Editing a turn invalidates every
 * reply that was based on it, so the only honest thing to do is remove this
 * message and everything after it, then let the client post the edited text as
 * a fresh turn. Keeping the later replies would show the user an answer to a
 * question they no longer asked.
 *
 * `?keep=true` deletes only what came *after* the message, which is what
 * "retry this response" needs: the user's question survives, the answer goes.
 *
 * Tool calls and attachments cascade with their messages; the conversation's
 * counters are recomputed rather than decremented so a partial failure cannot
 * leave the sidebar showing a count nothing can reach.
 */

export const dynamic = 'force-dynamic';

const query = z.object({
  keep: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const DELETE = defineHandler(
  { auth: 'required', query },
  async ({ params, query: q }) => {
    const messageId = routeParam(params, 'messageId');

    const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    const message = rows[0];

    if (!message) {
      throw new NotFoundError('Message not found.', {
        title: 'Message not found',
        description:
          'It has already been removed. Reload the conversation to see the current thread.',
      });
    }

    const access = await requireConversationAccess(message.conversationId, 'agent.run');

    const fromSequence = q.keep ? message.sequence + 1 : message.sequence;

    const removed = await db
      .delete(messages)
      .where(
        and(
          eq(messages.conversationId, message.conversationId),
          gte(messages.sequence, fromSequence),
        ),
      )
      .returning({ id: messages.id });

    // Recompute rather than subtract: the counters drive quota copy and the
    // sequence of the next message, and both must match what is actually stored.
    const [totals] = await db
      .select({
        count: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${messages.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${messages.outputTokens}), 0)::int`,
        weightedTokens: sql<number>`coalesce(sum(${messages.weightedTokens}), 0)::bigint`,
        chargedMicroUsd: sql<number>`coalesce(sum(${messages.chargedMicroUsd}), 0)::bigint`,
        lastMessageAt: sql<Date | null>`max(${messages.createdAt})`,
      })
      .from(messages)
      .where(eq(messages.conversationId, message.conversationId));

    await db
      .update(conversations)
      .set({
        messageCount: totals?.count ?? 0,
        totalInputTokens: Number(totals?.inputTokens ?? 0),
        totalOutputTokens: Number(totals?.outputTokens ?? 0),
        totalWeightedTokens: Number(totals?.weightedTokens ?? 0),
        totalChargedMicroUsd: Number(totals?.chargedMicroUsd ?? 0),
        lastMessageAt: totals?.lastMessageAt ? new Date(totals.lastMessageAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, message.conversationId));

    return json({
      deleted: removed.length,
      fromSequence,
      conversationId: message.conversationId,
      messageCount: totals?.count ?? 0,
      projectId: access.project.id,
    });
  },
);
