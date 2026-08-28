import type {
  AgentMode,
  ConnectionStatus,
  McpTransport,
  PlanTier,
  PluginCategory,
  RunStatus,
  SandboxStatus,
} from '@/lib/db/schema';

/**
 * Serialisable views handed from Server Components to the client pieces of the
 * extensions slice (MCP, skills, plugins, sandboxes, agents).
 *
 * Two rules hold everywhere in this file:
 *  · dates are ISO strings and money is integer micro-USD, because a Client
 *    Component boundary cannot carry a `Date` or a `bigint`;
 *  · **no secret value ever appears here** — only the *names* of the keys that
 *    have a stored value, so the UI can render `••••` with a Replace action.
 */

export type LogLine = { at: string; level: string; message: string };

export type McpToolView = {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  isDestructive: boolean;
  callCount: number;
  lastCalledAt: string | null;
  discoveredAt: string;
};

export type McpServerView = {
  id: string;
  name: string;
  description: string;
  scope: 'account' | 'project';
  projectId: string | null;
  projectName: string | null;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  /** Plain (non-secret) header names and values. */
  headers: Array<{ name: string; value: string }>;
  /** Plain (non-secret) environment variables. */
  env: Array<{ key: string; value: string }>;
  /** Names of values held encrypted. Values are never sent to a browser. */
  secretKeys: string[];
  isEnabled: boolean;
  status: ConnectionStatus;
  statusMessage: string | null;
  allowedTools: string[];
  requireApproval: boolean;
  lastConnectedAt: string | null;
  lastHealthCheckAt: string | null;
  templateKey: string | null;
  toolCount: number;
  enabledToolCount: number;
  createdAt: string;
};

export type McpServerDetailView = McpServerView & {
  logs: LogLine[];
  tools: McpToolView[];
};

/** Mirrors `McpTemplateSeed` from the seed data, already serialisable. */
export type McpTemplateView = {
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env: Array<{
    key: string;
    label: string;
    required: boolean;
    secret: boolean;
    defaultValue: string;
    placeholder?: string;
    description: string;
  }>;
  suggestedAllowedTools: string[];
  requireApproval: boolean;
  docsUrl: string;
  safetyNote: string;
};

export type SlashCommandView = { name: string; description: string; prompt: string };

export type SkillEnvFieldView = {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  description?: string;
};

export type SkillView = {
  id: string;
  key: string;
  name: string;
  description: string;
  instructions: string;
  version: string;
  author: string;
  icon: string;
  category: string;
  allowedTools: string[];
  requiredPlugins: string[];
  slashCommands: SlashCommandView[];
  environmentSchema: SkillEnvFieldView[];
  origin: string;
  isOwnedByTeam: boolean;
  installCount: number;
  updatedAt: string;
};

export type InstalledSkillView = {
  id: string;
  skillId: string;
  scope: 'account' | 'project';
  projectId: string | null;
  projectName: string | null;
  isEnabled: boolean;
  version: string;
  config: Record<string, string>;
  secretKeys: string[];
  lastUsedAt: string | null;
  installedAt: string;
  skill: SkillView;
};

export type PluginPermissionView = {
  key: string;
  label: string;
  risk: 'low' | 'medium' | 'high';
};

export type PluginConfigFieldView = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  secret?: boolean;
  default?: string;
  description?: string;
};

export type PluginView = {
  id: string;
  key: string;
  name: string;
  description: string;
  longDescription: string;
  version: string;
  publisher: string;
  category: PluginCategory;
  icon: string;
  permissions: PluginPermissionView[];
  configSchema: PluginConfigFieldView[];
  providedTools: string[];
  providedCommands: Array<{ name: string; description: string }>;
  minPlanTier: PlanTier;
  requiresPrivileged: boolean;
  isVerified: boolean;
  installCount: number;
  homepageUrl: string | null;
  /** False when the team's plan tier is below `minPlanTier`. */
  planAllows: boolean;
  installed: InstalledPluginView | null;
};

export type InstalledPluginView = {
  id: string;
  pluginId: string;
  version: string;
  isEnabled: boolean;
  config: Record<string, string>;
  secretKeys: string[];
  grantedPermissions: string[];
  healthStatus: ConnectionStatus;
  healthMessage: string | null;
  lastHealthCheckAt: string | null;
  installedAt: string;
  installedByName: string;
  /** True when the catalogue row is newer than what is installed. */
  updateAvailable: boolean;
};

export type PluginAuditEntryView = {
  id: string;
  action: string;
  label: string;
  summary: string;
  actorName: string;
  at: string;
};

export type SandboxView = {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  provider: string;
  providerLabel: string;
  status: SandboxStatus;
  statusMessage: string | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  computeMultiplier: number;
  cpuPercent: number;
  memoryUsedMb: number;
  diskUsedMb: number;
  totalActiveSeconds: number;
  autoSleepMinutes: number;
  allowDocker: boolean;
  startedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  /** Compute charged for this sandbox in the current billing period. */
  periodCostMicroUsd: number;
  periodComputeHours: number;
};

export type SandboxPresetView = {
  key: string;
  label: string;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  minPlanTier: PlanTier;
  multiplier: number;
  multiplierExplanation: string;
  hourlyMicroUsd: number;
  usableMemoryMb: number;
  allowed: boolean;
};

export type AgentRunStepView = {
  id: string;
  title: string;
  status: string;
  detail?: string;
};

export type AgentToolCallView = {
  id: string;
  toolName: string;
  source: string;
  status: string;
  isError: boolean;
  requiresApproval: boolean;
  durationMs: number;
  resultSummary: string | null;
  argsPreview: string | null;
};

export type AgentRunView = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  conversationId: string;
  mode: AgentMode;
  status: RunStatus;
  iterations: number;
  maxIterations: number;
  durationMs: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalWeightedTokens: number;
  totalChargedMicroUsd: number;
  usedByok: boolean;
  modelName: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  createdAt: string;
  steps: AgentRunStepView[];
  toolCalls: AgentToolCallView[];
};

export type ProjectOptionView = {
  id: string;
  name: string;
  slug: string;
  defaultAgentMode: AgentMode;
  defaultModelId: string | null;
  permissions: Record<string, boolean>;
};

export type ModelOptionView = {
  id: string;
  displayName: string;
  family: string;
  providerName: string;
  minPlanTier: PlanTier;
  allowed: boolean;
};

export type PlanLimitsView = {
  tier: PlanTier;
  name: string;
  maxSkills: number;
  maxPlugins: number;
  maxMcpServers: number;
  maxActiveSandboxes: number;
  maxSandboxCpuCores: number;
  maxSandboxMemoryMb: number;
  allowCustomSandboxSize: boolean;
  allowPrivateSkills: boolean;
  allowDocker: boolean;
};
