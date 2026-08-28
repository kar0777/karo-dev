import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { routeParam, serializeConversation } from '@/app/api/_shared/route-helpers';
import { defineHandler } from '@/lib/api/handler';
import { created, json } from '@/lib/api/responses';
import { requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { conversations } from '@/lib/db/schema';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * `/api/projects/[projectId]/conversations` — the chat list for one project.
 *
 * Conversations are per-project rather than per-user-per-project: a teammate
 * opening the workspace should be able to read what the agent was asked to do,
 * because the agent's edits are already in their branch. Creating one is
 * deliberately cheap — no model call, no sandbox — so "New chat" is instant.
 */

export const dynamic = 'force-dynamic';

const listQuery = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const GET = defineHandler(
  { auth: 'required', query: listQuery },
  async ({ params, query }) => {
    const projectId = routeParam(params, 'projectId');
    await requireApiProjectAccess(projectId, 'project.read');

    const rows = await db
      .select()
      .from(conversations)
      .where(
        query.includeArchived
          ? eq(conversations.projectId, projectId)
          : and(eq(conversations.projectId, projectId), isNull(conversations.archivedAt)),
      )
      .orderBy(desc(conversations.isPinned), desc(conversations.updatedAt))
      .limit(200);

    return json({ conversations: rows.map(serializeConversation) });
  },
);

const createBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  modelId: z.string().trim().max(64).nullish(),
  agentMode: z.enum(['ask', 'plan', 'build', 'auto']).optional(),
});

export const POST = defineHandler(
  { auth: 'required', body: createBody },
  async ({ params, body, user }) => {
    const projectId = routeParam(params, 'projectId');
    const access = await requireApiProjectAccess(projectId, 'agent.run');

    const conversationId = newId(ID_PREFIX.conversation);

    const inserted = await db
      .insert(conversations)
      .values({
        id: conversationId,
        projectId,
        userId: user.id,
        // Left as "New chat" so the first message can name it automatically.
        title: body.title ?? 'New chat',
        modelId: body.modelId ?? access.project.defaultModelId,
        agentMode: body.agentMode ?? access.project.defaultAgentMode,
      })
      .returning();

    const conversation = inserted[0];
    if (!conversation) {
      throw new Error('The conversation could not be created.');
    }

    return created({ conversation: serializeConversation(conversation) });
  },
);
