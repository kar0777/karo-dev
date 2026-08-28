import type { AgentMode, RuntimeTarget, ShellKind } from '@/lib/db/schema';

/** Serialisable project shape handed from the Server Component to the browser. */
export type ProjectView = {
  id: string;
  name: string;
  slug: string;
  description: string;
  template: string;
  runtimeTarget: RuntimeTarget;
  workerId: string | null;
  defaultModelId: string | null;
  defaultAgentMode: AgentMode;
  defaultShell: ShellKind;
  modelName: string | null;
  archived: boolean;
  /** Most recent of `lastOpenedAt` and `updatedAt`, ISO-8601. */
  lastActivityAt: string;
  createdAt: string;
  /** Status of the project's most recently touched live sandbox, if any. */
  sandboxStatus: string | null;
  conversationCount: number;
};

export type ProjectDraft = {
  name: string;
  description: string;
  template: string;
  runtimeTarget: RuntimeTarget;
  workerId: string | null;
  modelId: string | null;
  agentMode: AgentMode;
  shell: ShellKind;
};

/** What `POST /api/projects` returns on success. */
export type CreateProjectResponse = {
  project: { id: string; name: string; slug: string };
};
