'use client';

import {
  Check,
  CircleDashed,
  CircleX,
  FileCode,
  FileDiff,
  GitBranch,
  ListChecks,
  MessageSquare,
  Monitor,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  RefreshCw,
  SkipForward,
  SquareTerminal,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChatPanel } from '@/components/workspace/chat-panel';
import { CodePanel } from '@/components/workspace/code-panel';
import { DiffStat, DiffView } from '@/components/workspace/diff-view';
import { LeftRail } from '@/components/workspace/left-rail';
import { PreviewPanel } from '@/components/workspace/preview-panel';
import { RightRail } from '@/components/workspace/right-rail';
import { TerminalPanel } from '@/components/workspace/terminal-panel';
import type {
  PlanStepStatus,
  WorkspacePendingChange,
  WorkspaceRun,
  WorkspaceTabKey,
} from '@/components/workspace/types';
import { useTranslator } from '@/components/i18n-provider';
import type { LooseTranslationKey } from '@/lib/i18n';
import { useWorkspace } from '@/components/workspace/workspace-context';
import { AGENT_MODE_META } from '@/lib/agent/policy';
import type { RunStatus } from '@/lib/db/schema';
import { cn, formatCompactNumber, formatMicroUsd, isAppleDevice, pluralize } from '@/lib/utils';

/**
 * The workspace layout: three columns, six tabs, one viewport.
 *
 * Everything interactive already lives in `WorkspaceProvider`; this file only
 * decides what is on screen. Two structural rules drive the markup:
 *
 *  · **The page never scrolls.** The shell is exactly one viewport tall (minus
 *    the app chrome above it) and every pane scrolls inside itself. The panes
 *    are written against `h-full min-h-0`, and Monaco and xterm both measure
 *    their container, so a page-level scroll would break their sizing.
 *  · **A visited tab stays mounted.** Switching to Code and back must not
 *    reboot Monaco, reload the preview iframe or throw away a terminal's
 *    scrollback — `TerminalPanel` is explicitly written to expect that. Panes
 *    are therefore mounted on first visit and hidden afterwards, never
 *    unmounted. Unvisited panes are not mounted at all, so a user who never
 *    opens the terminal never pays for xterm.
 */

/** Height of the authenticated shell's top bar, which sits above this route. */
const SHELL_HEADER = '3rem';

/**
 * The platform check is a read of `navigator`, which a component body may not do
 * — reading it through an external store with a matching server snapshot keeps
 * render pure and avoids a hydration mismatch on the shortcut hints.
 */
const NO_STORE_SUBSCRIBE = () => () => {};

const TAB_ORDER: readonly WorkspaceTabKey[] = [
  'chat',
  'code',
  'preview',
  'terminal',
  'tasks',
  'changes',
];

const TAB_LABEL_KEY: Record<WorkspaceTabKey, LooseTranslationKey> = {
  chat: 'workspace.tabs.chat',
  code: 'workspace.tabs.code',
  preview: 'workspace.tabs.preview',
  terminal: 'workspace.tabs.terminal',
  tasks: 'workspace.tabs.tasks',
  changes: 'workspace.tabs.changes',
};

/**
 * Pre-built elements rather than component references: the React Compiler rules
 * forbid pulling a component out of a lookup table and rendering it as `<Icon/>`.
 */
const TAB_ICON: Record<WorkspaceTabKey, React.ReactNode> = {
  chat: <MessageSquare aria-hidden="true" className="size-3.5" />,
  code: <FileCode aria-hidden="true" className="size-3.5" />,
  preview: <Monitor aria-hidden="true" className="size-3.5" />,
  terminal: <SquareTerminal aria-hidden="true" className="size-3.5" />,
  tasks: <ListChecks aria-hidden="true" className="size-3.5" />,
  changes: <FileDiff aria-hidden="true" className="size-3.5" />,
};

const STEP_ICON: Record<PlanStepStatus, React.ReactNode> = {
  pending: <CircleDashed aria-hidden="true" className="size-4 text-subtle" />,
  active: <Spinner size="sm" label={null} className="text-primary" />,
  done: <Check aria-hidden="true" className="size-4 text-primary" />,
  skipped: <SkipForward aria-hidden="true" className="size-4 text-subtle" />,
  failed: <CircleX aria-hidden="true" className="size-4 text-danger" />,
};

const RUN_TONE: Record<RunStatus, 'neutral' | 'primary' | 'warning' | 'success' | 'danger'> = {
  queued: 'neutral',
  running: 'primary',
  awaiting_approval: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const RUN_STATUS_KEY: Record<RunStatus, LooseTranslationKey> = {
  queued: 'workspace.runStatus.queued',
  running: 'workspace.runStatus.running',
  awaiting_approval: 'workspace.runStatus.awaitingApproval',
  succeeded: 'workspace.runStatus.succeeded',
  failed: 'workspace.runStatus.failed',
  cancelled: 'workspace.runStatus.cancelled',
};

const CHANGE_TONE: Record<
  WorkspacePendingChange['kind'],
  'success' | 'info' | 'danger' | 'warning'
> = {
  created: 'success',
  modified: 'info',
  deleted: 'danger',
  renamed: 'warning',
};

/* ------------------------------------------------------------------ *
 *  Tasks tab
 * ------------------------------------------------------------------ */

/**
 * The agent's plan for one run.
 *
 * `activeRunId` moves when a new run starts, and the selection follows it —
 * watching a run begin and then having to click it would be absurd. Manual
 * selection survives until the next run, which is what a user comparing two
 * runs expects.
 */
function TasksPanel() {
  const t = useTranslator();
  const { runs, activeRunId, setTab, isStreaming } = useWorkspace();

  const [selectedId, setSelectedId] = React.useState<string | null>(
    activeRunId ?? runs[0]?.id ?? null,
  );
  const [followedRunId, setFollowedRunId] = React.useState<string | null>(activeRunId);

  if (activeRunId !== followedRunId) {
    setFollowedRunId(activeRunId);
    if (activeRunId) setSelectedId(activeRunId);
  }

  const run: WorkspaceRun | null =
    runs.find((candidate) => candidate.id === selectedId) ?? runs[0] ?? null;

  if (!run) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={ListChecks}
          title={t('workspace.tasks.emptyTitle')}
          description={t('workspace.tasks.emptyDescription')}
          action={
            <Button size="sm" onClick={() => setTab('chat')}>
              {t('workspace.tasks.goToChat')}
            </Button>
          }
        />
      </div>
    );
  }

  const done = run.steps.filter((step) => step.status === 'done').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-[13px] font-semibold text-fg">
            {run.title}
            <Badge variant={RUN_TONE[run.status]} size="sm">
              {t(RUN_STATUS_KEY[run.status])}
            </Badge>
          </h2>
          <p className="karo-numeric truncate text-[11.5px] text-subtle">
            {AGENT_MODE_META[run.mode].label} ·{' '}
            {run.steps.length > 0
              ? `${t('workspace.tasks.stepsOf', { done, total: run.steps.length })} · `
              : ''}
            {formatCompactNumber(run.totalWeightedTokens)} {t('workspace.tasks.weighted')} ·{' '}
            {formatMicroUsd(run.totalChargedMicroUsd, { precise: true })}
          </p>
        </div>
        {isStreaming && run.id === activeRunId ? (
          <Spinner size="sm" label={t('workspace.tasks.runInProgress')} />
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto w-full max-w-3xl">
          {run.errorMessage ? (
            <p className="mb-4 rounded-md border border-line bg-danger-soft px-3 py-2 text-[12.5px] text-danger-soft-fg">
              {run.errorMessage}
            </p>
          ) : null}

          {run.steps.length === 0 ? (
            <EmptyState
              size="sm"
              icon={ListChecks}
              title={t('workspace.tasks.noPlanTitle')}
              description={t('workspace.tasks.noPlanDescription')}
            />
          ) : (
            <ol className="space-y-1">
              {run.steps.map((step, index) => (
                <li
                  key={step.id}
                  className="flex items-start gap-2.5 rounded-md border border-line bg-surface px-2.5 py-2"
                >
                  <span className="karo-numeric mt-0.5 w-4 shrink-0 text-right text-[11px] text-subtle">
                    {index + 1}
                  </span>
                  <span className="mt-0.5 shrink-0">{STEP_ICON[step.status]}</span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-[12.5px]',
                        step.status === 'done' ? 'text-subtle' : 'text-fg',
                        step.status === 'active' && 'font-medium',
                      )}
                    >
                      {step.title}
                    </p>
                    {step.detail ? (
                      <p className="mt-0.5 text-[11.5px] leading-snug text-muted">
                        {step.detail}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {runs.length > 1 ? (
            <section aria-label={t('workspace.tasks.allRuns')} className="mt-6">
              <h3 className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                All runs
              </h3>
              <ul className="mt-1.5 divide-y divide-line rounded-md border border-line">
                {runs.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      aria-current={candidate.id === run.id ? 'true' : undefined}
                      onClick={() => setSelectedId(candidate.id)}
                      className={cn(
                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        candidate.id === run.id ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                      )}
                    >
                      <Badge variant={RUN_TONE[candidate.status]} size="sm">
                        {t(RUN_STATUS_KEY[candidate.status])}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {candidate.title}
                      </span>
                      <span className="karo-numeric shrink-0 text-[11px] text-subtle">
                        {formatCompactNumber(candidate.totalWeightedTokens)} wt
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Changes tab
 * ------------------------------------------------------------------ */

/**
 * Review and decide on the agent's proposed edits.
 *
 * Diffs arrive pre-rendered from the server so the `diff` package stays out of
 * the browser bundle; this pane only has to lay them out and offer the two
 * decisions. Buttons disable per-path while a decision is in flight, because
 * double-applying a patch is exactly the sort of thing an impatient click does.
 */
function ChangesPanel() {
  const t = useTranslator();
  const {
    pendingChanges,
    changesLoading,
    changesError,
    refreshChanges,
    applyChanges,
    rejectChanges,
    openFile,
    data,
    notify,
  } = useWorkspace();

  const [busy, setBusy] = React.useState<readonly string[]>([]);
  const canApprove = data.capabilities.canApprove;

  const decide = React.useCallback(
    (paths: string[], decision: 'apply' | 'reject') => {
      setBusy((prev) => [...prev, ...paths]);
      const action = decision === 'apply' ? applyChanges : rejectChanges;
      void action(paths)
        .catch(() =>
          notify(
            'error',
            decision === 'apply'
              ? 'Could not apply the change'
              : 'Could not discard the change',
            'The workspace was left untouched. Reload the list and try again.',
          ),
        )
        .finally(() => setBusy((prev) => prev.filter((path) => !paths.includes(path))));
    },
    [applyChanges, notify, rejectChanges],
  );

  const additions = pendingChanges.reduce((total, change) => total + change.additions, 0);
  const deletions = pendingChanges.reduce((total, change) => total + change.deletions, 0);
  const allPaths = pendingChanges.map((change) => change.path);
  const batchBusy = allPaths.length > 0 && allPaths.every((path) => busy.includes(path));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-fg">
            {pendingChanges.length === 0
              ? 'No changes waiting'
              : `${pendingChanges.length} ${pluralize(pendingChanges.length, 'file')} to review`}
          </h2>
          <p className="karo-numeric truncate text-[11.5px] text-subtle">
            {pendingChanges.length > 0 ? (
              <>
                <span className="text-success">+{additions}</span>{' '}
                <span className="text-danger">−{deletions}</span> · nothing is written until you
                apply it
              </>
            ) : (
              'Edits the agent proposes land here first, so nothing changes without your say.'
            )}
          </p>
        </div>

        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('workspace.changes.reload')}
          onClick={refreshChanges}
        >
          {changesLoading ? (
            <Spinner size="xs" label={null} />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </Button>

        {pendingChanges.length > 0 ? (
          <>
            <Button
              size="xs"
              variant="secondary"
              loading={batchBusy}
              disabled={!canApprove}
              onClick={() => decide(allPaths, 'reject')}
            >
              {t('workspace.changes.reject')}
            </Button>
            <Button
              size="xs"
              variant="primary"
              loading={batchBusy}
              disabled={!canApprove}
              onClick={() => decide(allPaths, 'apply')}
            >
              {t('workspace.changes.applyAll')}
            </Button>
          </>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto w-full max-w-4xl">
          {changesError ? (
            <ErrorState
              title={t('workspace.changes.errorTitle')}
              description={changesError}
              retry={refreshChanges}
            />
          ) : pendingChanges.length === 0 ? (
            <EmptyState
              icon={FileDiff}
              title={t('workspace.changes.emptyTitle')}
              description={t('workspace.changes.emptyDescription')}
            />
          ) : (
            <ul className="space-y-3">
              {pendingChanges.map((change) => {
                const pathBusy = busy.includes(change.path);
                return (
                  <li
                    key={change.path}
                    className="overflow-hidden rounded-lg border border-line bg-surface"
                  >
                    <div className="flex flex-wrap items-center gap-2 border-b border-line px-2.5 py-1.5">
                      <Badge variant={CHANGE_TONE[change.kind]} size="sm">
                        {change.kind}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => openFile(change.path)}
                        className="min-w-0 flex-1 truncate rounded-sm text-left font-mono text-[12px] text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {change.path}
                      </button>
                      <DiffStat
                        additions={change.additions}
                        deletions={change.deletions}
                        className="shrink-0"
                      />
                      <Button
                        size="xs"
                        variant="ghost"
                        loading={pathBusy}
                        disabled={!canApprove}
                        onClick={() => decide([change.path], 'reject')}
                      >
                        {t('workspace.changes.reject')}
                      </Button>
                      <Button
                        size="xs"
                        variant="secondary"
                        loading={pathBusy}
                        disabled={!canApprove}
                        onClick={() => decide([change.path], 'apply')}
                      >
                        {t('workspace.changes.apply')}
                      </Button>
                    </div>
                    <DiffView
                      patch={change.diff}
                      path={change.path}
                      className="rounded-none border-0"
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {!canApprove && pendingChanges.length > 0 ? (
            <p className="mt-3 text-[12px] text-muted">
              Your role can read these diffs but not decide on them. Ask a team admin for the
              Developer role to apply or discard changes.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Tab strip
 * ------------------------------------------------------------------ */

function TabStrip({
  activeRunSteps,
  onFocusTab,
  tabRefs,
}: {
  activeRunSteps: number;
  onFocusTab: (index: number) => void;
  tabRefs: React.RefObject<Array<HTMLButtonElement | null>>;
}) {
  const t = useTranslator();
  const { tab, setTab, pendingChanges, isStreaming } = useWorkspace();

  const badgeFor = (key: WorkspaceTabKey): number | null => {
    if (key === 'changes') return pendingChanges.length || null;
    if (key === 'tasks') return activeRunSteps || null;
    return null;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = TAB_ORDER.indexOf(tab);
    let next = -1;
    if (event.key === 'ArrowRight') next = (current + 1) % TAB_ORDER.length;
    else if (event.key === 'ArrowLeft')
      next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TAB_ORDER.length - 1;
    if (next < 0) return;

    event.preventDefault();
    const key = TAB_ORDER[next];
    if (!key) return;
    setTab(key);
    onFocusTab(next);
  };

  return (
    <div
      role="tablist"
      aria-label="Workspace panes"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="karo-no-scrollbar flex min-w-0 items-center gap-0.5 overflow-x-auto"
    >
      {TAB_ORDER.map((key, index) => {
        const selected = key === tab;
        const badge = badgeFor(key);
        return (
          <button
            key={key}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`workspace-tab-${key}`}
            aria-selected={selected}
            aria-controls={`workspace-panel-${key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTab(key)}
            className={cn(
              'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium',
              'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {TAB_ICON[key]}
            <span>{t(TAB_LABEL_KEY[key])}</span>
            {badge !== null ? (
              <Badge variant={key === 'changes' ? 'ember' : 'neutral'} size="sm">
                {badge}
              </Badge>
            ) : null}
            {key === 'chat' && isStreaming ? <Spinner size="xs" label={null} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Shell
 * ------------------------------------------------------------------ */

export function WorkspaceShell() {
  const {
    data,
    tab,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    runs,
    activeRunId,
    pendingChanges,
    sandbox,
  } = useWorkspace();

  const [mobileRail, setMobileRail] = React.useState<'left' | 'right' | null>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  // Close the mobile rail once it has taken you somewhere. Every navigating
  // action in either rail moves the tab — tapping a file opens the editor,
  // tapping a plan step jumps to Tasks — and below `lg` the sheet covers the
  // whole viewport, so leaving it open hides the pane the tap just asked for.
  // Adjusted during render rather than from an effect so the sheet is already
  // gone in the commit that first shows the new pane; `AppShell` closes its
  // navigation drawer the same way.
  const [railTab, setRailTab] = React.useState(tab);
  if (tab !== railTab) {
    setRailTab(tab);
    if (mobileRail !== null) setMobileRail(null);
  }

  // `?prompt=` is not handled here. It arrives through the workspace context and
  // becomes the composer's initial draft, which keeps the carried-over prompt
  // editable in place and leaves sending it an explicit act by the user. Offering
  // it as a banner *as well* meant "Send it" dispatched the run while the same
  // text sat in the composer, ready to be sent a second time.

  // A pane is mounted from the first time it is shown and never unmounted, so
  // Monaco, the preview iframe and every terminal buffer survive a tab switch.
  const [mounted, setMounted] = React.useState<readonly WorkspaceTabKey[]>(() => [tab]);
  if (!mounted.includes(tab)) {
    setMounted((previous) => (previous.includes(tab) ? previous : [...previous, tab]));
  }

  const isApple = React.useSyncExternalStore(NO_STORE_SUBSCRIBE, isAppleDevice, () => false);
  const modKey = isApple ? '⌘' : 'Ctrl';

  const focusTab = React.useCallback((index: number) => {
    tabRefs.current[index]?.focus();
  }, []);

  /**
   * Rail shortcuts.
   *
   * `Ctrl/Cmd + B` and `+ K` already belong to the app shell, and `+ P`,
   * `` + ` `` and `+ Shift + N` to the workspace context. Backslash is
   * unclaimed by both and by the browsers, so the two rails take it — plain for
   * the explorer, shifted for the agent panel. Shift+backslash reports as `|` on
   * a US layout, hence the three-way test.
   */
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const backslash = event.key === '\\' || event.key === '|' || event.code === 'Backslash';
      if (!backslash) return;

      event.preventDefault();
      if (event.shiftKey) setRightCollapsed(!rightCollapsed);
      else setLeftCollapsed(!leftCollapsed);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [leftCollapsed, rightCollapsed, setLeftCollapsed, setRightCollapsed]);

  const activeRun = runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null;
  const activeRunSteps = activeRun?.steps.length ?? 0;

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden bg-bg"
      style={{ height: `calc(100dvh - ${SHELL_HEADER})` }}
    >
      {/* Top bar: rail toggles either side of the tablist. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={leftCollapsed ? 'Show the explorer' : 'Hide the explorer'}
              aria-pressed={!leftCollapsed}
              className="hidden lg:inline-flex"
              onClick={() => setLeftCollapsed(!leftCollapsed)}
            >
              {leftCollapsed ? (
                <PanelLeft className="size-3.5" />
              ) : (
                <PanelLeftClose className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-1.5">
            {leftCollapsed ? 'Show the explorer' : 'Hide the explorer'}
            <span className="flex items-center gap-0.5">
              <Kbd>{modKey}</Kbd>
              <Kbd>\</Kbd>
            </span>
          </TooltipContent>
        </Tooltip>

        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Open the explorer"
          className="lg:hidden"
          onClick={() => setMobileRail('left')}
        >
          <PanelLeft className="size-3.5" />
        </Button>

        <TabStrip activeRunSteps={activeRunSteps} onFocusTab={focusTab} tabRefs={tabRefs} />

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={rightCollapsed ? 'Show the agent panel' : 'Hide the agent panel'}
                aria-pressed={!rightCollapsed}
                className="hidden lg:inline-flex"
                onClick={() => setRightCollapsed(!rightCollapsed)}
              >
                {rightCollapsed ? (
                  <PanelRight className="size-3.5" />
                ) : (
                  <PanelRightClose className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-1.5">
              {rightCollapsed ? 'Show the agent panel' : 'Hide the agent panel'}
              <span className="flex items-center gap-0.5">
                <Kbd>{modKey}</Kbd>
                <Kbd>Shift</Kbd>
                <Kbd>\</Kbd>
              </span>
            </TooltipContent>
          </Tooltip>

          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Open the agent panel"
            className="lg:hidden"
            onClick={() => setMobileRail('right')}
          >
            <PanelRight className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Three columns. Both rails are desktop-only; below `lg` they open as
          sheets from the buttons above, so the centre pane keeps the full width
          instead of being squeezed into unusability. */}
      <div className="flex min-h-0 flex-1">
        {!leftCollapsed ? (
          <aside
            aria-label="Project explorer"
            className="hidden w-64 shrink-0 border-r border-line lg:block xl:w-72"
          >
            <LeftRail />
          </aside>
        ) : null}

        <section aria-label="Workspace panes" className="relative min-h-0 min-w-0 flex-1">
          {TAB_ORDER.map((key) => (
            <div
              key={key}
              role="tabpanel"
              id={`workspace-panel-${key}`}
              aria-labelledby={`workspace-tab-${key}`}
              hidden={key !== tab}
              className="absolute inset-0"
            >
              {mounted.includes(key) ? <Pane tab={key} /> : null}
            </div>
          ))}
        </section>

        {!rightCollapsed ? (
          <aside
            aria-label="Agent, machine and cost"
            className="hidden w-72 shrink-0 border-l border-line lg:block"
          >
            <RightRail />
          </aside>
        ) : null}
      </div>

      {/* Status bar: the four facts you should never have to hunt for. A named
          `section` rather than a `footer`, because a `footer` inside `main` is
          exposed as the page's `contentinfo` landmark and this is not that. */}
      <section
        aria-label="Workspace status"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-surface px-3 py-1 text-[11px] text-subtle"
      >
        <span className="flex items-center gap-1 truncate">
          <GitBranch aria-hidden="true" className="size-3" />
          <span className="truncate font-mono">{data.git.branch}</span>
        </span>
        <span className="karo-numeric">
          {pendingChanges.length} pending {pluralize(pendingChanges.length, 'change')}
        </span>
        <span className="karo-numeric">
          {formatCompactNumber(data.usage.weightedTokens)} weighted ·{' '}
          {formatMicroUsd(data.usage.chargedMicroUsd)} on this project
        </span>
        {sandbox ? (
          <span className="truncate">
            {sandbox.name} · {sandbox.status}
          </span>
        ) : (
          <span>No machine attached</span>
        )}
        {data.demoMode ? (
          <Badge variant="ember" size="sm" className="ml-auto">
            Demo mode — providers simulated
          </Badge>
        ) : null}
      </section>

      <Sheet
        open={mobileRail !== null}
        onOpenChange={(open) => (open ? null : setMobileRail(null))}
      >
        <SheetContent
          side={mobileRail === 'right' ? 'right' : 'left'}
          showCloseButton={false}
          className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0"
        >
          <SheetTitle className="sr-only">
            {mobileRail === 'right' ? 'Agent, machine and cost' : 'Project explorer'}
          </SheetTitle>
          <div className="flex h-full min-h-0 flex-col">
            {mobileRail === 'right' ? <RightRail /> : <LeftRail />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** One pane. Split out so the mounted-tab map above stays readable. */
function Pane({ tab }: { tab: WorkspaceTabKey }) {
  switch (tab) {
    case 'chat':
      return <ChatPanel />;
    case 'code':
      return <CodePanel />;
    case 'preview':
      return <PreviewPanel />;
    case 'terminal':
      return <TerminalPanel />;
    case 'tasks':
      return <TasksPanel />;
    case 'changes':
      return <ChangesPanel />;
  }
}
