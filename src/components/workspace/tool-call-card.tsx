'use client';

import { Check, ChevronRight, CircleSlash, type LucideIcon, TriangleAlert } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { CopyButton } from '@/components/ui/copy-button';
import { Spinner } from '@/components/ui/spinner';
import { cn, formatDuration } from '@/lib/utils';

import { DiffView } from './diff-view';
import { toolIconFor } from './icons';
import type { WorkspaceToolCall } from './types';

/**
 * One tool invocation, rendered compactly.
 *
 * The output pane collapses as soon as the call finishes: during a long run the
 * useful signal is the list of what the agent did, not 400 lines of npm output.
 */

const TERMINAL_TOOLS = new Set(['run_command']);

/**
 * Renders whichever icon the tool resolved to. The component type arrives as a
 * prop rather than being picked up inside the card, so the card's own render
 * never has a component-shaped local of its own.
 */
function ToolIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon aria-hidden="true" className={className} />;
}

function statusIcon(call: WorkspaceToolCall) {
  if (call.status === 'running' || call.status === 'pending') {
    return <Spinner size="xs" label={null} className="text-primary" />;
  }
  if (call.status === 'rejected') return <CircleSlash className="size-3.5 text-muted" />;
  if (call.isError || call.status === 'failed') {
    return <TriangleAlert className="size-3.5 text-danger" />;
  }
  if (call.status === 'awaiting_approval') {
    return <TriangleAlert className="size-3.5 text-warning" />;
  }
  return <Check className="size-3.5 text-primary" />;
}

function useLiveDuration(call: WorkspaceToolCall): number {
  const [now, setNow] = React.useState(() => Date.now());
  const live = call.status === 'running' && typeof call.startedAtMs === 'number';

  React.useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [live]);

  if (live && call.startedAtMs) return now - call.startedAtMs;
  return call.durationMs;
}

function commandOf(call: WorkspaceToolCall): string | null {
  const value = call.args['command'] ?? call.args['cmd'];
  return typeof value === 'string' ? value : null;
}

function pathOf(call: WorkspaceToolCall): string | null {
  const value = call.args['path'] ?? call.args['file'];
  return typeof value === 'string' ? value : null;
}

export function ToolCallCard({
  call,
  onApprove,
  onReject,
  canApprove,
}: {
  call: WorkspaceToolCall;
  onApprove: (toolCallId: string) => void;
  onReject: (toolCallId: string) => void;
  canApprove: boolean;
}) {
  const finished =
    call.status === 'succeeded' || call.status === 'failed' || call.status === 'rejected';
  const [open, setOpen] = React.useState(!finished);
  const wasFinished = React.useRef(finished);

  // Collapse exactly once, at the moment the call finishes, so a user who
  // opened it back up is not fighting the component.
  React.useEffect(() => {
    if (finished && !wasFinished.current) setOpen(false);
    wasFinished.current = finished;
  }, [finished]);

  const duration = useLiveDuration(call);
  const command = commandOf(call);
  const path = pathOf(call);
  const isDiff = call.output.includes('@@ -') || call.output.includes('\n+++ ');
  const isTerminal = TERMINAL_TOOLS.has(call.toolName);
  const awaiting = call.status === 'awaiting_approval';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-surface',
        awaiting ? 'border-warning/45' : 'border-line',
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <CollapsibleTrigger
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                'size-3.5 shrink-0 text-subtle transition-transform duration-150',
                open && 'rotate-90',
              )}
            />
            <ToolIcon
              icon={toolIconFor(call.toolName, call.source)}
              className="size-3.5 shrink-0 text-muted"
            />
            <span className="truncate text-[12.5px] font-medium text-fg">{call.title}</span>
            {call.source !== 'builtin' ? (
              <Badge variant="outline" size="sm" className="shrink-0">
                {call.sourceRef ?? call.source}
              </Badge>
            ) : null}
          </CollapsibleTrigger>

          <div className="flex shrink-0 items-center gap-2">
            {call.exitCode !== undefined && call.exitCode !== 0 ? (
              <span className="karo-numeric text-[11px] text-danger">exit {call.exitCode}</span>
            ) : null}
            {duration > 0 ? (
              <span className="karo-numeric text-[11px] text-subtle">
                {formatDuration(duration)}
              </span>
            ) : null}
            {statusIcon(call)}
          </div>
        </div>

        {awaiting ? (
          <div className="border-t border-warning/35 bg-warning-soft/50 px-2.5 py-2.5">
            <p className="text-[12.5px] font-medium text-warning-soft-fg">
              {call.approvalKind === 'file'
                ? 'This edit needs your approval'
                : 'This command needs your approval'}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">
              {call.approvalReason ??
                'Karo pauses before anything destructive so you stay in control.'}
            </p>

            {call.approvalPreview ? (
              call.approvalKind === 'file' ? (
                <DiffView
                  patch={call.approvalPreview}
                  path={path ?? undefined}
                  className="mt-2"
                  maxHeight={220}
                />
              ) : (
                <pre className="karo-terminal mt-2 max-h-40 overflow-auto rounded-md bg-term-bg px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-term-fg">
                  {call.approvalPreview}
                </pre>
              )
            ) : command ? (
              <pre className="mt-2 overflow-x-auto rounded-md bg-term-bg px-3 py-2 font-mono text-[11.5px] text-term-fg">
                {command}
              </pre>
            ) : null}

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={!canApprove}
                onClick={() => onApprove(call.id)}
              >
                Approve and continue
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!canApprove}
                onClick={() => onReject(call.id)}
              >
                Reject
              </Button>
              {!canApprove ? (
                <span className="text-[11.5px] text-muted">
                  Your role cannot approve agent actions.
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <CollapsibleContent>
          <div className="border-t border-line">
            {command ? (
              <div className="flex items-start gap-2 border-b border-line bg-surface-2 px-2.5 py-1.5">
                <span className="mt-px shrink-0 font-mono text-[11px] text-subtle">$</span>
                <code className="min-w-0 flex-1 font-mono text-[11.5px] break-all text-fg">
                  {command}
                </code>
                <CopyButton value={command} size="icon-sm" />
              </div>
            ) : path ? (
              <div className="border-b border-line bg-surface-2 px-2.5 py-1.5">
                <code className="font-mono text-[11.5px] break-all text-muted">{path}</code>
              </div>
            ) : null}

            {call.output ? (
              isDiff ? (
                <DiffView
                  patch={call.output}
                  path={path ?? undefined}
                  className="rounded-none border-0"
                  maxHeight={280}
                />
              ) : (
                <pre
                  className={cn(
                    'max-h-72 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap',
                    isTerminal
                      ? 'karo-terminal bg-term-bg text-term-fg'
                      : 'bg-bg-inset text-fg',
                  )}
                >
                  {call.output}
                </pre>
              )
            ) : (
              <p className="px-3 py-2 text-[12px] text-muted">
                {call.status === 'running'
                  ? 'Waiting for output…'
                  : (call.resultSummary ?? 'No output.')}
              </p>
            )}

            {call.resultSummary && call.output ? (
              <p
                className={cn(
                  'border-t border-line px-3 py-1.5 text-[11.5px]',
                  call.isError ? 'text-danger' : 'text-muted',
                )}
              >
                {call.resultSummary}
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
