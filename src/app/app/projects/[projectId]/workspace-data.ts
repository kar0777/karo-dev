import 'server-only';

import { createTwoFilesPatch } from 'diff';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { iso } from '@/app/api/_shared/route-helpers';
import { countChanges } from '@/lib/agent/tools';
import {
  DEFAULT_AGENT_PERMISSIONS,
  resolveAgentPermissions,
  type AgentPermissionKey,
  type AgentPermissions,
} from '@/lib/agent/policy';
import { db } from '@/lib/db';
import {
  agentRuns,
  conversations,
  customCommands,
  installedSkills,
  mcpServers,
  mcpTools,
  messageAttachments,
  messages,
  modelPrices,
  models,
  projectFiles,
  projects,
  providers,
  sandboxes,
  skills,
  terminalSessions,
  toolCalls,
  usageEvents,
  userApiKeys,
  type Message,
  type Project,
  type Sandbox,
  type ShellKind,
  type Team,
  type TeamRole,
} from '@/lib/db/schema';
import { configuredProviderKeys } from '@/lib/ai';
import { env, publicConfig } from '@/lib/env';
import { SHELL_META } from '@/components/app/meta';
import { toMcpServerView } from '@/lib/extensions/mcp-view';
import { tierAtLeast } from '@/lib/extensions/service';
import { toSkillView } from '@/lib/extensions/skill-view';
import { can } from '@/lib/rbac/permissions';
import type { StreamUsage, ChatToolCallView, PlanStepStatus } from '@/lib/types/agent';
import { loadBillingContext } from '@/lib/usage/metering';

import type {
  WorkspaceConversation,
  WorkspaceCustomCommand,
  WorkspaceData,
  WorkspaceFileNode,
  WorkspaceGitFile,
  WorkspaceMcpServer,
  WorkspaceMessage,
  WorkspaceModel,
  WorkspacePendingChange,
  WorkspaceRun,
  WorkspaceSandbox,
  WorkspaceShellOption,
  WorkspaceSkill,
  WorkspaceTerminalSeed,
} from '@/components/workspace/types';

/**
 * The workspace loader.
 *
 * One function, one render, twenty fields — the whole `WorkspaceData` contract
 * is assembled here so that every pane below `WorkspaceProvider` starts from a
 * single consistent snapshot instead of racing its own fetch on mount.
 *
 * **Scoping is the correctness property that matters.** The caller has already
 * proved membership of the project's team (see `requireProjectAccess`), and
 * every query below is anchored to either `project.id` or `team.id` — never to
 * an id that arrived from the client and never to a bare user id that could
 * reach across teams. Row limits are deliberate: a workspace with 40k files
 * must still open, so the tree is capped and the cap is visible in the UI as a
 * short tree rather than as a blank page.
 */

export type LoadWorkspaceDataInput = {
  project: Project;
  team: Team;
  role: TeamRole;
  userId: string;
  /**
   * From `?conversation=` — the run the caller wants open. The agents page and
   * the onboarding wizard both deep-link this way, so honouring it is what makes
   * "open the run" land on the right transcript instead of the newest one.
   *
   * It is matched against this project's conversations and ignored if it is not
   * one of them, so a guessed id from another team can only ever produce the
   * normal default rather than a leak.
   */
  preferredConversationId?: string | null;
};

/** Every shell Karo knows how to launch, in the order the picker shows them. */
const ALL_SHELLS: readonly ShellKind[] = ['bash', 'sh', 'powershell', 'cmd'];

// Labels come from `SHELL_META`, not a copy kept here. The copy that used to
// live in this file said "Bash" and "Command Prompt" where `SHELL_META` says
// "bash" and "cmd" — the same shell under two names, both of them on screen.

/** Sandbox states that still represent a machine the user can bring back. */
const LIVE_SANDBOX_STATES: readonly string[] = [
  'creating',
  'starting',
  'running',
  'sleeping',
  'stopping',
];

const PENDING_KIND_TO_GIT_STATUS: Record<
  WorkspacePendingChange['kind'],
  WorkspaceGitFile['status']
> = {
  created: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
};

export async function loadWorkspaceData({
  project,
  team,
  role,
  userId,
  preferredConversationId,
}: LoadWorkspaceDataInput): Promise<WorkspaceData> {
  const projectId = project.id;

  const [
    projectRows,
    conversationRows,
    fileRows,
    pendingRows,
    sandboxRows,
    modelRows,
    skillRows,
    mcpRows,
    mcpToolCounts,
    commandRows,
    runRows,
    usageRows,
    billing,
  ] = await Promise.all([
    // The project switcher in the left rail. Archived projects are omitted:
    // switching into one is a settings action, not a workspace action.
    db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(and(eq(projects.teamId, team.id), isNull(projects.archivedAt)))
      .orderBy(desc(projects.lastOpenedAt), desc(projects.updatedAt))
      .limit(60),

    // Ordered exactly like `GET /api/projects/[id]/conversations` so the list
    // does not reshuffle the first time the client refetches it.
    db
      .select()
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), isNull(conversations.archivedAt)))
      .orderBy(desc(conversations.isPinned), desc(conversations.updatedAt))
      .limit(200),

    // The explorer builds directories from full paths, so it wants the whole
    // flat subtree rather than one level.
    db
      .select({
        path: projectFiles.path,
        isDirectory: projectFiles.isDirectory,
        sizeBytes: projectFiles.sizeBytes,
        language: projectFiles.language,
        pendingChangeKind: projectFiles.pendingChangeKind,
        updatedAt: projectFiles.updatedAt,
      })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(asc(projectFiles.path))
      .limit(5_000),

    // Pending changes need the bodies as well, which is why they are a separate
    // query — pulling `content` for every file in the tree would be wasteful.
    db
      .select({
        path: projectFiles.path,
        content: projectFiles.content,
        pendingContent: projectFiles.pendingContent,
        pendingChangeKind: projectFiles.pendingChangeKind,
      })
      .from(projectFiles)
      .where(
        and(eq(projectFiles.projectId, projectId), isNotNull(projectFiles.pendingChangeKind)),
      )
      .orderBy(asc(projectFiles.path))
      .limit(500),

    db
      .select()
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.teamId, team.id),
          eq(sandboxes.projectId, projectId),
          sql`${sandboxes.status} <> 'destroyed'`,
        ),
      )
      .orderBy(desc(sandboxes.updatedAt))
      .limit(10),

    db
      .select({
        model: models,
        providerKey: providers.key,
        providerName: providers.name,
        inputMicroUsdPerMtok: modelPrices.inputMicroUsdPerMtok,
        outputMicroUsdPerMtok: modelPrices.outputMicroUsdPerMtok,
      })
      .from(models)
      .innerJoin(providers, eq(providers.id, models.providerId))
      .leftJoin(
        modelPrices,
        and(eq(modelPrices.modelId, models.id), isNull(modelPrices.effectiveTo)),
      )
      .where(and(eq(models.isEnabled, true), eq(providers.isEnabled, true)))
      .orderBy(asc(models.family), asc(models.sortOrder), asc(models.displayName)),

    // Account-wide installations plus the ones pinned to this project.
    db
      .select({ installation: installedSkills, skill: skills })
      .from(installedSkills)
      .innerJoin(skills, eq(skills.id, installedSkills.skillId))
      .where(
        and(
          eq(installedSkills.teamId, team.id),
          or(isNull(installedSkills.projectId), eq(installedSkills.projectId, projectId)),
        ),
      )
      .orderBy(asc(skills.name)),

    db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.teamId, team.id),
          or(isNull(mcpServers.projectId), eq(mcpServers.projectId, projectId)),
        ),
      )
      .orderBy(asc(mcpServers.name)),

    db
      .select({
        serverId: mcpTools.serverId,
        total: sql<number>`count(*)::int`,
        enabled: sql<number>`count(*) filter (where ${mcpTools.isEnabled})::int`,
      })
      .from(mcpTools)
      .innerJoin(mcpServers, eq(mcpServers.id, mcpTools.serverId))
      .where(eq(mcpServers.teamId, team.id))
      .groupBy(mcpTools.serverId),

    db
      .select()
      .from(customCommands)
      .where(
        and(
          eq(customCommands.teamId, team.id),
          eq(customCommands.isEnabled, true),
          or(isNull(customCommands.projectId), eq(customCommands.projectId, projectId)),
        ),
      )
      .orderBy(asc(customCommands.name)),

    db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.teamId, team.id), eq(agentRuns.projectId, projectId)))
      .orderBy(desc(agentRuns.createdAt))
      .limit(25),

    // Lifetime model spend for this project. `usage_events` is the ledger the
    // billing pages read, so the number here can never disagree with them.
    db
      .select({
        inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::bigint`,
        weightedTokens: sql<number>`coalesce(sum(${usageEvents.weightedTokens}), 0)::bigint`,
        chargedMicroUsd: sql<number>`coalesce(sum(${usageEvents.chargedMicroUsd}), 0)::bigint`,
        requests: sql<number>`count(*)::int`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.teamId, team.id),
          eq(usageEvents.projectId, projectId),
          eq(usageEvents.kind, 'model'),
        ),
      ),

    loadBillingContext(team.id),
  ]);

  /* ---------------- Which providers can actually answer ---------------- */

  /**
   * Provider keys a run could genuinely reach: Karo's own credentials plus any
   * the user supplied themselves. `null` means "do not filter" — when nothing is
   * configured every model is served by the simulator, so hiding them all would
   * leave an empty picker, and the demo badge already explains what is happening.
   *
   * Keyed on `AI_PROVIDER` rather than `DEMO_MODE` on purpose: an install with
   * Stripe configured but no model provider is not in demo mode, yet still has
   * nothing that can serve a model.
   */
  const reachableProviders: Set<string> | null = await (async () => {
    if (env.AI_PROVIDER === 'mock') return null;

    const platform = configuredProviderKeys();
    const byok = await db
      .selectDistinct({ providerKey: userApiKeys.providerKey })
      .from(userApiKeys)
      .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.isActive, true)));

    return new Set([...platform, ...byok.map((row) => row.providerKey)]);
  })();

  /* ---------------- Sandbox + terminals ---------------- */

  // A project can accumulate several machines over its life. The running one is
  // the one the panes should reflect; otherwise the most recently touched.
  const sandboxRow =
    sandboxRows.find((row) => row.status === 'running') ??
    sandboxRows.find((row) => LIVE_SANDBOX_STATES.includes(row.status)) ??
    sandboxRows[0] ??
    null;

  // Terminal sessions belong to a user, not to a team: another member's shell
  // history is theirs. Scoped by project as well so a shell opened against a
  // different project never leaks in.
  const terminalRows = sandboxRow
    ? await db
        .select()
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.sandboxId, sandboxRow.id),
            eq(terminalSessions.userId, userId),
            eq(terminalSessions.projectId, projectId),
            eq(terminalSessions.isActive, true),
          ),
        )
        .orderBy(desc(terminalSessions.lastActiveAt))
        .limit(8)
    : [];

  /* ---------------- Conversation + transcript ---------------- */

  // A deep link wins when it names a conversation in *this* project;
  // `conversationRows` is already scoped to the project, so membership in it is
  // the whole authorisation check. Otherwise "where the user left off" is the
  // last chat with activity, which is not the top of the list — that is sorted
  // pinned-first to match the API.
  const requested = preferredConversationId
    ? conversationRows.find((row) => row.id === preferredConversationId)
    : undefined;

  const activeConversation =
    requested ??
    [...conversationRows].sort((a, b) => lastActivityMs(b) - lastActivityMs(a))[0] ??
    null;

  const messageViews = activeConversation ? await loadTranscript(activeConversation.id) : [];

  /* ---------------- Pending changes + git ---------------- */

  const pendingChanges: WorkspacePendingChange[] = pendingRows.map((row) => {
    const kind = row.pendingChangeKind ?? 'modified';
    const before = kind === 'created' ? '' : row.content;
    const after = kind === 'deleted' ? '' : (row.pendingContent ?? row.content);

    // Produced here rather than in the browser so the `diff` package stays out
    // of the client bundle, and against the file's *current* content so a
    // hand-edit made after the agent proposed the change is visible.
    const diff = createTwoFilesPatch(
      `a/${row.path}`,
      `b/${row.path}`,
      before,
      after,
      undefined,
      undefined,
      { context: 3 },
    );
    const { additions, deletions } = countChanges(diff);

    return { path: row.path, kind, additions, deletions, diff };
  });

  const gitFiles: WorkspaceGitFile[] = pendingChanges.map((change) => ({
    path: change.path,
    status: PENDING_KIND_TO_GIT_STATUS[change.kind],
    additions: change.additions,
    deletions: change.deletions,
  }));

  /* ---------------- Plan-derived capability gates ---------------- */

  const plan = billing.plan;
  const allowedShells = plan.allowedShells ?? ['bash'];
  const config = publicConfig();
  // With no machine yet, the honest answer is what the *next* one would run on:
  // the deployment's resolved provider.
  const providerKey = sandboxRow?.provider ?? config.sandboxProvider;

  /* ---------------- Assemble ---------------- */

  const usage = usageRows[0];

  return {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      updatedAt: project.updatedAt.toISOString(),
      description: project.description,
      template: project.template,
      runtimeTarget: project.runtimeTarget,
      gitBranch: project.gitBranch,
      gitRemoteUrl: project.gitRemoteUrl,
      defaultModelId: project.defaultModelId,
      defaultAgentMode: project.defaultAgentMode,
      defaultShell: project.defaultShell,
      permissions: projectAgentPermissions(project.permissions),
    },

    projects: projectRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      updatedAt: row.updatedAt.toISOString(),
    })),

    conversations: conversationRows.map(toWorkspaceConversation),
    activeConversationId: activeConversation?.id ?? null,
    messages: messageViews,

    files: fileRows.map((row): WorkspaceFileNode => ({
      path: row.path,
      name: row.path.split('/').pop() ?? row.path,
      isDirectory: row.isDirectory,
      sizeBytes: row.sizeBytes,
      language: row.language,
      updatedAt: row.updatedAt.toISOString(),
      pendingChangeKind: row.pendingChangeKind,
    })),

    sandbox: sandboxRow ? toWorkspaceSandbox(sandboxRow) : null,

    // Models above the team's tier are dropped rather than shown and rejected:
    // a picker that offers an option the run will refuse is a broken picker.
    //
    // The same reasoning removes models whose provider has no credentials.
    // Picking one does not fail loudly — `resolveModel` quietly degrades the run
    // to the simulator — so offering it is worse than a refusal: the user gets a
    // simulated answer attributed to the model they chose.
    models: modelRows
      .filter((row) => tierAtLeast(plan.tier, row.model.minPlanTier))
      .filter((row) => reachableProviders === null || reachableProviders.has(row.providerKey))
      .map((row): WorkspaceModel => ({
        id: row.model.id,
        slug: row.model.slug,
        displayName: row.model.displayName,
        family: row.model.family,
        providerKey: row.providerKey,
        providerName: row.providerName,
        contextWindow: row.model.contextWindow,
        maxOutputTokens: row.model.maxOutputTokens,
        supportsVision: row.model.supportsVision,
        supportsTools: row.model.supportsTools,
        isDefault: row.model.isDefault,
        inputMicroUsdPerMtok: row.inputMicroUsdPerMtok ?? 0,
        outputMicroUsdPerMtok: row.outputMicroUsdPerMtok ?? 0,
      })),

    skills: dedupeBySkill(skillRows).map((row): WorkspaceSkill => {
      const view = toSkillView(row.skill, team.id);
      return {
        id: view.id,
        key: view.key,
        name: view.name,
        description: view.description,
        icon: view.icon,
        category: view.category,
        // The installed version can lag the catalogue entry; the workspace must
        // show what is actually loaded into the prompt.
        version: row.installation.version,
        isEnabled: row.installation.isEnabled,
        commands: view.slashCommands.map((command) => ({
          name: command.name,
          description: command.description,
          prompt: command.prompt,
        })),
      };
    }),

    mcpServers: mcpRows.map((row): WorkspaceMcpServer => {
      const counts = mcpToolCounts.find((entry) => entry.serverId === row.id);
      const view = toMcpServerView(row, null, counts);
      return {
        id: view.id,
        name: view.name,
        transport: view.transport,
        status: view.status,
        statusMessage: view.statusMessage,
        isEnabled: view.isEnabled,
        toolCount: view.toolCount,
      };
    }),

    pendingChanges,

    git: {
      branch: project.gitBranch,
      remoteUrl: project.gitRemoteUrl,
      // Ahead/behind can only come from a real repository inside a running
      // machine. Reading it here would mean shelling into the sandbox during a
      // page render, so the first paint shows the pending-change ledger and the
      // rail's refresh button upgrades it via `GET /api/projects/[id]/git`.
      ahead: 0,
      behind: 0,
      clean: gitFiles.length === 0,
      files: gitFiles,
    },

    runs: runRows.map((row): WorkspaceRun => ({
      id: row.id,
      title: row.title,
      status: row.status,
      mode: row.mode,
      steps: row.steps.map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status as PlanStepStatus,
        ...(step.detail === undefined ? {} : { detail: step.detail }),
      })),
      totalInputTokens: row.totalInputTokens,
      totalOutputTokens: row.totalOutputTokens,
      totalWeightedTokens: row.totalWeightedTokens,
      totalChargedMicroUsd: row.totalChargedMicroUsd,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      startedAt: iso(row.startedAt),
      finishedAt: iso(row.finishedAt),
    })),

    terminals: terminalRows.map((row, index): WorkspaceTerminalSeed => ({
      id: row.id,
      title: row.title,
      shell: row.shell,
      cwd: row.cwd,
      cols: row.cols,
      rows: row.rows,
      // The most recently used session is the one the panel should focus.
      isActive: index === 0,
      scrollback: row.scrollback,
      history: row.history,
    })),

    customCommands: dedupeByName(commandRows).map((row): WorkspaceCustomCommand => ({
      name: row.name,
      description: row.description,
      category: row.category,
      prompt: row.prompt,
      source: row.source,
      sourceRef: row.sourceRef,
    })),

    shells: ALL_SHELLS.map((shell) =>
      describeShell(shell, {
        allowedShells,
        planName: plan.name,
        providerKey,
      }),
    ),

    usage: {
      inputTokens: Number(usage?.inputTokens ?? 0),
      outputTokens: Number(usage?.outputTokens ?? 0),
      weightedTokens: Number(usage?.weightedTokens ?? 0),
      chargedMicroUsd: Number(usage?.chargedMicroUsd ?? 0),
      // One usage event per billed model request, which is one assistant
      // response — the schema has no separate counter for this.
      messageCount: Number(usage?.requests ?? 0),
    },

    quota: {
      planName: plan.name,
      planTier: plan.tier,
      // A lapsed or absent subscription includes nothing; showing the plan's
      // headline allowance in that state would overstate what the team has.
      includedWeightedTokens: billing.hasActiveSubscription ? plan.includedWeightedTokens : 0,
      weightedTokensUsed: billing.weightedTokensUsed,
      balanceMicroUsd: billing.balanceMicroUsd,
      computeHoursIncluded: billing.hasActiveSubscription ? plan.includedComputeHours : 0,
      computeHoursUsed: billing.computeHoursUsed,
    },

    capabilities: {
      canWriteFiles: can(role, 'project.file.write'),
      canRunAgent: can(role, 'agent.run'),
      canApprove: can(role, 'agent.approve'),
      canUseTerminal: can(role, 'terminal.use'),
      canManageSandbox: can(role, 'sandbox.stop'),
      canCreateSandbox: can(role, 'sandbox.create'),
    },

    demoMode: config.demoMode,
  };
}

/* ------------------------------------------------------------------ *
 *  Mappers
 * ------------------------------------------------------------------ */

/**
 * `serializeConversation` is a superset of this shape and types `updatedAt` as
 * nullable, which `WorkspaceConversation` does not allow — the column is
 * `NOT NULL`, so mapping explicitly is both accurate and cast-free.
 */
function toWorkspaceConversation(
  row: typeof conversations.$inferSelect,
): WorkspaceConversation {
  return {
    id: row.id,
    title: row.title,
    agentMode: row.agentMode,
    modelId: row.modelId,
    messageCount: row.messageCount,
    totalWeightedTokens: row.totalWeightedTokens,
    totalChargedMicroUsd: row.totalChargedMicroUsd,
    isPinned: row.isPinned,
    lastMessageAt: iso(row.lastMessageAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function lastActivityMs(row: typeof conversations.$inferSelect): number {
  return (row.lastMessageAt ?? row.updatedAt).getTime();
}

/**
 * One row per skill.
 *
 * `installed_skills_unique` is `(team_id, skill_id, project_id)` and Postgres
 * treats NULLs as distinct, so the same skill can be installed account-wide
 * **and** pinned to this project. The scope filter above matches both rows, and
 * `WorkspaceSkill.id` is the *skill* id — two rows would render the same skill
 * twice under one React key. The project-scoped installation is the more
 * specific configuration, so it is the one that wins.
 */
function dedupeBySkill<
  T extends { installation: { skillId: string; projectId: string | null } },
>(rows: readonly T[]): T[] {
  const bySkill = new Map<string, T>();
  for (const row of rows) {
    const current = bySkill.get(row.installation.skillId);
    const moreSpecific =
      current !== undefined &&
      current.installation.projectId === null &&
      row.installation.projectId !== null;
    if (current === undefined || moreSpecific) bySkill.set(row.installation.skillId, row);
  }
  return [...bySkill.values()];
}

/**
 * One row per command name, for the same reason.
 *
 * `custom_commands_scope_name_unique` is `(team_id, project_id, name)`, so an
 * account-wide command and a project command may share a name. `/deploy` must
 * mean one thing, and which one cannot be left to whichever row the planner
 * happens to return first — the project's own definition overrides the team's.
 */
function dedupeByName<T extends { name: string; projectId: string | null }>(
  rows: readonly T[],
): T[] {
  const byName = new Map<string, T>();
  for (const row of rows) {
    const current = byName.get(row.name);
    const moreSpecific =
      current !== undefined && current.projectId === null && row.projectId !== null;
    if (current === undefined || moreSpecific) byName.set(row.name, row);
  }
  return [...byName.values()];
}

/**
 * `serializeSandbox` omits `previewUrl` and carries a dozen fields the panes
 * never read, so the workspace shape is built by hand.
 */
function toWorkspaceSandbox(row: Sandbox): WorkspaceSandbox {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    status: row.status,
    statusMessage: row.statusMessage,
    cpuCores: row.cpuCores,
    memoryMb: row.memoryMb,
    diskGb: row.diskGb,
    cpuPercent: row.cpuPercent,
    memoryUsedMb: row.memoryUsedMb,
    diskUsedMb: row.diskUsedMb,
    processCount: row.processCount,
    autoSleepMinutes: row.autoSleepMinutes,
    previewUrl: previewUrlFrom(row),
    startedAt: iso(row.startedAt),
    lastActiveAt: iso(row.lastActiveAt),
  };
}

/**
 * There is no `preview_url` column: providers report the ports they exposed and
 * the service stores that map in `sandboxes.metadata.exposedPorts`. Port 3000 is
 * preferred because every shipped template's dev server binds it; otherwise the
 * lowest exposed port wins so the choice is stable between renders.
 */
function previewUrlFrom(row: Sandbox): string | null {
  const exposed = (row.metadata as { exposedPorts?: Record<string, unknown> } | null)
    ?.exposedPorts;
  if (!exposed || typeof exposed !== 'object') return null;

  const entries = Object.entries(exposed)
    .filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    )
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  const preferred = entries.find(([port]) => port === '3000') ?? entries[0];
  return preferred ? preferred[1] : null;
}

/**
 * The per-project agent matrix, without any mode cap applied.
 *
 * `projects.permissions` is a loose `Record<string, boolean | string[]>` because
 * it also stores list-shaped settings; only the boolean keys the policy knows
 * about are adopted, and everything else falls back to the policy defaults. The
 * mode passed is `auto`, whose cap set is empty — mode narrowing belongs to the
 * run, and the right rail explains it separately.
 */
function projectAgentPermissions(
  stored: Record<string, boolean | string[]> | null,
): AgentPermissions {
  const overrides: Partial<AgentPermissions> = {};
  for (const key of Object.keys(DEFAULT_AGENT_PERMISSIONS) as AgentPermissionKey[]) {
    const value = stored?.[key];
    if (typeof value === 'boolean') overrides[key] = value;
  }
  return resolveAgentPermissions(overrides, 'auto');
}

/**
 * Whether a shell can actually be launched, and if not, why.
 *
 * Two independent gates: the plan's `allowedShells` (a commercial limit, lifted
 * by upgrading) and what the resolved provider's image can run (a technical
 * limit that upgrading will not fix). The reason string says which one applies,
 * because "PowerShell is unavailable" without a cause is a support ticket.
 */
function describeShell(
  shell: ShellKind,
  context: { allowedShells: string[]; planName: string; providerKey: string },
): WorkspaceShellOption {
  const label = SHELL_META[shell].label;

  /*
   * Both Windows shells are reported unavailable, and the reason is the image
   * rather than the operating system of the person asking.
   *
   * This block used to have it backwards. `cmd` was refused outright with
   * "cmd.exe only exists on Windows", yet `interactiveShellBinary` in
   * `lib/sandbox/providers/local-docker.ts` deliberately maps `cmd` to
   * `/bin/sh` — so it would have run, just as something that is not a command
   * prompt. `powershell` was refused only on the `mock` provider and offered
   * everywhere else, but it maps to `pwsh`, and `pwsh` is not installed in
   * `docker/sandbox-base/Dockerfile`. The one shell that worked was blocked and
   * the one that dies on spawn was advertised.
   *
   * Offering a shell that cannot start is the worse failure of the two, and
   * labelling `/bin/sh` "cmd" is a small lie the terminal would then have to
   * keep. Every provider Karo currently ships runs the Linux sandbox image, so
   * neither is honestly available; `SHELL_META` already frames both as
   * belonging to Windows machines, and the reason strings agree with it.
   */
  if (shell === 'powershell' || shell === 'cmd') {
    return {
      value: shell,
      label,
      available: false,
      reason:
        'Karo sandboxes run the Linux base image, which ships bash and sh only. Windows shells need a Windows machine registered through Bring Your Own Server.',
    };
  }

  if (!context.allowedShells.includes(shell)) {
    return {
      value: shell,
      label,
      available: false,
      reason: `The ${context.planName} plan can use ${context.allowedShells.join(', ')}.`,
    };
  }

  return { value: shell, label, available: true, reason: '' };
}

/* ------------------------------------------------------------------ *
 *  Transcript
 * ------------------------------------------------------------------ */

/**
 * Rebuilds one conversation's transcript.
 *
 * This mirrors `GET /api/conversations/[conversationId]`, which folds every
 * persisted event type back into one message view so a reload is
 * indistinguishable from having watched the run stream live. That route's
 * builders are local to its module, and route files export only handlers — the
 * duplication here is the price of not editing a file this change does not own.
 * If the two ever need to diverge, they should be extracted into
 * `app/api/_shared` instead.
 */
async function loadTranscript(conversationId: string): Promise<WorkspaceMessage[]> {
  // The window is the *newest* 500, not the oldest: a chat pane opens scrolled to
  // the bottom, so `ASC … LIMIT 500` on a long transcript would paint a
  // months-old prefix and silently hide everything the user last said. Selected
  // newest-first and reversed back into reading order.
  const newestFirst = await db
    .select({ message: messages, modelSlug: models.slug, modelName: models.displayName })
    .from(messages)
    .leftJoin(models, eq(messages.modelId, models.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sequence), desc(messages.createdAt))
    .limit(500);

  const rows = newestFirst.reverse();

  if (rows.length === 0) return [];

  const messageIds = rows.map((row) => row.message.id);

  const [calls, attachments, runs] = await Promise.all([
    db
      .select()
      .from(toolCalls)
      .where(inArray(toolCalls.messageId, messageIds))
      .orderBy(asc(toolCalls.sequence)),
    db
      .select()
      .from(messageAttachments)
      .where(inArray(messageAttachments.messageId, messageIds)),
    db
      .select({ id: agentRuns.id, steps: agentRuns.steps })
      .from(agentRuns)
      .where(eq(agentRuns.conversationId, conversationId))
      .orderBy(asc(agentRuns.createdAt))
      .limit(200),
  ]);

  const stepsByRun = new Map(runs.map((run) => [run.id, run.steps]));

  return rows.map((row): WorkspaceMessage => {
    const message = row.message;
    const messageCalls = calls.filter((call) => call.messageId === message.id);
    const planSteps = message.runId ? stepsByRun.get(message.runId) : undefined;
    const usage = toUsageView(message);

    return {
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt.toISOString(),
      toolCalls: messageCalls.map(toToolCallView),
      fileChanges: messageCalls.flatMap(toFileChangeViews),
      ...(message.runId ? { runId: message.runId } : {}),
      ...(message.thinking ? { thinking: message.thinking } : {}),
      ...(row.modelSlug ? { modelSlug: row.modelSlug } : {}),
      ...(row.modelName ? { modelDisplayName: row.modelName } : {}),
      ...(message.agentMode ? { agentMode: message.agentMode } : {}),
      ...(planSteps && planSteps.length
        ? {
            planSteps: planSteps.map((step) => ({
              id: step.id,
              title: step.title,
              status: step.status as PlanStepStatus,
              ...(step.detail === undefined ? {} : { detail: step.detail }),
            })),
          }
        : {}),
      ...(usage ? { usage } : {}),
      ...(message.errorMessage
        ? {
            error: {
              code: 'internal' as const,
              message: message.errorMessage,
              retryable: true,
            },
          }
        : {}),
      attachments: attachments
        .filter((attachment) => attachment.messageId === message.id)
        .map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          ...(attachment.inlineContent ? { inlineContent: attachment.inlineContent } : {}),
        })),
    };
  });
}

function toToolCallView(call: typeof toolCalls.$inferSelect): ChatToolCallView {
  return {
    id: call.id,
    toolName: call.toolName,
    source: (call.source as ChatToolCallView['source']) ?? 'builtin',
    title: call.resultSummary || call.toolName,
    args: call.args ?? {},
    output: call.result ?? '',
    status: call.status,
    requiresApproval: call.requiresApproval,
    isError: call.isError,
    durationMs: call.durationMs,
    ...(call.sourceRef ? { sourceRef: call.sourceRef } : {}),
    ...(call.rejectedReason ? { approvalReason: call.rejectedReason } : {}),
    ...(call.exitCode === null ? {} : { exitCode: call.exitCode }),
  };
}

/** Tool names whose arguments describe a file mutation. */
const FILE_TOOLS: Record<string, 'modified' | 'deleted'> = {
  write_file: 'modified',
  edit_file: 'modified',
  delete_file: 'deleted',
};

function toFileChangeViews(call: typeof toolCalls.$inferSelect) {
  const kind = FILE_TOOLS[call.toolName];
  if (!kind) return [];

  const args = call.args ?? {};
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
        call.toolName === 'write_file' && additions > 0 && deletions === 0
          ? ('created' as const)
          : kind,
      additions,
      deletions,
      pending: call.status === 'awaiting_approval',
      ...(looksLikeDiff ? { diff: output } : {}),
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
    ...(message.timeToFirstTokenMs === null
      ? {}
      : { timeToFirstTokenMs: message.timeToFirstTokenMs }),
  };
}
