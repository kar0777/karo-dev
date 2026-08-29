'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';

import { toast } from '@/components/ui/toast';
import type { AgentMode } from '@/lib/db/schema';
import { ApiClientError, apiFetch, apiStream, describeError } from '@/lib/client/api';
import { AGENT_ERROR_COPY, type AgentStreamEvent } from '@/lib/types/agent';

import {
  buildSlashCommands,
  type SlashCommand,
  type SlashCommandContext,
  type SlashCommandDialog,
} from './slash-commands';
import type {
  WorkspaceActivityEntry,
  WorkspaceActivityLevel,
  WorkspaceConversation,
  WorkspaceData,
  WorkspaceFileNode,
  WorkspaceMessage,
  WorkspacePendingChange,
  WorkspaceRun,
  WorkspaceSandbox,
  WorkspaceStreamPhase,
  WorkspaceTabKey,
  WorkspaceToolCall,
} from './types';

/**
 * The workspace state hub.
 *
 * Every pane — chat, code, preview, terminal, tasks, changes — reads from this
 * one context instead of fetching for itself. That is deliberate: a file the
 * agent writes has to appear in the explorer, the editor tab, the Changes tab
 * and the activity log at the same instant, and the only way to guarantee that
 * is a single owner of the stream.
 */

export type ComposerAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Text content, or a `data:` URL for images. */
  inlineContent: string;
};

export type OpenFile = {
  path: string;
  content: string;
  savedContent: string;
  language: string;
  loading: boolean;
  error: string | null;
};

export type TerminalRequest = { command: string; nonce: number };

/**
 * An attempt the server refused because its estimate crossed the admin's
 * expensive-run threshold. Nothing ran and nothing was charged; everything
 * needed to send it again — with the cost acknowledged — is kept here.
 */
export type PendingCostConfirmation = {
  /** Pinned to the attempt, not to the selection: the user may move on and come back. */
  conversationId: string;
  /** The turn the server stored for the refused attempt. */
  userMessageId: string;
  content: string;
  attachments?: ComposerAttachment[];
  estimatedMicroUsd: number;
  thresholdMicroUsd: number;
  explanation: string;
  confidence: 'low' | 'medium' | 'high';
};

type WorkspaceContextValue = {
  data: WorkspaceData;

  /**
   * Text the composer should start with, from `?prompt=` on the workspace URL.
   * The onboarding wizard sends the user's very first prompt this way, so the
   * workspace opens with it typed and ready rather than losing it on the
   * redirect. Empty string when there is nothing to seed.
   */
  initialPrompt: string;

  /* Layout */
  tab: WorkspaceTabKey;
  setTab: (tab: WorkspaceTabKey) => void;
  leftCollapsed: boolean;
  setLeftCollapsed: (value: boolean) => void;
  rightCollapsed: boolean;
  setRightCollapsed: (value: boolean) => void;

  /* Conversations */
  conversations: WorkspaceConversation[];
  activeConversationId: string | null;
  messages: WorkspaceMessage[];
  messagesLoading: boolean;
  messagesError: string | null;
  selectConversation: (id: string) => void;
  createConversation: () => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  clearConversation: () => void;
  compactConversation: () => void;
  reloadMessages: () => void;

  /* Agent config */
  modelId: string | null;
  setModelId: (id: string) => void;
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;

  /* Streaming */
  phase: WorkspaceStreamPhase;
  isStreaming: boolean;
  sendMessage: (content: string, attachments?: ComposerAttachment[]) => void;
  stopRun: () => void;
  retryLast: () => void;
  regenerate: (assistantMessageId: string) => void;
  editAndResend: (messageId: string, content: string) => void;
  decideApproval: (toolCallId: string, decision: 'approve' | 'reject', reason?: string) => void;

  /* Expensive-run confirmation */
  pendingCostConfirmation: PendingCostConfirmation | null;
  confirmPendingCost: () => void;
  cancelPendingCost: () => void;

  /* Files */
  files: WorkspaceFileNode[];
  filesLoading: boolean;
  filesError: string | null;
  refreshFiles: () => void;
  createFile: (path: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  renameFile: (from: string, to: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<{ content: string; language: string }>;
  saveFile: (path: string, content: string) => Promise<void>;

  /* Editor tabs */
  openFiles: OpenFile[];
  activeFilePath: string | null;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveFilePath: (path: string) => void;
  updateFileDraft: (path: string, content: string) => void;

  /* Pending changes */
  pendingChanges: WorkspacePendingChange[];
  changesLoading: boolean;
  changesError: string | null;
  refreshChanges: () => void;
  applyChanges: (paths: string[]) => Promise<void>;
  rejectChanges: (paths: string[]) => Promise<void>;

  /* Sandbox */
  sandbox: WorkspaceSandbox | null;
  sandboxBusy: boolean;
  createSandbox: () => Promise<void>;
  startSandbox: () => void;
  stopSandbox: () => void;
  restartSandbox: () => void;

  /* Terminal bridge */
  terminalRequest: TerminalRequest | null;
  runInTerminal: (command: string) => void;

  /* Runs */
  runs: WorkspaceRun[];
  activeRunId: string | null;

  /* Activity + notices */
  activity: WorkspaceActivityEntry[];
  notify: (level: WorkspaceActivityLevel, message: string, detail?: string) => void;

  /* Misc UI */
  dialog: SlashCommandDialog | null;
  openDialog: (dialog: SlashCommandDialog) => void;
  closeDialog: () => void;
  fileSearchNonce: number;
  focusFileSearch: () => void;
  slashCommands: SlashCommand[];
  runSlashCommand: (command: SlashCommand, args: string) => void;
  sessionUsage: { weightedTokens: number; chargedMicroUsd: number; messages: number };
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = React.useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside <WorkspaceProvider>.');
  return value;
}

const PENDING_ASSISTANT_ID = '__streaming_assistant__';

type CostConfirmationEvent = Extract<AgentStreamEvent, { type: 'cost.confirmation_required' }>;

let localIdCounter = 0;
function localId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${localIdCounter}`;
}

function toolCallSort(a: WorkspaceToolCall, b: WorkspaceToolCall): number {
  return a.id.localeCompare(b.id);
}

/* ------------------------------------------------------------------ *
 *  Provider
 * ------------------------------------------------------------------ */

export function WorkspaceProvider({
  data,
  initialPrompt = '',
  children,
}: {
  data: WorkspaceData;
  initialPrompt?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const [tab, setTab] = React.useState<WorkspaceTabKey>('chat');
  const [leftCollapsed, setLeftCollapsed] = React.useState(false);
  const [rightCollapsed, setRightCollapsed] = React.useState(false);

  const [conversations, setConversations] = React.useState(data.conversations);
  const [activeConversationId, setActiveConversationId] = React.useState(
    data.activeConversationId,
  );
  const [messages, setMessages] = React.useState<WorkspaceMessage[]>(data.messages);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [messagesError, setMessagesError] = React.useState<string | null>(null);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;

  /**
   * The first model in the preference list that is actually on offer.
   *
   * `data.models` is not the catalogue: `loadWorkspaceData` drops models above
   * the team's plan tier and models whose provider has no credentials. A
   * project's `defaultModelId` and a conversation's stored `modelId` are plain
   * foreign keys that know nothing about either filter, so a project pointed at
   * a model whose provider was never configured seeded the picker with an id
   * that had no option — the trigger fell back to "Choose a model" while the
   * composer priced `models[0]`, and the id that would have been *sent* was the
   * unreachable one. Preferring a stored id only when it survived the filter is
   * what keeps the control, the estimate and the request talking about the same
   * model.
   */
  const resolveModelId = React.useCallback(
    (...preferred: Array<string | null | undefined>): string | null => {
      for (const candidate of preferred) {
        if (candidate && data.models.some((model) => model.id === candidate)) return candidate;
      }
      return data.models.find((model) => model.isDefault)?.id ?? data.models[0]?.id ?? null;
    },
    [data.models],
  );

  const [modelId, setModelIdState] = React.useState<string | null>(() =>
    resolveModelId(activeConversation?.modelId, data.project.defaultModelId),
  );
  const [mode, setModeState] = React.useState<AgentMode>(
    activeConversation?.agentMode ?? data.project.defaultAgentMode,
  );

  const [phase, setPhase] = React.useState<WorkspaceStreamPhase>('idle');
  const [pendingCostConfirmation, setPendingCostConfirmation] =
    React.useState<PendingCostConfirmation | null>(null);

  const [files, setFiles] = React.useState(data.files);
  const [filesLoading, setFilesLoading] = React.useState(false);
  const [filesError, setFilesError] = React.useState<string | null>(null);

  const [openFiles, setOpenFiles] = React.useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePathState] = React.useState<string | null>(null);

  const [pendingChanges, setPendingChanges] = React.useState(data.pendingChanges);
  const [changesLoading, setChangesLoading] = React.useState(false);
  const [changesError, setChangesError] = React.useState<string | null>(null);

  const [sandbox, setSandbox] = React.useState(data.sandbox);
  const [sandboxBusy, setSandboxBusy] = React.useState(false);

  const [terminalRequest, setTerminalRequest] = React.useState<TerminalRequest | null>(null);
  const [runs, setRuns] = React.useState(data.runs);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [activity, setActivity] = React.useState<WorkspaceActivityEntry[]>([]);
  const [dialog, setDialog] = React.useState<SlashCommandDialog | null>(null);
  const [fileSearchNonce, setFileSearchNonce] = React.useState(0);
  const [sessionUsage, setSessionUsage] = React.useState({
    weightedTokens: 0,
    chargedMicroUsd: 0,
    messages: 0,
  });

  const abortRef = React.useRef<AbortController | null>(null);
  const assistantIdRef = React.useRef<string>(PENDING_ASSISTANT_ID);
  const runIdRef = React.useRef<string | null>(null);
  const projectId = data.project.id;

  /**
   * The live active conversation id, for callbacks that must not read a stale
   * one.
   *
   * `handleEvent` is rebuilt on render, but a run that starts in the same tick
   * as `setActiveConversationId` keeps the closure captured *before* it — so
   * `run.end` used to compare against the previous id (usually `null`, on the
   * very first message) and update no row at all. The sidebar then kept saying
   * "New chat · no messages" for a chat that plainly had some, until a reload
   * re-read the truth from the server.
   */
  const activeConversationIdRef = React.useRef<string | null>(data.activeConversationId);

  const adoptConversationId = React.useCallback((id: string | null) => {
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
  }, []);

  /**
   * Held for the whole of a send, including the part before the stream exists.
   *
   * `isStreaming` is derived from `phase`, and `phase` only becomes `starting`
   * inside `runStream` — which is reached after awaiting `ensureConversation`.
   * A second Enter pressed during that gap passed the guard, so two runs
   * streamed into the same `assistantIdRef` bubble (two models answering one
   * question) and `ensureConversation`, seeing `activeConversationId` still
   * `null` in both closures, created two conversations. A ref flips
   * synchronously, which is the only thing that closes a window this short.
   */
  const sendingRef = React.useRef(false);

  /** In-flight "create the first conversation", so two senders share one row. */
  const ensureRef = React.useRef<Promise<string> | null>(null);

  const isStreaming = phase !== 'idle';

  /* ---------------- Activity log ---------------- */

  const notify = React.useCallback(
    (level: WorkspaceActivityLevel, message: string, detail?: string) => {
      setActivity((prev) =>
        [
          {
            id: localId('act'),
            at: new Date().toISOString(),
            level,
            message,
            ...(detail ? { detail } : {}),
          },
          ...prev,
        ].slice(0, 120),
      );
      if (level === 'error') toast.error(message, detail ? { description: detail } : undefined);
      else if (level === 'warning')
        toast.warning(message, detail ? { description: detail } : undefined);
    },
    [],
  );

  const reportError = React.useCallback(
    (error: unknown, fallback: string) => {
      const described = describeError(error);
      notify('error', described.title || fallback, described.message);
    },
    [notify],
  );

  /* ---------------- Message helpers ---------------- */

  const patchAssistant = React.useCallback(
    (patch: (message: WorkspaceMessage) => WorkspaceMessage) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantIdRef.current ? patch(message) : message,
        ),
      );
    },
    [],
  );

  const patchToolCall = React.useCallback(
    (toolCallId: string, patch: (call: WorkspaceToolCall) => WorkspaceToolCall) => {
      patchAssistant((message) => ({
        ...message,
        toolCalls: message.toolCalls.map((call) =>
          call.id === toolCallId ? patch(call) : call,
        ),
      }));
    },
    [patchAssistant],
  );

  /* ---------------- Stream event handling ---------------- */

  const handleEvent = React.useCallback(
    (event: AgentStreamEvent) => {
      switch (event.type) {
        case 'run.start': {
          runIdRef.current = event.runId;
          setActiveRunId(event.runId);
          // The server names a chat from its first message. Without adopting it
          // here every conversation stayed "New chat" in the sidebar until a
          // reload, which made a list of them indistinguishable — the reason
          // saved chats looked like they had not been saved.
          if (event.conversationTitle) {
            const title = event.conversationTitle;
            setConversations((prev) =>
              prev.map((conversation) =>
                conversation.id === event.conversationId
                  ? { ...conversation, title }
                  : conversation,
              ),
            );
          }
          const previousId = assistantIdRef.current;
          assistantIdRef.current = event.messageId;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === previousId
                ? {
                    ...message,
                    id: event.messageId,
                    runId: event.runId,
                    status: 'streaming',
                    modelSlug: event.modelSlug,
                    modelDisplayName: event.modelDisplayName,
                    agentMode: event.mode,
                  }
                : message,
            ),
          );
          setRuns((prev) => [
            {
              id: event.runId,
              title: 'Agent run',
              status: 'running',
              mode: event.mode,
              steps: [],
              totalInputTokens: 0,
              totalOutputTokens: 0,
              totalWeightedTokens: 0,
              totalChargedMicroUsd: 0,
              errorMessage: null,
              createdAt: event.startedAt,
              startedAt: event.startedAt,
              finishedAt: null,
            },
            ...prev.filter((run) => run.id !== event.runId),
          ]);
          setPhase('streaming');
          break;
        }

        case 'text.delta':
          patchAssistant((message) => ({ ...message, content: message.content + event.text }));
          break;

        case 'thinking.delta':
          patchAssistant((message) => ({
            ...message,
            thinking: (message.thinking ?? '') + event.text,
          }));
          break;

        case 'tool.start': {
          const call: WorkspaceToolCall = {
            id: event.toolCallId,
            toolName: event.toolName,
            source: event.source,
            title: event.title,
            args: event.args,
            output: '',
            status: 'running',
            requiresApproval: event.requiresApproval,
            isError: false,
            durationMs: 0,
            startedAtMs: Date.now(),
            ...(event.sourceRef ? { sourceRef: event.sourceRef } : {}),
          };
          patchAssistant((message) => ({
            ...message,
            toolCalls: [...message.toolCalls.filter((c) => c.id !== call.id), call].sort(
              toolCallSort,
            ),
          }));
          break;
        }

        case 'tool.delta':
          patchToolCall(event.toolCallId, (call) => ({
            ...call,
            output: call.output + event.chunk,
          }));
          break;

        case 'tool.end':
          patchToolCall(event.toolCallId, (call) => ({
            ...call,
            status: event.status,
            isError: event.isError,
            durationMs: event.durationMs,
            resultSummary: event.resultSummary,
            ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
          }));
          if (event.isError) {
            notify('warning', `Tool failed: ${event.resultSummary}`);
          }
          break;

        case 'approval.required':
          setPhase('awaiting_approval');
          patchToolCall(event.toolCallId, (call) => ({
            ...call,
            status: 'awaiting_approval',
            requiresApproval: true,
            approvalReason: event.reason,
            approvalKind: event.kind,
            ...(event.preview ? { approvalPreview: event.preview } : {}),
          }));
          notify('warning', event.title, event.reason);
          break;

        case 'cost.confirmation_required':
          // No run was created, so the placeholder will never become a reply.
          // `runStream` picks the refusal up from here: it is the only place
          // that still holds the text and attachments a retry has to resend.
          setMessages((prev) =>
            prev.filter((message) => message.id !== assistantIdRef.current),
          );
          break;

        case 'file.change': {
          patchAssistant((message) => ({
            ...message,
            fileChanges: [
              ...message.fileChanges.filter((change) => change.path !== event.path),
              {
                path: event.path,
                kind: event.kind,
                additions: event.additions,
                deletions: event.deletions,
                pending: event.pending,
                ...(event.diff ? { diff: event.diff } : {}),
              },
            ],
          }));
          if (event.pending) {
            setPendingChanges((prev) => [
              ...prev.filter((change) => change.path !== event.path),
              {
                path: event.path,
                kind: event.kind,
                additions: event.additions,
                deletions: event.deletions,
                diff: event.diff ?? '',
              },
            ]);
          }
          setFiles((prev) =>
            prev.map((file) =>
              file.path === event.path ? { ...file, pendingChangeKind: event.kind } : file,
            ),
          );
          break;
        }

        case 'plan.update':
          patchAssistant((message) => ({ ...message, planSteps: event.steps }));
          setRuns((prev) =>
            prev.map((run) =>
              run.id === runIdRef.current ? { ...run, steps: event.steps } : run,
            ),
          );
          break;

        case 'sandbox.status':
          setSandbox((prev) =>
            prev && prev.id === event.sandboxId
              ? {
                  ...prev,
                  status: event.status as WorkspaceSandbox['status'],
                  statusMessage: event.message ?? prev.statusMessage,
                  cpuPercent: event.cpuPercent ?? prev.cpuPercent,
                  memoryUsedMb: event.memoryUsedMb ?? prev.memoryUsedMb,
                  diskUsedMb: event.diskUsedMb ?? prev.diskUsedMb,
                }
              : prev,
          );
          break;

        case 'usage':
          patchAssistant((message) => ({ ...message, usage: event.usage }));
          break;

        case 'notice':
          notify(event.level === 'warning' ? 'warning' : 'info', event.message);
          break;

        case 'error': {
          const copy = AGENT_ERROR_COPY[event.code];
          patchAssistant((message) => ({
            ...message,
            status: 'failed',
            error: { code: event.code, message: event.message, retryable: event.retryable },
          }));
          notify('error', copy?.title ?? 'Run failed', event.message);
          break;
        }

        case 'run.end': {
          const finalStatus =
            event.status === 'cancelled'
              ? 'stopped'
              : event.status === 'failed'
                ? 'failed'
                : 'complete';
          patchAssistant((message) => ({
            ...message,
            status: message.status === 'failed' ? 'failed' : finalStatus,
            usage: event.usage,
          }));
          setRuns((prev) =>
            prev.map((run) =>
              run.id === event.runId
                ? {
                    ...run,
                    status: event.status,
                    finishedAt: new Date().toISOString(),
                    totalInputTokens: event.usage.inputTokens,
                    totalOutputTokens: event.usage.outputTokens,
                    totalWeightedTokens: event.usage.weightedTokens,
                    totalChargedMicroUsd: event.usage.chargedMicroUsd,
                  }
                : run,
            ),
          );
          setSessionUsage((prev) => ({
            weightedTokens: prev.weightedTokens + event.usage.weightedTokens,
            chargedMicroUsd: prev.chargedMicroUsd + event.usage.chargedMicroUsd,
            messages: prev.messages + 1,
          }));
          setConversations((prev) =>
            prev.map((conversation) =>
              conversation.id === activeConversationIdRef.current
                ? {
                    ...conversation,
                    messageCount: conversation.messageCount + 2,
                    totalWeightedTokens:
                      conversation.totalWeightedTokens + event.usage.weightedTokens,
                    totalChargedMicroUsd:
                      conversation.totalChargedMicroUsd + event.usage.chargedMicroUsd,
                    lastMessageAt: new Date().toISOString(),
                  }
                : conversation,
            ),
          );
          notify(
            event.status === 'succeeded' ? 'success' : 'info',
            `Run ${event.status} · ${event.finishReason}`,
          );
          break;
        }

        default:
          break;
      }
    },
    [notify, patchAssistant, patchToolCall],
  );

  /* ---------------- Sending ---------------- */

  const ensureConversation = React.useCallback(async (): Promise<string> => {
    const current = activeConversationIdRef.current;
    if (current) return current;
    // Deduped rather than merely awaited: two callers arriving before the POST
    // returns must join the same request, or the project collects an orphan
    // conversation for every extra one.
    const inFlight = ensureRef.current;
    if (inFlight) return inFlight;

    const request = (async () => {
      const created = await apiFetch<{ conversation: WorkspaceConversation }>(
        `/api/projects/${projectId}/conversations`,
        { json: { modelId, agentMode: mode } },
      );
      setConversations((prev) => [created.conversation, ...prev]);
      adoptConversationId(created.conversation.id);
      return created.conversation.id;
    })();

    ensureRef.current = request;
    try {
      return await request;
    } finally {
      ensureRef.current = null;
    }
  }, [adoptConversationId, mode, modelId, projectId]);

  const runStream = React.useCallback(
    async (
      conversationId: string,
      content: string,
      attachments?: ComposerAttachment[],
      acknowledgedCostMicroUsd?: number,
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;
      assistantIdRef.current = PENDING_ASSISTANT_ID;
      runIdRef.current = null;
      setPhase('starting');

      const userBubbleId = localId('umsg');
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        {
          id: userBubbleId,
          role: 'user',
          content,
          status: 'complete',
          createdAt: now,
          toolCalls: [],
          fileChanges: [],
          ...(attachments && attachments.length
            ? {
                attachments: attachments.map((attachment) => ({
                  id: attachment.id,
                  filename: attachment.filename,
                  mimeType: attachment.mimeType,
                  sizeBytes: attachment.sizeBytes,
                  inlineContent: attachment.inlineContent,
                })),
              }
            : {}),
        },
        {
          id: PENDING_ASSISTANT_ID,
          role: 'assistant',
          content: '',
          status: 'streaming',
          createdAt: now,
          agentMode: mode,
          toolCalls: [],
          fileChanges: [],
        },
      ]);

      // A refusal is terminal for this attempt, so it is collected here rather
      // than in `handleEvent`: assembling the retry needs the text and the
      // attachments, and this is the only scope that still has them.
      const refusal: { event: CostConfirmationEvent | null } = { event: null };

      try {
        await apiStream(
          `/api/conversations/${conversationId}/messages`,
          {
            json: {
              content,
              mode,
              ...(modelId ? { modelId } : {}),
              ...(acknowledgedCostMicroUsd === undefined ? {} : { acknowledgedCostMicroUsd }),
              ...(attachments && attachments.length
                ? {
                    attachments: attachments.map((attachment) => ({
                      filename: attachment.filename,
                      mimeType: attachment.mimeType,
                      sizeBytes: attachment.sizeBytes,
                      inlineContent: attachment.inlineContent,
                    })),
                  }
                : {}),
            },
            signal: controller.signal,
          },
          (event) => {
            if (event.type === 'cost.confirmation_required') refusal.event = event;
            handleEvent(event);
          },
        );

        const refused = refusal.event;
        if (refused) {
          // The turn is stored under the id the refusal carries. Adopting it on
          // the bubble keeps its edit and retry actions addressing the real row
          // instead of a client-side placeholder id the server never saw.
          setMessages((prev) =>
            prev.map((message) =>
              message.id === userBubbleId ? { ...message, id: refused.userMessageId } : message,
            ),
          );
          setPendingCostConfirmation({
            conversationId,
            userMessageId: refused.userMessageId,
            content,
            ...(attachments && attachments.length ? { attachments } : {}),
            estimatedMicroUsd: refused.estimatedMicroUsd,
            thresholdMicroUsd: refused.thresholdMicroUsd,
            explanation: refused.explanation,
            confidence: refused.confidence,
          });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          patchAssistant((message) => ({ ...message, status: 'stopped' }));
        } else if (error instanceof ApiClientError) {
          patchAssistant((message) => ({
            ...message,
            status: 'failed',
            error: {
              code: 'internal',
              message: error.message,
              retryable: error.retryable,
            },
          }));
          notify('error', error.title, error.message);
        } else {
          reportError(error, 'The agent stream failed');
          patchAssistant((message) => ({ ...message, status: 'failed' }));
        }
      } finally {
        abortRef.current = null;
        setPhase('idle');
        setMessages((prev) =>
          prev.map((message) =>
            message.status === 'streaming' ? { ...message, status: 'complete' } : message,
          ),
        );
      }
    },
    [handleEvent, mode, modelId, notify, patchAssistant, reportError],
  );

  const sendMessage = React.useCallback(
    (content: string, attachments?: ComposerAttachment[]) => {
      const body = content.trim();
      if (!body && !(attachments && attachments.length)) return;
      if (!data.capabilities.canRunAgent) {
        notify(
          'warning',
          'Your role cannot run the agent',
          'Ask a team admin for the Developer role to send messages.',
        );
        return;
      }
      if (isStreaming || sendingRef.current) {
        notify(
          'info',
          'A run is already in progress.',
          'Stop it before sending another message.',
        );
        return;
      }
      sendingRef.current = true;
      void (async () => {
        try {
          const conversationId = await ensureConversation();
          await runStream(conversationId, body, attachments);
        } catch (error) {
          reportError(error, 'Could not send the message');
          setPhase('idle');
        } finally {
          sendingRef.current = false;
        }
      })();
    },
    [
      data.capabilities.canRunAgent,
      ensureConversation,
      isStreaming,
      notify,
      reportError,
      runStream,
    ],
  );

  const confirmPendingCost = React.useCallback(() => {
    const pending = pendingCostConfirmation;
    if (!pending) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setPendingCostConfirmation(null);
    void (async () => {
      try {
        // The refused attempt stored the turn before the estimate was known, and
        // the acknowledged retry stores it again. Dropping the first copy is what
        // keeps the agent from reading the same question twice.
        await apiFetch(`/api/messages/${pending.userMessageId}`, { method: 'DELETE' });
        setMessages((prev) => prev.filter((message) => message.id !== pending.userMessageId));
        await runStream(
          pending.conversationId,
          pending.content,
          pending.attachments,
          pending.estimatedMicroUsd,
        );
      } catch (error) {
        reportError(error, 'Could not start the run');
      } finally {
        sendingRef.current = false;
      }
    })();
  }, [pendingCostConfirmation, reportError, runStream]);

  const cancelPendingCost = React.useCallback(() => {
    setPendingCostConfirmation(null);
    notify(
      'info',
      'Run not started.',
      'Nothing was charged. Your message is still in the chat — edit or resend it whenever you want.',
    );
  }, [notify]);

  const stopRun = React.useCallback(() => {
    const conversationId = activeConversationId;
    abortRef.current?.abort();
    if (!conversationId) return;
    void apiFetch(`/api/conversations/${conversationId}/stop`, { json: {} }).catch(() => {
      // The local abort already stopped rendering; a failed server cancel is
      // logged rather than shouted about.
      notify('info', 'The run was stopped locally.', 'The server may still be finishing up.');
    });
  }, [activeConversationId, notify]);

  const truncateAndSend = React.useCallback(
    (fromMessageId: string, content: string) => {
      const conversationId = activeConversationIdRef.current;
      if (!conversationId) return;
      if (isStreaming || sendingRef.current) {
        notify('info', 'A run is already in progress.', 'Stop it before resending.');
        return;
      }
      sendingRef.current = true;
      const index = messages.findIndex((message) => message.id === fromMessageId);
      void (async () => {
        try {
          if (!fromMessageId.startsWith('umsg_') && !fromMessageId.startsWith('__')) {
            await apiFetch(`/api/messages/${fromMessageId}`, { method: 'DELETE' });
          }
          setMessages((prev) => (index >= 0 ? prev.slice(0, index) : prev));
          await runStream(conversationId, content);
        } catch (error) {
          reportError(error, 'Could not resend the message');
        } finally {
          sendingRef.current = false;
        }
      })();
    },
    [isStreaming, messages, notify, reportError, runStream],
  );

  const retryLast = React.useCallback(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) {
      notify('info', 'Nothing to retry yet.');
      return;
    }
    truncateAndSend(lastUser.id, lastUser.content);
  }, [messages, notify, truncateAndSend]);

  const regenerate = React.useCallback(
    (assistantMessageId: string) => {
      const index = messages.findIndex((message) => message.id === assistantMessageId);
      if (index < 1) {
        retryLast();
        return;
      }
      for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = messages[i];
        if (candidate?.role === 'user') {
          truncateAndSend(candidate.id, candidate.content);
          return;
        }
      }
      retryLast();
    },
    [messages, retryLast, truncateAndSend],
  );

  const editAndResend = React.useCallback(
    (messageId: string, content: string) => {
      truncateAndSend(messageId, content);
    },
    [truncateAndSend],
  );

  const decideApproval = React.useCallback(
    (toolCallId: string, decision: 'approve' | 'reject', reason?: string) => {
      /*
       * The run id comes from the message that owns this call, not only from
       * `runIdRef`. The ref is populated by a live stream, so after a reload —
       * the normal way to come back to a run parked on approval — it was null
       * and every button answered "This approval expired", even though the row
       * was still `awaiting_approval` and the API would have accepted it.
       */
      const owner = messages.find((message) =>
        message.toolCalls.some((call) => call.id === toolCallId),
      );
      const runId = owner?.runId ?? runIdRef.current;
      if (!runId) {
        notify('warning', 'This approval expired.', 'Start the request again.');
        return;
      }

      patchToolCall(toolCallId, (call) => ({
        ...call,
        status: decision === 'approve' ? 'running' : 'rejected',
      }));

      /*
       * Deliberately *not* `setPhase('streaming')`.
       *
       * Approving runs the one tool call and returns; there is no stream behind
       * it. Setting the streaming phase here left `isStreaming` true forever —
       * the composer kept showing Stop, `sendMessage` refused with "a run is
       * already in progress", switching conversations was blocked, and the
       * unload warning stayed armed. The only ways out were pressing Stop on a
       * run that had already finished, or reloading. The toast made it worse by
       * promising the agent was continuing when nothing was.
       */
      void apiFetch<{
        status: 'succeeded' | 'failed' | 'rejected';
        summary?: string;
        isError?: boolean;
        needsFollowUp?: boolean;
        discardedPath?: string | null;
        fileChanges?: Array<{ path: string }>;
      }>(`/api/runs/${runId}/approve`, {
        json: { toolCallId, decision, ...(reason ? { reason } : {}) },
      })
        .then((result) => {
          patchToolCall(toolCallId, (call) => ({
            ...call,
            status: result.status,
            isError: Boolean(result.isError),
            ...(result.summary ? { resultSummary: result.summary } : {}),
          }));

          if (decision === 'reject') {
            notify('info', 'Rejected.', 'The proposal was discarded.');
          } else if (result.isError) {
            notify('error', 'That step failed after approval.', result.summary);
          } else {
            // The server reports `needsFollowUp` when the agent would have more
            // to do. Karo does not resume a finished run by itself, so say that
            // rather than claim it is already happening.
            notify(
              'success',
              `Approved — ${result.summary ?? 'the step ran'}.`,
              result.needsFollowUp
                ? 'Send another message when you want the agent to carry on from here.'
                : undefined,
            );
          }
          // A decided file proposal is no longer pending, either because it was
          // applied or because it was discarded. Reconciled from the response
          // rather than by refetching: the server has just told us exactly which
          // paths moved.
          const settled = [
            ...(result.fileChanges ?? []).map((change) => change.path),
            ...(result.discardedPath ? [result.discardedPath] : []),
          ];
          if (settled.length > 0) {
            setPendingChanges((prev) =>
              prev.filter((change) => !settled.includes(change.path)),
            );
            setFiles((prev) =>
              prev.map((file) =>
                settled.includes(file.path) ? { ...file, pendingChangeKind: null } : file,
              ),
            );
          }
        })
        .catch((error: unknown) => {
          patchToolCall(toolCallId, (call) => ({ ...call, status: 'awaiting_approval' }));
          reportError(error, 'Could not record your decision');
        });
    },
    [messages, notify, patchToolCall, reportError],
  );

  /* ---------------- Conversation operations ---------------- */

  const loadConversation = React.useCallback(
    (id: string) => {
      setMessagesLoading(true);
      setMessagesError(null);
      void apiFetch<{ conversation: WorkspaceConversation; messages: WorkspaceMessage[] }>(
        `/api/conversations/${id}`,
      )
        .then((payload) => {
          setMessages(payload.messages ?? []);
          setModelIdState(resolveModelId(payload.conversation.modelId, modelId));
          setModeState(payload.conversation.agentMode ?? mode);
          setConversations((prev) =>
            prev.map((conversation) =>
              conversation.id === id
                ? { ...conversation, ...payload.conversation }
                : conversation,
            ),
          );
        })
        .catch((error: unknown) => {
          setMessagesError(describeError(error).message);
        })
        .finally(() => setMessagesLoading(false));
    },
    [mode, modelId, resolveModelId],
  );

  const selectConversation = React.useCallback(
    (id: string) => {
      if (id === activeConversationId) return;
      if (isStreaming) {
        notify('info', 'Stop the current run before switching conversations.');
        return;
      }
      adoptConversationId(id);
      loadConversation(id);
    },
    [activeConversationId, adoptConversationId, isStreaming, loadConversation, notify],
  );

  const createConversation = React.useCallback(() => {
    void apiFetch<{ conversation: WorkspaceConversation }>(
      `/api/projects/${projectId}/conversations`,
      { json: { modelId, agentMode: mode } },
    )
      .then((payload) => {
        setConversations((prev) => [payload.conversation, ...prev]);
        adoptConversationId(payload.conversation.id);
        setMessages([]);
        setTab('chat');
        notify('success', 'New chat started.');
      })
      .catch((error: unknown) => reportError(error, 'Could not start a new chat'));
  }, [adoptConversationId, mode, modelId, notify, projectId, reportError]);

  const renameConversation = React.useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === id ? { ...conversation, title: trimmed } : conversation,
        ),
      );
      void apiFetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        json: { title: trimmed },
      }).catch((error: unknown) => reportError(error, 'Could not rename the chat'));
    },
    [reportError],
  );

  const deleteConversation = React.useCallback(
    (id: string) => {
      const remaining = conversations.filter((conversation) => conversation.id !== id);
      setConversations(remaining);
      if (id === activeConversationId) {
        const next = remaining[0] ?? null;
        adoptConversationId(next?.id ?? null);
        if (next) loadConversation(next.id);
        else setMessages([]);
      }
      void apiFetch(`/api/conversations/${id}`, { method: 'DELETE' }).catch((error: unknown) =>
        reportError(error, 'Could not delete the chat'),
      );
    },
    [activeConversationId, adoptConversationId, conversations, loadConversation, reportError],
  );

  const clearConversation = React.useCallback(() => {
    if (activeConversationId) deleteConversation(activeConversationId);
    createConversation();
  }, [activeConversationId, createConversation, deleteConversation]);

  const compactConversation = React.useCallback(() => {
    const id = activeConversationId;
    if (!id) {
      notify('info', 'There is nothing to compact yet.');
      return;
    }
    setMessagesLoading(true);
    void apiFetch(`/api/conversations/${id}/compact`, { json: {} })
      .then(() => {
        notify('success', 'History summarised.', 'Older turns were replaced with a summary.');
        loadConversation(id);
      })
      .catch((error: unknown) => reportError(error, 'Could not compact the conversation'))
      .finally(() => setMessagesLoading(false));
  }, [activeConversationId, loadConversation, notify, reportError]);

  const reloadMessages = React.useCallback(() => {
    if (activeConversationId) loadConversation(activeConversationId);
  }, [activeConversationId, loadConversation]);

  /* ---------------- Files ---------------- */

  const refreshFiles = React.useCallback(() => {
    setFilesLoading(true);
    setFilesError(null);
    /*
     * `recursive=true` is not optional here.
     *
     * Without it the route answers like `ls` — one level, with directories as
     * synthesised entries and nothing underneath them. The first paint comes
     * from `loadWorkspaceData`, which reads the whole flat subtree, so the tree
     * looked right until something called this: creating a file, deleting one,
     * renaming, or applying the agent's changes all refresh, and each one
     * replaced a full tree with a single level. Everything the agent had
     * written into `src/` vanished from the explorer until a reload.
     */
    void apiFetch<{ files: Array<Partial<WorkspaceFileNode>> }>(
      `/api/projects/${projectId}/files?recursive=true`,
    )
      .then((payload) => {
        setFiles(
          (payload.files ?? []).map((file) => ({
            path: file.path ?? '',
            name: file.name ?? (file.path ?? '').split('/').pop() ?? '',
            isDirectory: Boolean(file.isDirectory),
            sizeBytes: file.sizeBytes ?? 0,
            language: file.language ?? null,
            updatedAt: file.updatedAt ?? new Date().toISOString(),
            pendingChangeKind: file.pendingChangeKind ?? null,
          })),
        );
      })
      .catch((error: unknown) => setFilesError(describeError(error).message))
      .finally(() => setFilesLoading(false));
  }, [projectId]);

  const readFile = React.useCallback(
    async (path: string) => {
      const payload = await apiFetch<{ content: string; language?: string | null }>(
        `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      );
      return { content: payload.content ?? '', language: payload.language ?? 'plaintext' };
    },
    [projectId],
  );

  const saveFile = React.useCallback(
    async (path: string, content: string) => {
      await apiFetch(`/api/projects/${projectId}/files/content`, {
        method: 'PUT',
        json: { path, content },
      });
      setOpenFiles((prev) =>
        prev.map((file) => (file.path === path ? { ...file, savedContent: content } : file)),
      );
    },
    [projectId],
  );

  const createFile = React.useCallback(
    async (path: string) => {
      await apiFetch(`/api/projects/${projectId}/files/content`, {
        method: 'PUT',
        json: { path, content: '' },
      });
      notify('success', `Created ${path}`);
      refreshFiles();
    },
    [notify, projectId, refreshFiles],
  );

  const createFolder = React.useCallback(
    async (path: string) => {
      // Object stores and the DB-backed workspace both track files, not empty
      // directories — a `.gitkeep` is the honest way to materialise one.
      const keep = `${path.replace(/\/+$/, '')}/.gitkeep`;
      await apiFetch(`/api/projects/${projectId}/files/content`, {
        method: 'PUT',
        json: { path: keep, content: '' },
      });
      notify('success', `Created ${path}`, 'Added a .gitkeep so the folder is tracked.');
      refreshFiles();
    },
    [notify, projectId, refreshFiles],
  );

  const deleteFile = React.useCallback(
    async (path: string) => {
      await apiFetch(
        `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
        { method: 'DELETE' },
      );
      setOpenFiles((prev) => prev.filter((file) => file.path !== path));
      setActiveFilePathState((current) => (current === path ? null : current));
      notify('success', `Deleted ${path}`);
      refreshFiles();
    },
    [notify, projectId, refreshFiles],
  );

  const renameFile = React.useCallback(
    async (from: string, to: string) => {
      const { content } = await readFile(from);
      await apiFetch(`/api/projects/${projectId}/files/content`, {
        method: 'PUT',
        json: { path: to, content },
      });
      await apiFetch(
        `/api/projects/${projectId}/files/content?path=${encodeURIComponent(from)}`,
        { method: 'DELETE' },
      );
      setOpenFiles((prev) =>
        prev.map((file) => (file.path === from ? { ...file, path: to } : file)),
      );
      setActiveFilePathState((current) => (current === from ? to : current));
      notify('success', `Renamed to ${to}`);
      refreshFiles();
    },
    [notify, projectId, readFile, refreshFiles],
  );

  /* ---------------- Editor tabs ---------------- */

  const openFile = React.useCallback(
    (path: string) => {
      setTab('code');
      setActiveFilePathState(path);
      setOpenFiles((prev) => {
        if (prev.some((file) => file.path === path)) return prev;
        return [
          ...prev,
          {
            path,
            content: '',
            savedContent: '',
            language: 'plaintext',
            loading: true,
            error: null,
          },
        ];
      });

      void readFile(path)
        .then(({ content, language }) => {
          setOpenFiles((prev) =>
            prev.map((file) =>
              file.path === path
                ? {
                    ...file,
                    content,
                    savedContent: content,
                    language,
                    loading: false,
                    error: null,
                  }
                : file,
            ),
          );
        })
        .catch((error: unknown) => {
          const described = describeError(error);
          setOpenFiles((prev) =>
            prev.map((file) =>
              file.path === path ? { ...file, loading: false, error: described.message } : file,
            ),
          );
        });
    },
    [readFile],
  );

  const closeFile = React.useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((file) => file.path !== path);
      setActiveFilePathState((current) =>
        current === path ? (next[next.length - 1]?.path ?? null) : current,
      );
      return next;
    });
  }, []);

  const updateFileDraft = React.useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((file) => (file.path === path ? { ...file, content } : file)),
    );
  }, []);

  /* ---------------- Pending changes ---------------- */

  const refreshChanges = React.useCallback(() => {
    setChangesLoading(true);
    setChangesError(null);
    void apiFetch<{ changes: Array<Partial<WorkspacePendingChange>> }>(
      `/api/projects/${projectId}/changes`,
    )
      .then((payload) => {
        setPendingChanges(
          (payload.changes ?? []).map((change) => ({
            path: change.path ?? '',
            kind: change.kind ?? 'modified',
            additions: change.additions ?? 0,
            deletions: change.deletions ?? 0,
            diff: change.diff ?? '',
          })),
        );
      })
      .catch((error: unknown) => setChangesError(describeError(error).message))
      .finally(() => setChangesLoading(false));
  }, [projectId]);

  const applyChanges = React.useCallback(
    async (paths: string[]) => {
      await apiFetch(`/api/projects/${projectId}/changes/apply`, { json: { paths } });
      setPendingChanges((prev) => prev.filter((change) => !paths.includes(change.path)));
      notify('success', `Applied ${paths.length} file${paths.length === 1 ? '' : 's'}.`);
      refreshFiles();
    },
    [notify, projectId, refreshFiles],
  );

  const rejectChanges = React.useCallback(
    async (paths: string[]) => {
      await apiFetch(`/api/projects/${projectId}/changes/reject`, { json: { paths } });
      setPendingChanges((prev) => prev.filter((change) => !paths.includes(change.path)));
      notify('info', `Discarded ${paths.length} file${paths.length === 1 ? '' : 's'}.`);
      refreshFiles();
    },
    [notify, projectId, refreshFiles],
  );

  /* ---------------- Sandbox ---------------- */

  const sandboxAction = React.useCallback(
    (action: 'start' | 'stop' | 'restart') => {
      const current = sandbox;
      if (!current) {
        notify('warning', 'This project has no sandbox yet.', 'Create one to run commands.');
        return;
      }
      if (!data.capabilities.canManageSandbox) {
        notify('warning', 'Your role cannot control sandboxes.');
        return;
      }
      setSandboxBusy(true);
      setSandbox({ ...current, status: action === 'stop' ? 'stopping' : 'starting' });
      void apiFetch<{ sandbox?: Partial<WorkspaceSandbox> }>(
        `/api/sandboxes/${current.id}/${action}`,
        { json: {} },
      )
        .then((payload) => {
          setSandbox((prev) =>
            prev
              ? {
                  ...prev,
                  ...payload.sandbox,
                  status:
                    (payload.sandbox?.status as WorkspaceSandbox['status'] | undefined) ??
                    (action === 'stop' ? 'stopped' : 'running'),
                }
              : prev,
          );
          notify(
            'success',
            action === 'stop'
              ? 'Sandbox stopped.'
              : action === 'restart'
                ? 'Sandbox restarted.'
                : 'Sandbox running.',
          );
        })
        .catch((error: unknown) => {
          setSandbox((prev) => (prev ? { ...prev, status: 'failed' } : prev));
          reportError(error, 'Sandbox action failed');
        })
        .finally(() => setSandboxBusy(false));
    },
    [data.capabilities.canManageSandbox, notify, reportError, sandbox],
  );

  const startSandbox = React.useCallback(() => sandboxAction('start'), [sandboxAction]);

  /**
   * Creates the project's sandbox. Defaults to the Nano preset — a size every
   * plan allows — because the point of this button is to get the agent running
   * in one click; resizing lives with the machine itself.
   */
  const createSandbox = React.useCallback(async () => {
    if (!data.capabilities.canCreateSandbox) return;
    setSandboxBusy(true);
    try {
      const payload = await apiFetch<{ sandbox: Partial<WorkspaceSandbox> & { id: string } }>(
        '/api/sandboxes',
        { json: { projectId, cpuCores: 0.25, memoryMb: 512, diskGb: 5 } },
      );
      const createdSandbox = payload.sandbox;
      setSandbox({
        id: createdSandbox.id,
        name: createdSandbox.name ?? 'Sandbox',
        provider: createdSandbox.provider ?? 'mock',
        status: (createdSandbox.status as WorkspaceSandbox['status']) ?? 'creating',
        statusMessage: createdSandbox.statusMessage ?? null,
        cpuCores: createdSandbox.cpuCores ?? 0.25,
        memoryMb: createdSandbox.memoryMb ?? 512,
        diskGb: createdSandbox.diskGb ?? 5,
        cpuPercent: 0,
        memoryUsedMb: 0,
        diskUsedMb: 0,
        processCount: 0,
        autoSleepMinutes: createdSandbox.autoSleepMinutes ?? 15,
        previewUrl: null,
        startedAt: createdSandbox.startedAt ?? null,
        lastActiveAt: createdSandbox.lastActiveAt ?? null,
      });
      notify('success', 'Sandbox created — it is starting up.');
    } catch (error) {
      reportError(error, 'Could not create the sandbox');
    } finally {
      setSandboxBusy(false);
    }
  }, [data.capabilities.canCreateSandbox, notify, projectId, reportError]);
  const stopSandbox = React.useCallback(() => sandboxAction('stop'), [sandboxAction]);
  const restartSandbox = React.useCallback(() => sandboxAction('restart'), [sandboxAction]);

  /* ---------------- Terminal bridge ---------------- */

  const runInTerminal = React.useCallback(
    (command: string) => {
      if (!data.capabilities.canUseTerminal) {
        notify('warning', 'Your role cannot open terminals.');
        return;
      }
      setTab('terminal');
      setTerminalRequest({ command, nonce: Date.now() });
    },
    [data.capabilities.canUseTerminal, notify],
  );

  /* ---------------- Slash commands ---------------- */

  const setModelId = React.useCallback(
    (id: string) => {
      setModelIdState(id);
      if (activeConversationId) {
        void apiFetch(`/api/conversations/${activeConversationId}`, {
          method: 'PATCH',
          json: { modelId: id },
        }).catch(() => {
          /* The next message carries `modelId` anyway; no need to alarm anyone. */
        });
      }
    },
    [activeConversationId],
  );

  const setMode = React.useCallback(
    (next: AgentMode) => {
      setModeState(next);
      if (activeConversationId) {
        void apiFetch(`/api/conversations/${activeConversationId}`, {
          method: 'PATCH',
          json: { agentMode: next },
        }).catch(() => {
          /* Mode travels with every message; a failed persist is cosmetic. */
        });
      }
    },
    [activeConversationId],
  );

  const focusFileSearch = React.useCallback(() => {
    setLeftCollapsed(false);
    setFileSearchNonce((value) => value + 1);
  }, []);

  const slashCommands = React.useMemo(
    () => buildSlashCommands(data.customCommands, data.skills),
    [data.customCommands, data.skills],
  );

  const runSlashCommand = React.useCallback(
    (command: SlashCommand, args: string) => {
      const ctx: SlashCommandContext = {
        args: args.trim(),
        project: data.project,
        mode,
        models: data.models,
        activeModelId: modelId,
        sandbox,
        skills: data.skills,
        permissions: data.project.permissions,
        isStreaming,
        setMode,
        setModel: setModelId,
        setTab,
        openDialog: setDialog,
        newConversation: createConversation,
        clearConversation,
        compactConversation,
        stopRun,
        retryLast,
        sendPrompt: (text) => sendMessage(text),
        runInTerminal,
        startSandbox,
        restartSandbox,
        focusFileSearch,
        navigate: (href) => router.push(href),
        notify,
      };
      command.run(ctx);
    },
    [
      clearConversation,
      compactConversation,
      createConversation,
      data.models,
      data.project,
      data.skills,
      focusFileSearch,
      isStreaming,
      mode,
      modelId,
      notify,
      restartSandbox,
      retryLast,
      router,
      runInTerminal,
      sandbox,
      sendMessage,
      setMode,
      setModelId,
      startSandbox,
      stopRun,
    ],
  );

  /* ---------------- Sandbox metrics polling ---------------- */

  React.useEffect(() => {
    const current = sandbox;
    if (!current || current.status !== 'running') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (document.hidden) return;
      try {
        const metrics = await apiFetch<{
          cpuPercent?: number;
          memoryUsedMb?: number;
          memoryLimitMb?: number;
          diskUsedMb?: number;
          processCount?: number;
        }>(`/api/sandboxes/${current.id}/metrics`);
        if (cancelled) return;
        setSandbox((prev) =>
          prev && prev.id === current.id
            ? {
                ...prev,
                cpuPercent: metrics.cpuPercent ?? prev.cpuPercent,
                memoryUsedMb: metrics.memoryUsedMb ?? prev.memoryUsedMb,
                diskUsedMb: metrics.diskUsedMb ?? prev.diskUsedMb,
                processCount: metrics.processCount ?? prev.processCount,
              }
            : prev,
        );
      } catch {
        // Metrics are decorative — a blip must never break the workspace.
      }
    };

    const schedule = () => {
      timer = setTimeout(async () => {
        await poll();
        if (!cancelled) schedule();
      }, 5000);
    };

    void poll();
    schedule();

    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sandbox?.id, sandbox?.status, sandbox]);

  /* ---------------- Global shortcuts ---------------- */

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key === '`') {
        event.preventDefault();
        setTab('terminal');
      } else if (meta && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createConversation();
      } else if (meta && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        focusFileSearch();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createConversation, focusFileSearch]);

  /* ---------------- Warn before losing a run ---------------- */

  React.useEffect(() => {
    if (!isStreaming) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isStreaming]);

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      data,
      initialPrompt,
      tab,
      setTab,
      leftCollapsed,
      setLeftCollapsed,
      rightCollapsed,
      setRightCollapsed,
      conversations,
      activeConversationId,
      messages,
      messagesLoading,
      messagesError,
      selectConversation,
      createConversation,
      renameConversation,
      deleteConversation,
      clearConversation,
      compactConversation,
      reloadMessages,
      modelId,
      setModelId,
      mode,
      setMode,
      phase,
      isStreaming,
      sendMessage,
      stopRun,
      retryLast,
      regenerate,
      editAndResend,
      decideApproval,
      pendingCostConfirmation,
      confirmPendingCost,
      cancelPendingCost,
      files,
      filesLoading,
      filesError,
      refreshFiles,
      createFile,
      createFolder,
      renameFile,
      deleteFile,
      readFile,
      saveFile,
      openFiles,
      activeFilePath,
      openFile,
      closeFile,
      setActiveFilePath: setActiveFilePathState,
      updateFileDraft,
      pendingChanges,
      changesLoading,
      changesError,
      refreshChanges,
      applyChanges,
      rejectChanges,
      sandbox,
      sandboxBusy,
      createSandbox,
      startSandbox,
      stopSandbox,
      restartSandbox,
      terminalRequest,
      runInTerminal,
      runs,
      activeRunId,
      activity,
      notify,
      dialog,
      openDialog: setDialog,
      closeDialog: () => setDialog(null),
      fileSearchNonce,
      focusFileSearch,
      slashCommands,
      runSlashCommand,
      sessionUsage,
    }),
    [
      activeConversationId,
      activeFilePath,
      activeRunId,
      activity,
      applyChanges,
      cancelPendingCost,
      changesError,
      changesLoading,
      clearConversation,
      closeFile,
      compactConversation,
      confirmPendingCost,
      conversations,
      createConversation,
      createFile,
      createFolder,
      data,
      decideApproval,
      deleteConversation,
      deleteFile,
      dialog,
      editAndResend,
      fileSearchNonce,
      files,
      filesError,
      filesLoading,
      initialPrompt,
      focusFileSearch,
      isStreaming,
      leftCollapsed,
      messages,
      messagesError,
      messagesLoading,
      mode,
      modelId,
      notify,
      openFile,
      openFiles,
      pendingChanges,
      pendingCostConfirmation,
      phase,
      refreshChanges,
      refreshFiles,
      regenerate,
      reloadMessages,
      renameConversation,
      renameFile,
      rejectChanges,
      restartSandbox,
      retryLast,
      rightCollapsed,
      runInTerminal,
      runSlashCommand,
      runs,
      sandbox,
      sandboxBusy,
      saveFile,
      selectConversation,
      sendMessage,
      sessionUsage,
      setMode,
      setModelId,
      createSandbox,
      slashCommands,
      startSandbox,
      stopRun,
      stopSandbox,
      tab,
      terminalRequest,
      updateFileDraft,
      readFile,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
