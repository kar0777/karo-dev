import 'server-only';

import { eq } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { requireApiProjectAccess, type ProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { conversations, type Conversation } from '@/lib/db/schema';
import type { Permission } from '@/lib/rbac/permissions';

/**
 * Resolves a conversation *and* the caller's right to touch it.
 *
 * Conversations are addressed by their own id, so authorisation has to travel
 * up to the project they belong to. A conversation the caller cannot reach and
 * a conversation that does not exist produce the identical 404 — anything else
 * would let a signed-in user probe for other teams' conversation ids.
 */
export type ConversationAccess = ProjectAccess & { conversation: Conversation };

export async function requireConversationAccess(
  conversationId: string,
  permission: Permission = 'project.read',
): Promise<ConversationAccess> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  const conversation = rows[0];
  if (!conversation) throw notFound();

  try {
    const access = await requireApiProjectAccess(conversation.projectId, permission);
    return { ...access, conversation };
  } catch (error) {
    // `requireApiProjectAccess` already collapses "not yours" into 404; re-word
    // it so the message names the thing the caller actually asked for.
    if (error instanceof NotFoundError) throw notFound();
    throw error;
  }
}

function notFound(): NotFoundError {
  return new NotFoundError('Conversation not found.', {
    title: 'Conversation not found',
    description:
      'This chat was deleted, or it belongs to a project you are not a member of. Pick another chat from the sidebar.',
  });
}
