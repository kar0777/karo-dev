'use client';

import {
  Brain,
  ChevronRight,
  Copy,
  FileDiff,
  Info,
  Pencil,
  Paperclip,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_ERROR_COPY } from '@/lib/types/agent';
import {
  formatBytes,
  formatCompactNumber,
  formatDuration,
  formatMicroUsd,
  formatRelativeTime,
} from '@/lib/utils';

import { DiffStat, DiffView } from './diff-view';
import { ToolCallCard } from './tool-call-card';
import type { WorkspaceMessage } from './types';

/**
 * A single turn in the conversation.
 *
 * User turns are editable (which truncates the thread from that point and
 * re-runs), assistant turns carry their tool calls, proposed diffs and the
 * exact accounting for the response.
 */

const CHANGE_TONE: Record<string, 'success' | 'info' | 'danger' | 'warning'> = {
  created: 'success',
  modified: 'info',
  deleted: 'danger',
  renamed: 'warning',
};

function UsageFooter({ message }: { message: WorkspaceMessage }) {
  const usage = message.usage;
  if (!usage) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
      {message.modelDisplayName ? (
        <span className="font-medium text-muted">{message.modelDisplayName}</span>
      ) : null}
      <span className="karo-numeric">
        {formatCompactNumber(usage.inputTokens)} in · {formatCompactNumber(usage.outputTokens)}{' '}
        out
      </span>
      <span className="karo-numeric">{formatCompactNumber(usage.weightedTokens)} weighted</span>
      <span className="karo-numeric text-ember-soft-fg">
        {formatMicroUsd(usage.chargedMicroUsd, { precise: true })}
      </span>
      {usage.latencyMs > 0 ? (
        <span className="karo-numeric">{formatDuration(usage.latencyMs)}</span>
      ) : null}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-5"
            aria-label="How this cost was calculated"
          >
            <Info className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <p className="text-[12px] font-medium text-fg">How this was billed</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{usage.explanation}</p>
          <dl className="mt-2.5 space-y-1 border-t border-line pt-2.5 text-[11.5px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Settlement</dt>
              <dd className="font-medium text-fg capitalize">{usage.settlement}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Cached input</dt>
              <dd className="karo-numeric text-fg">
                {formatCompactNumber(usage.cachedInputTokens)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Upstream cost</dt>
              <dd className="karo-numeric text-fg">
                {formatMicroUsd(usage.upstreamCostMicroUsd, { precise: true })}
              </dd>
            </div>
            {usage.timeToFirstTokenMs ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">First token</dt>
                <dd className="karo-numeric text-fg">
                  {formatDuration(usage.timeToFirstTokenMs)}
                </dd>
              </div>
            ) : null}
          </dl>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FileChanges({
  message,
  onApprove,
  onReject,
  canApprove,
}: {
  message: WorkspaceMessage;
  onApprove: (paths: string[]) => void;
  onReject: (paths: string[]) => void;
  canApprove: boolean;
}) {
  if (message.fileChanges.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {message.fileChanges.map((change) => (
        <Collapsible
          key={change.path}
          className="overflow-hidden rounded-md border border-line bg-surface"
        >
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <FileDiff aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
              <code className="truncate font-mono text-[12px] text-fg">{change.path}</code>
              <Badge variant={CHANGE_TONE[change.kind] ?? 'neutral'} size="sm">
                {change.kind}
              </Badge>
            </CollapsibleTrigger>
            <DiffStat additions={change.additions} deletions={change.deletions} />
            {change.pending ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="xs"
                  variant="primary"
                  disabled={!canApprove}
                  onClick={() => onApprove([change.path])}
                >
                  Apply
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!canApprove}
                  onClick={() => onReject([change.path])}
                >
                  Discard
                </Button>
              </div>
            ) : (
              <Badge variant="success" size="sm">
                applied
              </Badge>
            )}
          </div>
          <CollapsibleContent>
            <DiffView
              patch={change.diff ?? ''}
              path={change.path}
              className="rounded-none border-0 border-t"
              maxHeight={300}
            />
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}

export function ChatMessage({
  message,
  isLast,
  canApprove,
  onCopy,
  onRetry,
  onRegenerate,
  onEditAndResend,
  onApproveTool,
  onRejectTool,
  onApproveFiles,
  onRejectFiles,
  markdown,
}: {
  message: WorkspaceMessage;
  isLast: boolean;
  canApprove: boolean;
  onCopy: (text: string) => void;
  onRetry: () => void;
  onRegenerate: (messageId: string) => void;
  onEditAndResend: (messageId: string, content: string) => void;
  onApproveTool: (toolCallId: string) => void;
  onRejectTool: (toolCallId: string) => void;
  onApproveFiles: (paths: string[]) => void;
  onRejectFiles: (paths: string[]) => void;
  markdown: (content: string) => React.ReactNode;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(message.content);

  const streaming = message.status === 'streaming';
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <article className="flex flex-col items-end gap-1" aria-label="Your message">
        {editing ? (
          <div className="w-full max-w-[min(46rem,100%)] rounded-lg border border-line-accent bg-surface p-2.5">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
              aria-label="Edit your message"
              className="resize-none"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(message.content);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!draft.trim() || draft === message.content}
                onClick={() => {
                  setEditing(false);
                  onEditAndResend(message.id, draft.trim());
                }}
              >
                Save and resend
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-subtle">
              Everything after this message will be removed and the agent will answer again.
            </p>
          </div>
        ) : (
          <div className="max-w-[min(46rem,100%)] rounded-lg rounded-br-sm border border-line bg-surface-2 px-3 py-2">
            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-fg">
              {message.content}
            </p>
            {message.attachments && message.attachments.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {message.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    {attachment.mimeType.startsWith('image/') && attachment.inlineContent ? (
                      <img
                        src={attachment.inlineContent}
                        alt={attachment.filename}
                        className="max-h-32 rounded-md border border-line"
                      />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-muted">
                        <Paperclip aria-hidden="true" className="size-3" />
                        {attachment.filename}
                        <span className="karo-numeric text-subtle">
                          {formatBytes(attachment.sizeBytes)}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {!editing ? (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/list:opacity-100 hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy message"
              onClick={() => onCopy(message.content)}
            >
              <Copy className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Edit and resend"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
            {isLast ? (
              <Button variant="ghost" size="icon-sm" aria-label="Retry" onClick={onRetry}>
                <RotateCcw className="size-3.5" />
              </Button>
            ) : null}
            <time
              className="ml-1 text-[11px] text-subtle"
              dateTime={message.createdAt}
              title={message.createdAt}
            >
              {formatRelativeTime(message.createdAt)}
            </time>
          </div>
        ) : null}
      </article>
    );
  }

  const errorCopy = message.error ? AGENT_ERROR_COPY[message.error.code] : null;

  return (
    <article className="flex flex-col gap-1" aria-label="Assistant message">
      <div className="min-w-0">
        {message.thinking ? (
          <Collapsible className="mb-2 overflow-hidden rounded-md border border-line bg-surface-2">
            <CollapsibleTrigger className="group/think flex w-full items-center gap-2 px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-subtle transition-transform duration-150 group-data-[state=open]/think:rotate-90"
              />
              <Brain aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
              <span className="text-[12px] font-medium text-muted">Reasoning</span>
              <span className="karo-numeric ml-auto text-[11px] text-subtle">
                {formatCompactNumber(message.thinking.length)} chars
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="max-h-72 overflow-auto border-t border-line px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted">
                {message.thinking}
              </p>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {message.toolCalls.length > 0 ? (
          <div className="mb-2 space-y-1.5">
            {message.toolCalls.map((call) => (
              <ToolCallCard
                key={call.id}
                call={call}
                canApprove={canApprove}
                onApprove={onApproveTool}
                onReject={onRejectTool}
              />
            ))}
          </div>
        ) : null}

        {message.content ? (
          <div className="min-w-0">
            {markdown(message.content)}
            {streaming ? (
              <span
                aria-hidden="true"
                className="animate-caret ml-0.5 inline-block h-3.5 w-1.5 translate-y-px bg-primary align-middle"
              />
            ) : null}
          </div>
        ) : streaming && message.toolCalls.length === 0 ? (
          <p className="text-[13px] text-muted">
            Thinking
            <span
              aria-hidden="true"
              className="animate-caret ml-0.5 inline-block h-3.5 w-1.5 translate-y-px bg-primary align-middle"
            />
          </p>
        ) : null}

        <FileChanges
          message={message}
          canApprove={canApprove}
          onApprove={onApproveFiles}
          onReject={onRejectFiles}
        />

        {message.error && errorCopy ? (
          <Alert variant="danger" className="mt-2">
            <AlertTitle>{errorCopy.title}</AlertTitle>
            <AlertDescription>
              <p>{message.error.message || errorCopy.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {message.error.retryable ? (
                  <Button size="xs" variant="secondary" onClick={onRetry}>
                    Try again
                  </Button>
                ) : null}
                {errorCopy.actionHref ? (
                  <Button size="xs" variant="ghost" asChild>
                    <a href={errorCopy.actionHref}>{errorCopy.actionLabel ?? 'Open'}</a>
                  </Button>
                ) : null}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        {message.status === 'stopped' ? (
          <p className="mt-2 text-[12px] text-muted">
            You stopped this response. Nothing further was charged.
          </p>
        ) : null}

        <UsageFooter message={message} />
      </div>

      {!streaming ? (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/list:opacity-100 hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy response"
            onClick={() => onCopy(message.content)}
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Regenerate response"
            onClick={() => onRegenerate(message.id)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <time
            className="ml-1 text-[11px] text-subtle"
            dateTime={message.createdAt}
            title={message.createdAt}
          >
            {formatRelativeTime(message.createdAt)}
          </time>
        </div>
      ) : null}
    </article>
  );
}
