import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import { iso } from '@/app/api/_shared/route-helpers';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getActiveTeam, requireApiProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { conversations, messages, projects } from '@/lib/db/schema';

/**
 * `GET /api/conversations/search?q=` — search across a team's chats.
 *
 * Scoped to the caller's active team through a join on `projects`, so the query
 * can never reach a conversation the user has no membership for. Titles and
 * message bodies are both searched; a title hit ranks above a body hit because
 * naming a chat is a deliberate act and usually what the user is recalling.
 *
 * `ILIKE` rather than full-text search: chat transcripts are full of paths,
 * flags and identifiers that a language-aware stemmer mangles (`--force`,
 * `src/lib/db`, `useEffect`). Substring matching is what users expect here.
 */

export const dynamic = 'force-dynamic';

const query = z.object({
  q: z.string().trim().min(2, 'Type at least two characters.').max(200),
  projectId: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const GET = defineHandler({ auth: 'required', query }, async ({ user, query: q }) => {
  const limit = q.limit ?? 25;
  const pattern = `%${escapeLike(q.q)}%`;

  /**
   * Scope resolution.
   *
   * When `projectId` is given it is authorised on its own terms, through
   * `requireApiProjectAccess` — which joins `team_members` — rather than being
   * filtered against the caller's *active* team. Those are not the same thing:
   * `getActiveTeam` resolves to the personal team, so intersecting it with a
   * project belonging to a shared team produced an empty scope and this endpoint
   * answered `200 {results: []}`. The workspace then reported "0 in messages" for
   * a project full of matches — wrong, and silently so, which is worse than an
   * error. It also means an unauthorised id now 404s instead of masquerading as
   * a search with no hits.
   */
  const requestedProjectId = q.projectId;

  let scopedProjects: Array<{ id: string; name: string; slug: string }>;
  if (requestedProjectId) {
    const { project } = await requireApiProjectAccess(requestedProjectId);
    scopedProjects = [{ id: project.id, name: project.name, slug: project.slug }];
  } else {
    const { team } = await getActiveTeam(user.id);
    scopedProjects = await db
      .select({ id: projects.id, name: projects.name, slug: projects.slug })
      .from(projects)
      .where(eq(projects.teamId, team.id));
  }

  if (scopedProjects.length === 0) {
    return json({ results: [], query: q.q, total: 0 });
  }

  const projectIds = scopedProjects.map((project) => project.id);
  const projectById = new Map(scopedProjects.map((project) => [project.id, project]));

  const titleHits = await db
    .select({ conversation: conversations })
    .from(conversations)
    .where(
      and(
        inArray(conversations.projectId, projectIds),
        isNull(conversations.archivedAt),
        ilike(conversations.title, pattern),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);

  const bodyHits = await db
    .select({
      conversation: conversations,
      messageId: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        inArray(conversations.projectId, projectIds),
        isNull(conversations.archivedAt),
        ilike(messages.content, pattern),
        or(eq(messages.role, 'user'), eq(messages.role, 'assistant')),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit * 2);

  type Result = {
    conversationId: string;
    conversationTitle: string;
    projectId: string;
    projectName: string;
    projectSlug: string;
    matchedIn: 'title' | 'message';
    messageId: string | null;
    role: string | null;
    snippet: string;
    updatedAt: string | null;
  };

  const results: Result[] = [];
  const seen = new Set<string>();

  for (const hit of titleHits) {
    const project = projectById.get(hit.conversation.projectId);
    if (!project) continue;
    seen.add(hit.conversation.id);
    results.push({
      conversationId: hit.conversation.id,
      conversationTitle: hit.conversation.title,
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      matchedIn: 'title',
      messageId: null,
      role: null,
      snippet: hit.conversation.summary?.slice(0, 200) ?? hit.conversation.title,
      updatedAt: iso(hit.conversation.updatedAt),
    });
  }

  for (const hit of bodyHits) {
    if (results.length >= limit) break;
    // One row per conversation: twenty hits in the same chat is one result.
    if (seen.has(hit.conversation.id)) continue;
    const project = projectById.get(hit.conversation.projectId);
    if (!project) continue;

    seen.add(hit.conversation.id);
    results.push({
      conversationId: hit.conversation.id,
      conversationTitle: hit.conversation.title,
      projectId: project.id,
      projectName: project.name,
      projectSlug: project.slug,
      matchedIn: 'message',
      messageId: hit.messageId,
      role: hit.role,
      snippet: snippetAround(hit.content, q.q),
      updatedAt: iso(hit.createdAt),
    });
  }

  return json({ query: q.q, results: results.slice(0, limit), total: results.length });
});

/** `%` and `_` are wildcards in LIKE — a literal search must escape them. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** ~160 characters of context centred on the first occurrence. */
function snippetAround(content: string, needle: string): string {
  const index = content.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return content.slice(0, 160);

  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + needle.length + 100);
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${
    end < content.length ? '…' : ''
  }`;
}
