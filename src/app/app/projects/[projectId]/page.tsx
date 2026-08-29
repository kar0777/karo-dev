export const dynamic = 'force-dynamic';

import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { WorkspaceProvider } from '@/components/workspace/workspace-context';
import { NotFoundError } from '@/lib/api/errors';
import { requireProjectAccess } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { isPlatformAdmin, PermissionError } from '@/lib/rbac/permissions';

import { WorkspaceShell } from './workspace-shell';
import { loadWorkspaceData } from './workspace-data';

/**
 * The project workspace.
 *
 * All twenty fields of the client payload are loaded here, once, and handed to
 * `WorkspaceProvider`. The panes below it never fetch on mount, which is what
 * keeps the file explorer, the editor tab, the Changes tab and the activity log
 * agreeing with each other from the first paint.
 *
 * Note what this page does *not* do: it never distinguishes "no such project"
 * from "not your project". `requireProjectAccess` joins through `team_members`
 * so both produce the same `NotFoundError`, and both are answered here with
 * `notFound()`. A 403 on this route would confirm that a project id exists,
 * which is an enumeration oracle across teams.
 *
 * Two query parameters are part of this route's contract, because other screens
 * already deep-link with them:
 *
 *  · `conversation` — open this run's transcript instead of the most recent one.
 *    Sent by `/app/agents` and by the onboarding wizard. Validated against the
 *    project's own conversations inside `loadWorkspaceData`.
 *  · `prompt` — pre-fill the composer. The onboarding wizard carries the user's
 *    first prompt across the redirect this way; losing it would make the whole
 *    first-run flow end on an empty box.
 */

export const metadata: Metadata = {
  title: 'Workspace',
  description: 'Chat with the agent, read the code it writes and drive its machine.',
};

export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);

  const access = await requireProjectAccess(projectId, 'project.read').catch(
    (error: unknown) => {
      // A member whose role somehow lacks `project.read` gets the same answer as a
      // stranger: the workspace is simply not there for them.
      if (error instanceof NotFoundError || error instanceof PermissionError) notFound();
      throw error;
    },
  );

  // `?conversation=` deep-links a specific chat. The loader only honours ids that
  // belong to this project, so an id copied from another team resolves to the
  // normal default rather than to anything it should not see.
  const requestedConversation = Array.isArray(query.conversation)
    ? query.conversation[0]
    : query.conversation;

  // `?prompt=` is the onboarding wizard handing over the user's first prompt.
  // Capped because it becomes the composer's initial value and the URL is
  // attacker-supplied; the composer enforces its own limit on send, and this
  // stops a multi-megabyte query string from being rendered into the page at all.
  const rawPrompt = Array.isArray(query.prompt) ? query.prompt[0] : query.prompt;
  const initialPrompt = (rawPrompt ?? '').slice(0, 4_000);

  const data = await loadWorkspaceData({
    project: access.project,
    team: access.team,
    role: access.role,
    userId: access.user.id,
    isPlatformAdmin: isPlatformAdmin(access.user.platformRole),
    preferredConversationId: requestedConversation ?? null,
  });

  // Opening a project is what orders the "recent" lists in the sidebar and on
  // the projects page, exactly as `GET /api/projects/[projectId]` does. Awaited
  // rather than fired and forgotten so a failed write surfaces instead of
  // vanishing into a dangling promise; it is a single indexed UPDATE.
  await db.update(projects).set({ lastOpenedAt: new Date() }).where(eq(projects.id, projectId));

  return (
    <WorkspaceProvider data={data} initialPrompt={initialPrompt}>
      {/*
        `WorkspaceDialogs` is intentionally not mounted here: `ChatPanel` already
        renders it, the chat pane is the default tab and is never unmounted, and a
        second copy would put two overlays behind the same `dialog` state.
      */}
      <WorkspaceShell />
    </WorkspaceProvider>
  );
}
