import type { AgentMode, RunStatus, ToolCallStatus } from '@/lib/db/schema';

/**
 * The agent streaming protocol.
 *
 * The chat endpoint returns Server-Sent Events. Each event is one JSON object
 * of type `AgentStreamEvent`, sent as `data: {...}\n\n`. SSE is used rather
 * than WebSockets because the stream is strictly server→client, it survives
 * HTTP/2 multiplexing, and it reconnects for free.
 *
 * The same union is reused by the terminal stream and the mock provider, so
 * demo mode and production render through identical UI code paths.
 */

export type AgentStreamEvent =
  /** Run accepted; UI can show the assistant bubble and the run header. */
  | {
      type: 'run.start';
      runId: string;
      messageId: string;
      conversationId: string;
      mode: AgentMode;
      modelSlug: string;
      modelDisplayName: string;
      startedAt: string;
      /**
       * The conversation's title as it now stands in the database.
       *
       * A chat is named from its first message, server-side, in the same
       * request that starts this run — so the client's copy of the row is
       * already stale by the time the stream opens. Carrying it here is what
       * lets the sidebar stop saying "New chat" without a reload. Optional
       * because only the route that owns the conversation can fill it in; the
       * runtime yields the event without one.
       */
      conversationTitle?: string;
    }
  /** Incremental assistant text. */
  | { type: 'text.delta'; text: string }
  /** Incremental reasoning/plan text, rendered in a collapsed panel. */
  | { type: 'thinking.delta'; text: string }
  /** The model decided to call a tool. */
  | {
      type: 'tool.start';
      toolCallId: string;
      toolName: string;
      source: 'builtin' | 'mcp' | 'plugin' | 'skill';
      sourceRef?: string;
      title: string;
      args: Record<string, unknown>;
      requiresApproval: boolean;
    }
  /** Streaming output from a long-running tool (terminal, build, test). */
  | { type: 'tool.delta'; toolCallId: string; chunk: string; stream?: 'stdout' | 'stderr' }
  | {
      type: 'tool.end';
      toolCallId: string;
      status: ToolCallStatus;
      resultSummary: string;
      isError: boolean;
      exitCode?: number;
      durationMs: number;
    }
  /** A destructive command or sensitive edit is waiting on the user. */
  | {
      type: 'approval.required';
      toolCallId: string;
      kind: 'command' | 'file' | 'tool';
      title: string;
      reason: string;
      preview?: string;
    }
  /**
   * The pre-flight estimate is over the operator's expensive-run threshold and
   * the caller did not acknowledge it, so no run was created and nothing was
   * charged. Terminal for this attempt — no `run.end` follows it. Resending the
   * turn with `acknowledgedCostMicroUsd` at least `estimatedMicroUsd` runs it.
   */
  | {
      type: 'cost.confirmation_required';
      /** The turn already stored for this attempt, so a retry can replace it. */
      userMessageId: string;
      estimatedMicroUsd: number;
      thresholdMicroUsd: number;
      /** How the figure was arrived at, in the same prose as the usage popover. */
      explanation: string;
      confidence: 'low' | 'medium' | 'high';
    }
  /** A file change the agent proposes; may be pending review. */
  | {
      type: 'file.change';
      path: string;
      kind: 'created' | 'modified' | 'deleted' | 'renamed';
      additions: number;
      deletions: number;
      pending: boolean;
      diff?: string;
    }
  /** Plan steps in `plan` / `auto` mode, mirrored into the Tasks tab. */
  | {
      type: 'plan.update';
      steps: Array<{ id: string; title: string; status: PlanStepStatus; detail?: string }>;
    }
  /** Live sandbox telemetry for the right rail. */
  | {
      type: 'sandbox.status';
      sandboxId: string;
      status: string;
      cpuPercent?: number;
      memoryUsedMb?: number;
      memoryLimitMb?: number;
      diskUsedMb?: number;
      message?: string;
    }
  /** Per-response accounting, shown under the assistant message. */
  | { type: 'usage'; usage: StreamUsage }
  /** Terminal, non-fatal notice (provider degraded, model fell back, …). */
  | { type: 'notice'; level: 'info' | 'warning'; message: string }
  | {
      type: 'error';
      code: AgentErrorCode;
      message: string;
      retryable: boolean;
      actionLabel?: string;
      actionHref?: string;
    }
  | {
      type: 'run.end';
      runId: string;
      status: RunStatus;
      finishReason: string;
      usage: StreamUsage;
      durationMs: number;
    };

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export type StreamUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  weightedTokens: number;
  /** Integer micro-USD charged to the team for this response. */
  chargedMicroUsd: number;
  upstreamCostMicroUsd: number;
  settlement: 'byok' | 'quota' | 'payg' | 'overage' | 'mixed';
  /** Human-readable derivation, shown in the usage popover. */
  explanation: string;
  latencyMs: number;
  timeToFirstTokenMs?: number;
};

export type AgentErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'quota_exceeded'
  | 'payment_required'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'sandbox_unavailable'
  | 'context_too_long'
  | 'cancelled'
  | 'internal';

export const AGENT_ERROR_COPY: Record<
  AgentErrorCode,
  { title: string; description: string; actionLabel?: string; actionHref?: string }
> = {
  unauthorized: {
    title: 'Signed out',
    description: 'Your session expired. Sign in again to continue this conversation.',
    actionLabel: 'Sign in',
    actionHref: '/login',
  },
  forbidden: {
    title: 'Not allowed',
    description: 'Your role in this team does not permit running the agent.',
  },
  quota_exceeded: {
    title: 'Monthly allowance spent',
    description:
      'You have used all included weighted tokens for this period. Top up your balance or upgrade to keep going.',
    actionLabel: 'Open billing',
    actionHref: '/app/billing',
  },
  payment_required: {
    title: 'Balance too low',
    description: 'Add credit to your pay-as-you-go balance to start this run.',
    actionLabel: 'Add credit',
    actionHref: '/app/billing',
  },
  rate_limited: {
    title: 'Slow down a moment',
    description:
      'Too many requests in a short window. This clears automatically in a few seconds.',
  },
  provider_unavailable: {
    title: 'Model provider unavailable',
    description:
      'The upstream provider did not respond. Karo did not charge you for this attempt — try again or pick another model.',
    actionLabel: 'Retry',
  },
  model_unavailable: {
    title: 'Model not available on your plan',
    description: 'Choose a different model, or upgrade to unlock this one.',
    actionLabel: 'View plans',
    actionHref: '/pricing',
  },
  sandbox_unavailable: {
    title: 'No machine available',
    description:
      'The agent needs a running sandbox for this task. Start one from the right-hand panel.',
  },
  context_too_long: {
    title: 'Conversation is too long',
    description:
      'This chat exceeds the model context window. Run /compact to summarise it, or start a new chat.',
  },
  cancelled: {
    title: 'Stopped',
    description: 'You stopped this response. Nothing further was charged.',
  },
  internal: {
    title: 'Something went wrong',
    description: 'The run failed unexpectedly. Your conversation is saved — try again.',
    actionLabel: 'Retry',
  },
};

/* ------------------------------------------------------------------ *
 *  Client-side view models
 * ------------------------------------------------------------------ */

export type ChatToolCallView = {
  id: string;
  toolName: string;
  source: 'builtin' | 'mcp' | 'plugin' | 'skill';
  sourceRef?: string;
  title: string;
  args: Record<string, unknown>;
  output: string;
  status: ToolCallStatus;
  requiresApproval: boolean;
  approvalReason?: string;
  isError: boolean;
  exitCode?: number;
  durationMs: number;
};

export type ChatFileChangeView = {
  path: string;
  kind: 'created' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  pending: boolean;
  diff?: string;
};

export type ChatMessageView = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string;
  status: 'pending' | 'streaming' | 'complete' | 'stopped' | 'failed';
  createdAt: string;
  modelSlug?: string;
  modelDisplayName?: string;
  agentMode?: AgentMode;
  toolCalls: ChatToolCallView[];
  fileChanges: ChatFileChangeView[];
  planSteps?: Array<{ id: string; title: string; status: PlanStepStatus; detail?: string }>;
  usage?: StreamUsage;
  error?: { code: AgentErrorCode; message: string; retryable: boolean };
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    inlineContent?: string;
  }>;
};

/** SSE framing helpers shared by every streaming route handler. */
export function encodeSse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
