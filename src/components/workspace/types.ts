import type { AgentPermissionKey } from '@/lib/agent/policy';
import type {
  AgentMode,
  RunStatus,
  SandboxStatus,
  ShellKind,
  ToolCallStatus,
} from '@/lib/db/schema';
import type {
  AgentErrorCode,
  ChatFileChangeView,
  ChatMessageView,
  ChatToolCallView,
  PlanStepStatus,
  StreamUsage,
} from '@/lib/types/agent';

/**
 * Everything the workspace needs, in a shape that survives the server→client
 * boundary: dates are ISO strings, bigint columns are plain numbers and nothing
 * carries a Drizzle row with a `Date` in it.
 *
 * The server component builds these once; every pane below reads them from the
 * workspace context rather than re-fetching.
 */

export type WorkspaceProjectSummary = {
  id: string;
  name: string;
  slug: string;
  updatedAt: string;
};

export type WorkspaceProject = WorkspaceProjectSummary & {
  description: string;
  template: string;
  runtimeTarget: string;
  gitBranch: string;
  gitRemoteUrl: string | null;
  defaultModelId: string | null;
  defaultAgentMode: AgentMode;
  defaultShell: ShellKind;
  /** Resolved per-project agent permission matrix. */
  permissions: Record<AgentPermissionKey, boolean>;
};

export type WorkspaceModel = {
  id: string;
  slug: string;
  displayName: string;
  family: string;
  providerKey: string;
  providerName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsTools: boolean;
  isDefault: boolean;
  inputMicroUsdPerMtok: number;
  outputMicroUsdPerMtok: number;
};

export type WorkspaceFileNode = {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  language: string | null;
  updatedAt: string;
  pendingChangeKind: 'created' | 'modified' | 'deleted' | 'renamed' | null;
};

export type WorkspaceConversation = {
  id: string;
  title: string;
  agentMode: AgentMode;
  modelId: string | null;
  messageCount: number;
  totalWeightedTokens: number;
  totalChargedMicroUsd: number;
  isPinned: boolean;
  lastMessageAt: string | null;
  updatedAt: string;
};

export type WorkspaceSandbox = {
  id: string;
  name: string;
  provider: string;
  status: SandboxStatus;
  statusMessage: string | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  cpuPercent: number;
  memoryUsedMb: number;
  diskUsedMb: number;
  processCount: number;
  autoSleepMinutes: number;
  previewUrl: string | null;
  startedAt: string | null;
  lastActiveAt: string | null;
};

export type WorkspaceSkillCommand = {
  name: string;
  description: string;
  prompt: string;
};

export type WorkspaceSkill = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  isEnabled: boolean;
  commands: WorkspaceSkillCommand[];
};

export type WorkspaceMcpServer = {
  id: string;
  name: string;
  transport: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  statusMessage: string | null;
  isEnabled: boolean;
  toolCount: number;
};

export type WorkspacePendingChange = {
  path: string;
  kind: 'created' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  /** Unified diff, produced server-side so `diff` stays out of the browser bundle. */
  diff: string;
};

export type WorkspaceGitFile = {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  additions: number;
  deletions: number;
};

export type WorkspaceGitStatus = {
  branch: string;
  remoteUrl: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  files: WorkspaceGitFile[];
};

export type WorkspaceRunStep = {
  id: string;
  title: string;
  status: PlanStepStatus;
  detail?: string;
};

export type WorkspaceRun = {
  id: string;
  title: string;
  status: RunStatus;
  mode: AgentMode;
  steps: WorkspaceRunStep[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalWeightedTokens: number;
  totalChargedMicroUsd: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type WorkspaceTerminalSeed = {
  id: string;
  title: string;
  shell: ShellKind;
  cwd: string;
  cols: number;
  rows: number;
  isActive: boolean;
  scrollback: string;
  history: string[];
};

export type WorkspaceCustomCommand = {
  name: string;
  description: string;
  category: string;
  prompt: string;
  source: string;
  sourceRef: string | null;
};

export type WorkspaceUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  weightedTokens: number;
  chargedMicroUsd: number;
  messageCount: number;
};

export type WorkspaceQuota = {
  planName: string;
  planTier: string;
  includedWeightedTokens: number;
  weightedTokensUsed: number;
  balanceMicroUsd: number;
  computeHoursIncluded: number;
  computeHoursUsed: number;
};

export type WorkspaceShellOption = {
  value: ShellKind;
  label: string;
  available: boolean;
  /** Why it is unavailable — shown in the picker so the gap is explainable. */
  reason: string;
};

export type WorkspaceCapabilities = {
  canWriteFiles: boolean;
  canRunAgent: boolean;
  canApprove: boolean;
  canUseTerminal: boolean;
  canManageSandbox: boolean;
  canCreateSandbox: boolean;
};

/* ------------------------------------------------------------------ *
 *  Live chat view models
 * ------------------------------------------------------------------ */

/** `ChatToolCallView` plus the bits an in-flight approval prompt needs. */
export type WorkspaceToolCall = ChatToolCallView & {
  approvalKind?: 'command' | 'file' | 'tool';
  approvalPreview?: string;
  /** One-line outcome sent with `tool.end`. */
  resultSummary?: string;
  /** Client clock, used to show a live duration while the tool is running. */
  startedAtMs?: number;
};

export type WorkspaceMessage = Omit<ChatMessageView, 'toolCalls'> & {
  toolCalls: WorkspaceToolCall[];
  runId?: string;
};

export type WorkspaceActivityLevel = 'info' | 'success' | 'warning' | 'error';

export type WorkspaceActivityEntry = {
  id: string;
  at: string;
  level: WorkspaceActivityLevel;
  message: string;
  detail?: string;
};

export type WorkspaceTabKey = 'chat' | 'code' | 'preview' | 'terminal' | 'tasks' | 'changes';

export type WorkspaceStreamPhase = 'idle' | 'starting' | 'streaming' | 'awaiting_approval';

/** The full server → client payload. */
export type WorkspaceData = {
  project: WorkspaceProject;
  projects: WorkspaceProjectSummary[];
  conversations: WorkspaceConversation[];
  activeConversationId: string | null;
  messages: WorkspaceMessage[];
  files: WorkspaceFileNode[];
  sandbox: WorkspaceSandbox | null;
  models: WorkspaceModel[];
  skills: WorkspaceSkill[];
  mcpServers: WorkspaceMcpServer[];
  pendingChanges: WorkspacePendingChange[];
  git: WorkspaceGitStatus;
  runs: WorkspaceRun[];
  terminals: WorkspaceTerminalSeed[];
  customCommands: WorkspaceCustomCommand[];
  shells: WorkspaceShellOption[];
  usage: WorkspaceUsageTotals;
  quota: WorkspaceQuota;
  capabilities: WorkspaceCapabilities;
  demoMode: boolean;
};

export type {
  AgentErrorCode,
  ChatFileChangeView,
  ChatMessageView,
  PlanStepStatus,
  StreamUsage,
  ToolCallStatus,
};
