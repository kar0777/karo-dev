'use client';

import { ArrowDown, History, MessageSquarePlus, Sparkles } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Meter } from '@/components/ui/meter';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { AGENT_MODE_META } from '@/lib/agent/policy';
import { cn, formatCompactNumber } from '@/lib/utils';

import { ChatMessage } from './chat-message';
import { Composer } from './composer';
import { CostConfirmDialog } from './cost-confirm-dialog';
import { ConversationList } from './conversation-list';
import { Markdown } from './markdown';
import { SandboxBanner } from './sandbox-banner';
import { useWorkspace } from './workspace-context';
import { WorkspaceDialogs } from './workspace-dialogs';

/**
 * The chat surface.
 *
 * Auto-scroll only follows the stream while the user is already at the bottom;
 * the moment they scroll up to read something, the view stops moving and a
 * "jump to latest" affordance appears instead.
 */

const SUGGESTIONS = [
  'Explain the structure of this project and where the entry points are.',
  'Add a health check endpoint and a test that proves it responds.',
  'Find the slowest query in this codebase and propose a fix.',
  'Set up a dev server and show me the preview.',
];

function MessageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1].map((row) => (
        <div key={row} className="space-y-2">
          <Skeleton className="ml-auto h-8 w-2/5 rounded-lg" />
          <Skeleton className="h-3 w-full rounded-sm" />
          <Skeleton className="h-3 w-11/12 rounded-sm" />
          <Skeleton className="h-3 w-3/5 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

export function ChatPanel() {
  const {
    data,
    messages,
    messagesLoading,
    messagesError,
    reloadMessages,
    conversations,
    activeConversationId,
    createConversation,
    sendMessage,
    retryLast,
    regenerate,
    editAndResend,
    decideApproval,
    applyChanges,
    rejectChanges,
    mode,
    sessionUsage,
    notify,
    isStreaming,
  } = useWorkspace();

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = React.useState(true);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;

  const onScroll = React.useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPinned(distance < 96);
  }, []);

  React.useEffect(() => {
    if (!pinned) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, pinned]);

  const copy = React.useCallback(
    (text: string) => {
      void navigator.clipboard
        ?.writeText(text)
        .then(() => toast.success('Copied to clipboard'))
        .catch(() => notify('warning', 'Could not copy', 'Select the text and press Ctrl+C.'));
    },
    [notify],
  );

  const renderMarkdown = React.useCallback(
    (content: string) => <Markdown content={content} />,
    [],
  );

  const quota = data.quota;
  const quotaRatio =
    quota.includedWeightedTokens > 0
      ? quota.weightedTokensUsed / quota.includedWeightedTokens
      : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-fg">
            {activeConversation?.title ?? 'New chat'}
          </h2>
          <p className="truncate text-[11.5px] text-subtle">
            {AGENT_MODE_META[mode].label} · {AGENT_MODE_META[mode].short}
            {sessionUsage.messages > 0
              ? ` · ${formatCompactNumber(sessionUsage.weightedTokens)} weighted this session`
              : ''}
          </p>
        </div>

        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" iconLeft={<History />}>
              History
              <Badge variant="neutral" size="sm" className="ml-1">
                {conversations.length}
              </Badge>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[min(22rem,calc(100vw-2rem))] p-0">
            <SheetHeader className="mx-0 mt-0 px-3">
              <SheetTitle>Conversations</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1">
              <ConversationList onPick={() => setHistoryOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <Button
          variant="secondary"
          size="sm"
          iconLeft={<MessageSquarePlus />}
          onClick={createConversation}
        >
          New
        </Button>
      </header>

      {quota.includedWeightedTokens > 0 && quotaRatio > 0.8 ? (
        <div className="border-b border-line bg-surface-2 px-3 py-2">
          <Meter
            value={quota.weightedTokensUsed}
            max={quota.includedWeightedTokens}
            label={`${quota.planName} allowance`}
            caption={`${formatCompactNumber(quota.weightedTokensUsed)} / ${formatCompactNumber(quota.includedWeightedTokens)} weighted`}
            showPercent
          />
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="group/list relative min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      >
        <SandboxBanner className="mb-4" />

        {messagesError ? (
          <ErrorState
            title="Could not load this conversation"
            description={messagesError}
            retry={reloadMessages}
          />
        ) : messagesLoading && messages.length === 0 ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Give the agent a task"
            description="It has a real machine: it can read and write files, run commands, install packages and start servers — inside a sandbox you control."
          >
            <ul className="grid w-full max-w-lg gap-1.5 text-left">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => sendMessage(suggestion)}
                    disabled={!data.capabilities.canRunAgent}
                    className={cn(
                      'w-full rounded-md border border-line bg-surface px-3 py-2 text-left text-[12.5px] text-muted',
                      'transition-colors duration-150 hover:border-line-strong hover:bg-surface-2 hover:text-fg',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      'disabled:pointer-events-none disabled:opacity-55',
                    )}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </EmptyState>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            {messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                isLast={index === messages.length - 1}
                canApprove={data.capabilities.canApprove}
                markdown={renderMarkdown}
                onCopy={copy}
                onRetry={retryLast}
                onRegenerate={regenerate}
                onEditAndResend={editAndResend}
                onApproveTool={(id) => decideApproval(id, 'approve')}
                onRejectTool={(id) => decideApproval(id, 'reject')}
                onApproveFiles={(paths) => {
                  void applyChanges(paths).catch(() =>
                    notify('error', 'Could not apply the change'),
                  );
                }}
                onRejectFiles={(paths) => {
                  void rejectChanges(paths).catch(() =>
                    notify('error', 'Could not discard the change'),
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>

      {!pinned && messages.length > 0 ? (
        <div className="pointer-events-none relative">
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<ArrowDown />}
            className="pointer-events-auto absolute -top-12 left-1/2 -translate-x-1/2 shadow-md"
            onClick={() => {
              setPinned(true);
              const node = scrollRef.current;
              if (node) node.scrollTop = node.scrollHeight;
            }}
          >
            {isStreaming ? 'Follow the response' : 'Jump to latest'}
          </Button>
        </div>
      ) : null}

      <Composer />
      <CostConfirmDialog />
      <WorkspaceDialogs />
    </div>
  );
}
