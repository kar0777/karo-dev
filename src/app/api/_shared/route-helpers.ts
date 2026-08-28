import 'server-only';

import { normalizeWorkspacePath } from '@/lib/agent/policy';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import type { RouteParams } from '@/lib/api/handler';
import type { Conversation, Project, Sandbox, TerminalSession } from '@/lib/db/schema';

/**
 * Helpers shared by the agent/sandbox/terminal route handlers.
 *
 * Two jobs only:
 *  · turn Next's loose `params` record into the single string a route needs;
 *  · serialise database rows into the plain, JSON-safe shapes the client
 *    contract promises (Dates become ISO strings, secrets never travel).
 *
 * Lives under `app/api/_shared` because a leading underscore marks the folder
 * private — App Router never treats it as a route segment.
 */

/**
 * Reads a required dynamic segment. A missing or repeated segment can only
 * happen if the URL does not match the file layout, so it reports 404 rather
 * than a validation error — there is genuinely no such resource.
 */
export function routeParam(params: RouteParams, key: string): string {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new NotFoundError('Not found.');
  return value;
}

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Normalises a batch of workspace paths, rejecting the **whole** batch if any
 * one of them escapes. A partial apply is worse than a rejected apply: the user
 * would have to work out which half of their selection landed.
 */
export function normalizeWorkspacePaths(paths: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const candidate of paths) {
    try {
      normalized.push(normalizeWorkspacePath(candidate));
    } catch {
      throw new ValidationError(
        `"${candidate}" is not a path inside this workspace.`,
        [{ path: 'paths', message: 'Path escapes the workspace', code: 'path_denied' }],
        {
          title: 'Path outside the workspace',
          description:
            'Karo only reads and writes inside /workspace. Reload the changes list and try again.',
        },
      );
    }
  }
  return [...new Set(normalized)];
}

/* ------------------------------------------------------------------ *
 *  Serialisers
 * ------------------------------------------------------------------ */

export type ProjectView = ReturnType<typeof serializeProject>;

/**
 * Note what is *absent*: `envVars`. Project environment values are secrets and
 * never cross the wire — the settings UI works with key names only.
 */
export function serializeProject(project: Project) {
  return {
    id: project.id,
    teamId: project.teamId,
    createdById: project.createdById,
    name: project.name,
    slug: project.slug,
    description: project.description,
    template: project.template,
    runtimeTarget: project.runtimeTarget,
    workerId: project.workerId,
    defaultModelId: project.defaultModelId,
    defaultAgentMode: project.defaultAgentMode,
    defaultShell: project.defaultShell,
    permissions: project.permissions ?? null,
    gitRemoteUrl: project.gitRemoteUrl,
    gitBranch: project.gitBranch,
    envVarKeys: Object.keys(project.envVars ?? {}).sort(),
    archivedAt: iso(project.archivedAt),
    lastOpenedAt: iso(project.lastOpenedAt),
    createdAt: iso(project.createdAt),
    updatedAt: iso(project.updatedAt),
  };
}

export type SandboxView = ReturnType<typeof serializeSandbox>;

export function serializeSandbox(sandbox: Sandbox) {
  return {
    id: sandbox.id,
    teamId: sandbox.teamId,
    projectId: sandbox.projectId,
    name: sandbox.name,
    provider: sandbox.provider,
    workerId: sandbox.workerId,
    status: sandbox.status,
    statusMessage: sandbox.statusMessage,
    image: sandbox.image,
    region: sandbox.region,
    cpuCores: sandbox.cpuCores,
    memoryMb: sandbox.memoryMb,
    diskGb: sandbox.diskGb,
    computeMultiplier: sandbox.computeMultiplier,
    cpuPercent: sandbox.cpuPercent,
    memoryUsedMb: sandbox.memoryUsedMb,
    diskUsedMb: sandbox.diskUsedMb,
    processCount: sandbox.processCount,
    autoSleepMinutes: sandbox.autoSleepMinutes,
    autoDestroyHours: sandbox.autoDestroyHours,
    networkPolicy: sandbox.networkPolicy,
    allowDocker: sandbox.allowDocker,
    totalActiveSeconds: sandbox.totalActiveSeconds,
    lastActiveAt: iso(sandbox.lastActiveAt),
    startedAt: iso(sandbox.startedAt),
    stoppedAt: iso(sandbox.stoppedAt),
    destroyedAt: iso(sandbox.destroyedAt),
    createdAt: iso(sandbox.createdAt),
    updatedAt: iso(sandbox.updatedAt),
  };
}

export type ConversationView = ReturnType<typeof serializeConversation>;

export function serializeConversation(conversation: Conversation) {
  return {
    id: conversation.id,
    projectId: conversation.projectId,
    userId: conversation.userId,
    title: conversation.title,
    modelId: conversation.modelId,
    agentMode: conversation.agentMode,
    summary: conversation.summary,
    messageCount: conversation.messageCount,
    totalInputTokens: conversation.totalInputTokens,
    totalOutputTokens: conversation.totalOutputTokens,
    totalWeightedTokens: conversation.totalWeightedTokens,
    totalChargedMicroUsd: conversation.totalChargedMicroUsd,
    isPinned: conversation.isPinned,
    archivedAt: iso(conversation.archivedAt),
    lastMessageAt: iso(conversation.lastMessageAt),
    createdAt: iso(conversation.createdAt),
    updatedAt: iso(conversation.updatedAt),
  };
}

export type TerminalSessionView = ReturnType<typeof serializeTerminalSession>;

export function serializeTerminalSession(session: TerminalSession) {
  return {
    id: session.id,
    sandboxId: session.sandboxId,
    projectId: session.projectId,
    title: session.title,
    shell: session.shell,
    cwd: session.cwd,
    cols: session.cols,
    rows: session.rows,
    isActive: session.isActive,
    scrollback: session.scrollback,
    history: session.history,
    exitCode: session.exitCode,
    lastActiveAt: iso(session.lastActiveAt),
    closedAt: iso(session.closedAt),
    createdAt: iso(session.createdAt),
  };
}

/**
 * A conversation title derived from the first thing the user said. Trimmed to
 * one line so a pasted stack trace does not become a 4 KB sidebar entry.
 */
export function titleFromMessage(content: string): string {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return 'New chat';

  const cleaned = firstLine
    .replace(/^[#>*\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'New chat';
  return cleaned.length > 60 ? `${cleaned.slice(0, 57).trimEnd()}…` : cleaned;
}
