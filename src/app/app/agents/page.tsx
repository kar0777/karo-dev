export const dynamic = 'force-dynamic';

import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Cpu,
  Gauge,
  Hammer,
  ListChecks,
  MessageCircle,
  Minus,
  ShieldAlert,
  Timer,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatusDot, type StatusDotStatus } from '@/components/ui/dot';
import { EmptyState } from '@/components/ui/empty-state';
import { renderIcon } from '@/components/ui/icon-slot';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toolIconFor } from '@/components/workspace/icons';
import { AGENT_PERMISSION_KEYS } from '@/lib/account/preferences';
import {
  AGENT_MODES,
  AGENT_MODE_META,
  AGENT_PERMISSION_META,
  DEFAULT_AGENT_PERMISSIONS,
  resolveAgentPermissions,
  type AgentPermissions,
} from '@/lib/agent/policy';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import {
  agentRuns,
  conversations,
  models,
  projects,
  toolCalls,
  users,
  type AgentMode,
  type RunStatus,
  type ToolCallStatus,
} from '@/lib/db/schema';
import { can } from '@/lib/rbac/permissions';
import { loadRunCostSummary } from '@/lib/usage/analytics';
import {
  cn,
  formatCompactNumber,
  formatDateTime,
  formatDuration,
  formatMicroUsd,
  formatNumber,
  formatRelativeTime,
  pluralize,
} from '@/lib/utils';

/**
 * Agent activity for the whole team.
 *
 * A *run* is one thing a person asked for — "fix the failing test" — and the
 * dozen model calls and tool calls that answering it took. The usage page
 * meters requests; this page is the unit above that, so the two agree: the
 * average cost per run here comes from the same `loadRunCostSummary` the usage
 * page uses.
 *
 * Everything is read in the Server Component. The filters, the pagination and
 * the per-run drill-down are all links, so there is no client state that can
 * disagree with the database.
 */

export const metadata = {
  title: 'Agents',
  description: 'Every agent run, the tool calls it made and what each one cost.',
};

/* ------------------------------------------------------------------ *
 *  View state
 * ------------------------------------------------------------------ */

const RANGE_OPTIONS = [
  { value: '7', label: '7d', title: 'Last 7 days', days: 7 },
  { value: '30', label: '30d', title: 'Last 30 days', days: 30 },
  { value: '90', label: '90d', title: 'Last 90 days', days: 90 },
] as const;

type RangeKey = (typeof RANGE_OPTIONS)[number]['value'];

const DEFAULT_RANGE: RangeKey = '30';

/** The last option — what an empty narrower window offers to widen to. */
const WIDEST_RANGE: RangeKey = RANGE_OPTIONS[RANGE_OPTIONS.length - 1]!.value;

/**
 * The windows mirror the usage page's, minus its billing-period option: that
 * one needs the billing context loaded, and nothing else here does.
 */
function resolveRange(raw: string | string[] | undefined): (typeof RANGE_OPTIONS)[number] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return RANGE_OPTIONS.find((option) => option.value === value) ?? RANGE_OPTIONS[1];
}

/** `new Date()` in a component body is rejected by the compiler lint rules. */
function windowStart(days: number): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

const RUN_STATUSES: readonly RunStatus[] = [
  'running',
  'awaiting_approval',
  'queued',
  'succeeded',
  'failed',
  'cancelled',
];

type ModeFilter = AgentMode | 'all';
type StatusFilter = RunStatus | 'all';

function parseMode(raw: string | string[] | undefined): ModeFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return AGENT_MODES.find((mode) => mode === value) ?? 'all';
}

function parseStatus(raw: string | string[] | undefined): StatusFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return RUN_STATUSES.find((status) => status === value) ?? 'all';
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const PAGE_SIZE = 20;

type ViewState = {
  range: RangeKey;
  mode: ModeFilter;
  status: StatusFilter;
  page: number;
  run: string | null;
};

/** Only non-default values reach the URL, so the plain page has a clean link. */
function hrefFor(state: ViewState, changes: Partial<ViewState>, hash = ''): string {
  const next: ViewState = { ...state, ...changes };
  const params = new URLSearchParams();
  if (next.range !== DEFAULT_RANGE) params.set('range', next.range);
  if (next.mode !== 'all') params.set('mode', next.mode);
  if (next.status !== 'all') params.set('status', next.status);
  if (next.page > 1) params.set('page', String(next.page));
  if (next.run) params.set('run', next.run);
  const query = params.toString();
  return `/app/agents${query ? `?${query}` : ''}${hash}`;
}

/* ------------------------------------------------------------------ *
 *  Display metadata
 * ------------------------------------------------------------------ */

const RUN_STATUS_META: Record<
  RunStatus,
  { label: string; dot: StatusDotStatus; badge: BadgeProps['variant'] }
> = {
  queued: { label: 'Queued', dot: 'pending', badge: 'neutral' },
  running: { label: 'Running', dot: 'live', badge: 'primary' },
  awaiting_approval: { label: 'Waiting for you', dot: 'pending', badge: 'warning' },
  succeeded: { label: 'Succeeded', dot: 'idle', badge: 'success' },
  failed: { label: 'Failed', dot: 'error', badge: 'danger' },
  cancelled: { label: 'Cancelled', dot: 'off', badge: 'neutral' },
};

const TOOL_STATUS_META: Record<
  ToolCallStatus,
  { label: string; badge: BadgeProps['variant'] }
> = {
  pending: { label: 'Pending', badge: 'neutral' },
  awaiting_approval: { label: 'Needs approval', badge: 'warning' },
  running: { label: 'Running', badge: 'primary' },
  succeeded: { label: 'Succeeded', badge: 'success' },
  failed: { label: 'Failed', badge: 'danger' },
  rejected: { label: 'Rejected', badge: 'neutral' },
};

const MODE_BADGE: Record<AgentMode, BadgeProps['variant']> = {
  ask: 'neutral',
  plan: 'info',
  build: 'primary',
  auto: 'ember',
};

/**
 * `AGENT_MODE_META` carries a lucide *name*; these are the rendered nodes for
 * the four it names. Elements rather than component references so no render
 * body ends up holding a component-shaped local.
 */
const MODE_ICON: Record<AgentMode, React.ReactNode> = {
  ask: <MessageCircle className="size-3.5" aria-hidden="true" />,
  plan: <ListChecks className="size-3.5" aria-hidden="true" />,
  build: <Hammer className="size-3.5" aria-hidden="true" />,
  auto: <Zap className="size-3.5" aria-hidden="true" />,
};

const RISK_BADGE: Record<'low' | 'medium' | 'high', BadgeProps['variant']> = {
  low: 'neutral',
  medium: 'warning',
  high: 'danger',
};

/** Plan-step statuses come from the run's jsonb, so treat the key as open. */
const STEP_BADGE: Record<string, BadgeProps['variant']> = {
  pending: 'neutral',
  active: 'primary',
  done: 'success',
  skipped: 'outline',
  failed: 'danger',
};

/* ------------------------------------------------------------------ *
 *  Mode policy
 * ------------------------------------------------------------------ */

/**
 * A run's permissions are the project's matrix narrowed by its mode. Resolving
 * the policy against an all-granted matrix isolates the second half: whatever
 * comes back `false` is the mode's own ceiling, not a project decision.
 */
function allPermissionsGranted(): AgentPermissions {
  const granted: AgentPermissions = { ...DEFAULT_AGENT_PERMISSIONS };
  for (const key of AGENT_PERMISSION_KEYS) granted[key] = true;
  return granted;
}

function noPermissionsGranted(): AgentPermissions {
  const denied: AgentPermissions = { ...DEFAULT_AGENT_PERMISSIONS };
  for (const key of AGENT_PERMISSION_KEYS) denied[key] = false;
  return denied;
}

/**
 * `resolveAgentPermissions` is not the whole rule for every mode. The runtime
 * short-circuits `ask` before the matrix is consulted at all —
 * `const tools = input.mode === 'ask' ? [] : availableTools(permissions)` in
 * `@/lib/agent/runtime` — so an Ask run is handed no tools and every permission
 * is moot, including the three the matrix would otherwise leave standing (read
 * files, network access, MCP tools). Rendering the resolved matrix for Ask would
 * tell a reader that an Ask run may read their files, which is not true.
 */
function ceilingFor(mode: AgentMode): AgentPermissions {
  if (mode === 'ask') return noPermissionsGranted();
  return resolveAgentPermissions(allPermissionsGranted(), mode);
}

const MODE_CEILINGS: ReadonlyArray<{ mode: AgentMode; permissions: AgentPermissions }> =
  AGENT_MODES.map((mode) => ({ mode, permissions: ceilingFor(mode) }));

/** One sentence naming what a mode refuses, however permissive the project is. */
function describeCeiling(permissions: AgentPermissions): string {
  const withheld = AGENT_PERMISSION_KEYS.filter((key) => !permissions[key]);
  if (withheld.length === 0) return 'Withholds nothing — the project matrix is the only limit.';
  if (withheld.length === AGENT_PERMISSION_KEYS.length) {
    return 'Withholds everything — a run in this mode is handed no tools at all.';
  }

  const named = withheld
    .slice(0, 3)
    .map((key) => AGENT_PERMISSION_META[key].label.toLowerCase());
  const rest = withheld.length - named.length;
  return `Withholds ${named.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}.`;
}

/**
 * `stopReason` is the provider's `FinishReason` (`@/lib/ai/types`) plus the two
 * literals the runtime writes itself. Anything unrecognised falls back to the
 * status rather than being narrated.
 */
const STOP_REASON_DETAIL: Record<string, string> = {
  stop: 'The agent decided it was done',
  length: 'The model hit its output limit mid-answer',
  tool_calls: 'Ended on a tool call it was still waiting for',
  content_filter: 'The provider refused to continue',
  error: 'The provider returned an error',
  max_iterations: 'Used every turn it was allowed',
  stopped_by_user: 'A person stopped it',
};

/* ------------------------------------------------------------------ *
 *  Tool-call arguments
 * ------------------------------------------------------------------ */

const COMMAND_KEYS = ['command', 'cmd'] as const;
const PATH_KEYS = ['path', 'file', 'filename'] as const;

/**
 * Arguments are provider-shaped jsonb, so nothing about them is guaranteed.
 * Pull out the one key worth showing in a table row and ignore the rest — the
 * full payload belongs in the conversation, next to the output it produced.
 */
function stringArg(
  args: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!args) return null;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Small server-rendered pieces
 * ------------------------------------------------------------------ */

type ChipOption = {
  key: string;
  label: string;
  href: string;
  active: boolean;
  count?: number;
  title?: string;
};

function FilterGroup({ label, options }: { label: string; options: readonly ChipOption[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[11px] font-medium tracking-wide text-subtle uppercase">
        {label}
      </span>
      {options.map((option) => (
        <Button key={option.key} asChild size="xs" variant={option.active ? 'subtle' : 'ghost'}>
          <Link
            href={option.href}
            title={option.title}
            aria-current={option.active ? 'true' : undefined}
          >
            {option.label}
            {typeof option.count === 'number' ? (
              <span
                className={cn('karo-numeric', option.active ? 'text-muted' : 'text-subtle')}
              >
                {formatNumber(option.count)}
              </span>
            ) : null}
          </Link>
        </Button>
      ))}
    </div>
  );
}

/** A cell in the permission matrix: allowed, or withheld by this column. */
function PolicyCell({ allowed }: { allowed: boolean }) {
  return (
    <TableCell className="text-center">
      {allowed ? (
        <Check className="inline size-3.5 text-success" aria-hidden="true" />
      ) : (
        <Minus className="inline size-3.5 text-subtle" aria-hidden="true" />
      )}
      <span className="sr-only">{allowed ? 'Allowed' : 'Not allowed'}</span>
    </TableCell>
  );
}

/* ------------------------------------------------------------------ *
 *  Page
 * ------------------------------------------------------------------ */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AgentsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  const range = resolveRange(params.range);
  const since = windowStart(range.days);
  const view: ViewState = {
    range: range.value,
    mode: parseMode(params.mode),
    status: parseStatus(params.status),
    page: Math.max(1, Number.parseInt(firstParam(params.page) ?? '1', 10) || 1),
    run: firstParam(params.run) ?? null,
  };

  const windowScope = [eq(agentRuns.teamId, team.id), gte(agentRuns.createdAt, since)];
  const listScope = [...windowScope];
  if (view.mode !== 'all') listScope.push(eq(agentRuns.mode, view.mode));
  if (view.status !== 'all') listScope.push(eq(agentRuns.status, view.status));

  const [byStatus, byMode, toolTotals, runCosts, listed, [listedCount]] = await Promise.all([
    db
      .select({
        status: agentRuns.status,
        runs: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${agentRuns.totalInputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${agentRuns.totalOutputTokens}), 0)::bigint`,
        weightedTokens: sql<number>`coalesce(sum(${agentRuns.totalWeightedTokens}), 0)::bigint`,
        // Null on either side (still running, never started) drops out of the
        // sum, and `timedRuns` counts exactly the rows that contributed.
        durationMs: sql<number>`coalesce(sum(extract(epoch from (${agentRuns.finishedAt} - ${agentRuns.startedAt})) * 1000), 0)::float8`,
        timedRuns: sql<number>`count(*) filter (where ${agentRuns.startedAt} is not null and ${agentRuns.finishedAt} is not null)::int`,
      })
      .from(agentRuns)
      .where(and(...windowScope))
      .groupBy(agentRuns.status),
    db
      .select({
        mode: agentRuns.mode,
        runs: sql<number>`count(*)::int`,
        chargedMicroUsd: sql<number>`coalesce(sum(${agentRuns.totalChargedMicroUsd}), 0)::bigint`,
      })
      .from(agentRuns)
      .where(and(...windowScope))
      .groupBy(agentRuns.mode),
    db
      .select({
        calls: sql<number>`count(*)::int`,
        approvals: sql<number>`count(*) filter (where ${toolCalls.requiresApproval})::int`,
        failures: sql<number>`count(*) filter (where ${toolCalls.isError} or ${toolCalls.status} = 'failed')::int`,
      })
      .from(toolCalls)
      .innerJoin(agentRuns, eq(agentRuns.id, toolCalls.runId))
      .where(and(...windowScope)),
    loadRunCostSummary({ teamId: team.id, since, projectId: null }),
    db
      .select({
        id: agentRuns.id,
        title: agentRuns.title,
        mode: agentRuns.mode,
        status: agentRuns.status,
        iterations: agentRuns.iterations,
        maxIterations: agentRuns.maxIterations,
        weightedTokens: agentRuns.totalWeightedTokens,
        chargedMicroUsd: agentRuns.totalChargedMicroUsd,
        usedByok: agentRuns.usedByok,
        createdAt: agentRuns.createdAt,
        startedAt: agentRuns.startedAt,
        finishedAt: agentRuns.finishedAt,
        projectId: agentRuns.projectId,
        projectName: projects.name,
        conversationId: agentRuns.conversationId,
        conversationTitle: conversations.title,
        modelName: models.displayName,
        actorName: users.name,
      })
      .from(agentRuns)
      .innerJoin(projects, eq(projects.id, agentRuns.projectId))
      .innerJoin(conversations, eq(conversations.id, agentRuns.conversationId))
      .innerJoin(users, eq(users.id, agentRuns.userId))
      .leftJoin(models, eq(models.id, agentRuns.modelId))
      .where(and(...listScope))
      .orderBy(desc(agentRuns.createdAt))
      .limit(PAGE_SIZE)
      .offset((view.page - 1) * PAGE_SIZE),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(and(...listScope)),
  ]);

  const runIds = listed.map((row) => row.id);

  // The selected run is fetched by id rather than picked out of `listed`: a
  // `?run=` link can outlive the page it was copied from. The team predicate is
  // what stops another team's run id from resolving.
  const [callCounts, selectedRows, selectedCalls] = await Promise.all([
    runIds.length > 0
      ? db
          .select({
            runId: toolCalls.runId,
            calls: sql<number>`count(*)::int`,
            failures: sql<number>`count(*) filter (where ${toolCalls.isError} or ${toolCalls.status} = 'failed')::int`,
          })
          .from(toolCalls)
          .where(inArray(toolCalls.runId, runIds))
          .groupBy(toolCalls.runId)
      : Promise.resolve([]),
    view.run
      ? db
          .select({
            id: agentRuns.id,
            title: agentRuns.title,
            mode: agentRuns.mode,
            status: agentRuns.status,
            steps: agentRuns.steps,
            stopReason: agentRuns.stopReason,
            errorMessage: agentRuns.errorMessage,
            iterations: agentRuns.iterations,
            maxIterations: agentRuns.maxIterations,
            inputTokens: agentRuns.totalInputTokens,
            outputTokens: agentRuns.totalOutputTokens,
            weightedTokens: agentRuns.totalWeightedTokens,
            chargedMicroUsd: agentRuns.totalChargedMicroUsd,
            usedByok: agentRuns.usedByok,
            createdAt: agentRuns.createdAt,
            startedAt: agentRuns.startedAt,
            finishedAt: agentRuns.finishedAt,
            projectId: agentRuns.projectId,
            projectName: projects.name,
            conversationId: agentRuns.conversationId,
            conversationTitle: conversations.title,
            modelName: models.displayName,
            actorName: users.name,
          })
          .from(agentRuns)
          .innerJoin(projects, eq(projects.id, agentRuns.projectId))
          .innerJoin(conversations, eq(conversations.id, agentRuns.conversationId))
          .innerJoin(users, eq(users.id, agentRuns.userId))
          .leftJoin(models, eq(models.id, agentRuns.modelId))
          .where(and(eq(agentRuns.id, view.run), eq(agentRuns.teamId, team.id)))
          .limit(1)
      : Promise.resolve([]),
    view.run
      ? db
          .select({
            id: toolCalls.id,
            toolName: toolCalls.toolName,
            source: toolCalls.source,
            sourceRef: toolCalls.sourceRef,
            args: toolCalls.args,
            resultSummary: toolCalls.resultSummary,
            status: toolCalls.status,
            requiresApproval: toolCalls.requiresApproval,
            approvedAt: toolCalls.approvedAt,
            rejectedReason: toolCalls.rejectedReason,
            isError: toolCalls.isError,
            exitCode: toolCalls.exitCode,
            durationMs: toolCalls.durationMs,
          })
          .from(toolCalls)
          .innerJoin(
            agentRuns,
            and(eq(agentRuns.id, toolCalls.runId), eq(agentRuns.teamId, team.id)),
          )
          .where(eq(toolCalls.runId, view.run))
          .orderBy(asc(toolCalls.sequence), asc(toolCalls.createdAt))
          .limit(200)
      : Promise.resolve([]),
  ]);

  /* ---------------- window totals ---------------- */

  const statusCounts = new Map<RunStatus, number>(
    byStatus.map((row) => [row.status, Number(row.runs)]),
  );
  const modeStats = new Map<AgentMode, { runs: number; chargedMicroUsd: number }>(
    byMode.map((row) => [
      row.mode,
      { runs: Number(row.runs), chargedMicroUsd: Number(row.chargedMicroUsd) },
    ]),
  );

  const totals = byStatus.reduce(
    (acc, row) => ({
      runs: acc.runs + Number(row.runs),
      inputTokens: acc.inputTokens + Number(row.inputTokens),
      outputTokens: acc.outputTokens + Number(row.outputTokens),
      weightedTokens: acc.weightedTokens + Number(row.weightedTokens),
      durationMs: acc.durationMs + Number(row.durationMs),
      timedRuns: acc.timedRuns + Number(row.timedRuns),
    }),
    {
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      weightedTokens: 0,
      durationMs: 0,
      timedRuns: 0,
    },
  );

  const tools = toolTotals[0];
  const toolCallCount = Number(tools?.calls ?? 0);
  const toolApprovals = Number(tools?.approvals ?? 0);
  const toolFailures = Number(tools?.failures ?? 0);

  const awaiting = statusCounts.get('awaiting_approval') ?? 0;
  const running = statusCounts.get('running') ?? 0;
  const succeeded = statusCounts.get('succeeded') ?? 0;
  const failed = statusCounts.get('failed') ?? 0;
  const canApprove = can(role, 'agent.approve');

  const callsByRun = new Map(callCounts.map((row) => [row.runId, row]));

  const total = Number(listedCount?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(view.page, pageCount);
  const from = total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const to = Math.min(current * PAGE_SIZE, total);
  const filtered = view.mode !== 'all' || view.status !== 'all';

  const selected = selectedRows[0] ?? null;
  const selectedDuration =
    selected?.startedAt && selected.finishedAt
      ? selected.finishedAt.getTime() - selected.startedAt.getTime()
      : null;

  const rangeChips: ChipOption[] = RANGE_OPTIONS.map((option) => ({
    key: option.value,
    label: option.label,
    title: option.title,
    href: hrefFor(view, { range: option.value, page: 1 }),
    active: option.value === view.range,
  }));

  const modeChips: ChipOption[] = [
    {
      key: 'all',
      label: 'All',
      href: hrefFor(view, { mode: 'all', page: 1 }),
      active: view.mode === 'all',
      count: totals.runs,
    },
    ...AGENT_MODES.filter(
      (mode) => (modeStats.get(mode)?.runs ?? 0) > 0 || view.mode === mode,
    ).map((mode) => ({
      key: mode,
      label: AGENT_MODE_META[mode].label,
      title: AGENT_MODE_META[mode].description,
      href: hrefFor(view, { mode, page: 1 }),
      active: view.mode === mode,
      count: modeStats.get(mode)?.runs ?? 0,
    })),
  ];

  const statusChips: ChipOption[] = [
    {
      key: 'all',
      label: 'Any status',
      href: hrefFor(view, { status: 'all', page: 1 }),
      active: view.status === 'all',
    },
    ...RUN_STATUSES.filter(
      (status) => (statusCounts.get(status) ?? 0) > 0 || view.status === status,
    ).map((status) => ({
      key: status,
      label: RUN_STATUS_META[status].label,
      href: hrefFor(view, { status, page: 1 }),
      active: view.status === status,
      count: statusCounts.get(status) ?? 0,
    })),
  ];

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Agents"
        description="One run is one thing you asked for, and everything the agent did to answer it: the model calls, the commands, the file edits. Each run records the mode it ran in, the tools it reached for and what it cost."
        breadcrumbs={[{ label: 'Karo', href: '/app' }, { label: 'Agents' }]}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/app/usage">
              <Gauge aria-hidden="true" />
              Usage
            </Link>
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <FilterGroup label="Window" options={rangeChips} />
            <FilterGroup label="Mode" options={modeChips} />
            <FilterGroup label="Status" options={statusChips} />
          </div>
          <p className="text-[11px] text-subtle">
            Filters narrow the run list. The totals below cover the whole window —{' '}
            {range.title.toLowerCase()}.
          </p>
        </div>
      </PageHeader>

      <StatGrid columns={3}>
        <Stat
          label="Runs"
          value={formatNumber(totals.runs)}
          icon={Bot}
          caption={
            totals.runs === 0
              ? 'No runs in this window'
              : `${formatNumber(succeeded)} succeeded · ${formatNumber(failed)} failed · ${formatNumber(running)} in flight`
          }
        />
        <Stat
          label="Waiting for a person"
          value={formatNumber(awaiting)}
          tone={awaiting > 0 ? 'ember' : 'default'}
          icon={ShieldAlert}
          caption={
            awaiting === 0
              ? 'Nothing is paused on an approval.'
              : canApprove
                ? 'Open the run to approve or reject the call it stopped on.'
                : 'Your role cannot approve agent actions — ask an admin or a developer.'
          }
        />
        <Stat
          label="Weighted tokens"
          value={formatCompactNumber(totals.weightedTokens)}
          icon={Cpu}
          caption={
            totals.runs === 0
              ? 'Weighting normalises every model onto one unit'
              : `${formatCompactNumber(totals.inputTokens)} in · ${formatCompactNumber(totals.outputTokens)} out`
          }
        />
        <Stat
          label="Charged"
          value={formatMicroUsd(runCosts.chargedMicroUsd)}
          tone="ember"
          icon={Coins}
          caption={
            runCosts.averageMicroUsd === null
              ? 'Nothing metered in this window'
              : `${formatMicroUsd(runCosts.averageMicroUsd, { precise: true })} per run on average`
          }
        />
        <Stat
          label="Tool calls"
          value={formatNumber(toolCallCount)}
          icon={Wrench}
          caption={
            toolCallCount === 0
              ? 'Commands, file edits and MCP tools land here'
              : `${formatNumber(toolApprovals)} needed approval · ${formatNumber(toolFailures)} failed`
          }
        />
        <Stat
          label="Average run"
          value={
            totals.timedRuns > 0 ? formatDuration(totals.durationMs / totals.timedRuns) : '—'
          }
          icon={Timer}
          caption={
            totals.timedRuns > 0
              ? `Across ${formatNumber(totals.timedRuns)} finished ${pluralize(totals.timedRuns, 'run')}`
              : 'Measured from start to finish, once a run ends'
          }
        />
      </StatGrid>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>What each mode is allowed to do</CardTitle>
            <CardDescription>
              A run gets a permission only when both its project and its mode allow it. The mode
              is a ceiling: it can take a permission away, never add one. Everything below is
              read from the policy the runtime enforces, not a copy of it.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <ul className="grid gap-px border-b border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
            {MODE_CEILINGS.map(({ mode, permissions }) => {
              const meta = AGENT_MODE_META[mode];
              const stats = modeStats.get(mode);
              const runs = stats?.runs ?? 0;
              return (
                <li key={mode} className="flex flex-col gap-1.5 bg-surface p-4">
                  <span className="flex items-center gap-2">
                    <span className="text-muted">{MODE_ICON[mode]}</span>
                    <span className="text-[13px] font-medium text-fg">{meta.label}</span>
                    <Badge variant={MODE_BADGE[mode]} size="sm">
                      {meta.short}
                    </Badge>
                  </span>
                  <span className="text-[12px] leading-relaxed text-muted">
                    {meta.description}
                  </span>
                  <span className="mt-auto pt-1 text-[11px] leading-snug text-subtle">
                    {describeCeiling(permissions)}
                  </span>
                  <span className="karo-numeric text-[11px] text-muted">
                    {runs === 0
                      ? 'Not used in this window'
                      : `${formatNumber(runs)} ${pluralize(runs, 'run')} · ${formatMicroUsd(stats?.chargedMicroUsd ?? 0)} in this window`}
                  </span>
                </li>
              );
            })}
          </ul>

          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Permission</TableHead>
                <TableHead className="hidden lg:table-cell">What it allows</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-center">Default</TableHead>
                {MODE_CEILINGS.map(({ mode }) => (
                  <TableHead key={mode} className="text-center">
                    {AGENT_MODE_META[mode].label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {AGENT_PERMISSION_KEYS.map((key) => {
                const meta = AGENT_PERMISSION_META[key];
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium whitespace-nowrap text-fg">
                      {meta.label}
                    </TableCell>
                    <TableCell className="hidden max-w-[22rem] text-muted lg:table-cell">
                      {meta.description}
                    </TableCell>
                    <TableCell>
                      <Badge variant={RISK_BADGE[meta.risk]} size="sm">
                        {meta.risk}
                      </Badge>
                    </TableCell>
                    <PolicyCell allowed={DEFAULT_AGENT_PERMISSIONS[key]} />
                    {MODE_CEILINGS.map(({ mode, permissions }) => (
                      <PolicyCell key={mode} allowed={permissions[key]} />
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="border-t border-line p-4">
            <Alert variant="info">
              <AlertTitle>Default is the starting point, not the answer</AlertTitle>
              <AlertDescription>
                The Default column is what a new project begins with. Each project keeps its own
                matrix — open a project and look at Agent permissions to see the one a run
                actually ran under. On top of both, a command policy reads the specific command:
                a force-push or a recursive delete waits for a person even in Auto, and that is
                what a run sitting at “Waiting for you” has stopped on.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>

      <section
        id="runs"
        aria-labelledby="runs-title"
        className="scroll-mt-20 rounded-lg border border-line bg-surface shadow-sm"
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 id="runs-title" className="text-sm leading-tight font-semibold text-fg">
              Runs
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              Newest first. Open a run to see the tool calls it made, or follow the conversation
              to read the whole exchange.
            </p>
          </div>
          {total > 0 ? (
            <p className="karo-numeric shrink-0 text-[11px] text-subtle">
              {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
            </p>
          ) : null}
        </header>

        {listed.length === 0 ? (
          total > 0 ? (
            <EmptyState
              size="sm"
              icon={Bot}
              title="This page is past the end of the list"
              description={`There ${total === 1 ? 'is' : 'are'} ${formatNumber(total)} ${pluralize(total, 'run')} to show, across ${formatNumber(pageCount)} ${pluralize(pageCount, 'page')}.`}
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefFor(view, { page: 1 })}>Back to the first page</Link>
                </Button>
              }
            />
          ) : filtered ? (
            <EmptyState
              size="sm"
              icon={Bot}
              title="No runs match these filters"
              description="Nothing in this window ran in that mode with that status. Widen the window or clear the filters."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefFor(view, { mode: 'all', status: 'all', page: 1 })}>
                    Clear filters
                  </Link>
                </Button>
              }
            />
          ) : view.range !== WIDEST_RANGE ? (
            // The window is a filter too: a team whose last run was six weeks
            // ago must not be told the agent has never run.
            <EmptyState
              size="sm"
              icon={Bot}
              title={`No runs in the ${range.title.toLowerCase()}`}
              description="Anything older is outside this window. Widen it, or start a run by sending a message in a project."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefFor(view, { range: WIDEST_RANGE, page: 1 })}>
                    Look at the last 90 days
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              size="sm"
              icon={Bot}
              title="No runs yet"
              description="Nothing has run in the longest window this page offers. A run starts when you send a message in a project, and every one is recorded here with its mode, its tool calls, its tokens and its cost."
              action={
                <Button asChild size="sm">
                  <Link href="/app/projects">Open a project</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <Table className="min-w-[56rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Run</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="hidden xl:table-cell">Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tools</TableHead>
                  <TableHead className="text-right">Weighted</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listed.map((run) => {
                  const statusMeta = RUN_STATUS_META[run.status];
                  const counts = callsByRun.get(run.id);
                  const calls = Number(counts?.calls ?? 0);
                  const callFailures = Number(counts?.failures ?? 0);
                  const duration =
                    run.startedAt && run.finishedAt
                      ? run.finishedAt.getTime() - run.startedAt.getTime()
                      : null;
                  const isSelected = run.id === selected?.id;
                  const createdIso = run.createdAt.toISOString();

                  return (
                    <TableRow key={run.id} data-state={isSelected ? 'selected' : undefined}>
                      <TableCell className="whitespace-nowrap">
                        <time
                          dateTime={createdIso}
                          title={formatDateTime(createdIso)}
                          className="block text-fg"
                        >
                          {formatRelativeTime(createdIso)}
                        </time>
                        <span className="block text-[11px] text-subtle">
                          {run.actorName || 'A teammate'}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[18rem]">
                        <Link
                          href={`/app/projects/${run.projectId}?conversation=${run.conversationId}`}
                          className="block truncate rounded-sm font-medium text-fg transition-colors duration-150 ease-[var(--k-ease)] hover:text-primary"
                          title={run.title}
                        >
                          {run.title}
                        </Link>
                        <span className="block truncate text-[11px] text-subtle">
                          {run.conversationTitle}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[10rem]">
                        <Link
                          href={`/app/projects/${run.projectId}`}
                          className="block truncate rounded-sm text-muted transition-colors duration-150 ease-[var(--k-ease)] hover:text-primary"
                        >
                          {run.projectName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={MODE_BADGE[run.mode]} size="sm">
                          {AGENT_MODE_META[run.mode].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden max-w-[11rem] xl:table-cell">
                        <span className="block truncate text-muted">
                          {run.modelName ?? 'Model removed'}
                        </span>
                        {run.usedByok ? (
                          <span className="text-[11px] text-subtle">Own API key</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <StatusDot status={statusMeta.dot} label={null} />
                          <Badge variant={statusMeta.badge} size="sm">
                            {statusMeta.label}
                          </Badge>
                        </span>
                        <span className="karo-numeric mt-0.5 block text-[11px] text-subtle">
                          {formatNumber(run.iterations)}/{formatNumber(run.maxIterations)} turns
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {calls === 0 ? (
                          <span className="karo-numeric text-subtle">0</span>
                        ) : (
                          <Link
                            href={hrefFor(view, { run: run.id }, '#run-detail')}
                            className="karo-numeric rounded-sm font-medium text-primary hover:underline"
                          >
                            {formatNumber(calls)}
                          </Link>
                        )}
                        {callFailures > 0 ? (
                          <span className="karo-numeric block text-[11px] text-danger">
                            {formatNumber(callFailures)} failed
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="karo-numeric text-right font-medium text-fg">
                        {formatCompactNumber(run.weightedTokens)}
                      </TableCell>
                      <TableCell className="karo-numeric text-right">
                        <span
                          className={cn(
                            'font-medium',
                            run.chargedMicroUsd > 0 ? 'text-ember' : 'text-subtle',
                          )}
                        >
                          {formatMicroUsd(run.chargedMicroUsd)}
                        </span>
                      </TableCell>
                      <TableCell className="karo-numeric text-right text-muted">
                        {duration === null ? '—' : formatDuration(duration)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {pageCount > 1 ? (
              <nav
                aria-label="Run list pages"
                className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5"
              >
                <p className="karo-numeric text-[11px] text-subtle">
                  Page {current} of {pageCount}
                </p>
                <div className="flex items-center gap-1.5">
                  {current > 1 ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={hrefFor(view, { page: current - 1 }, '#runs')} rel="prev">
                        <ChevronLeft aria-hidden="true" />
                        Previous
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" disabled>
                      <ChevronLeft aria-hidden="true" />
                      Previous
                    </Button>
                  )}
                  {current < pageCount ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={hrefFor(view, { page: current + 1 }, '#runs')} rel="next">
                        Next
                        <ChevronRight aria-hidden="true" />
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" disabled>
                      Next
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </nav>
            ) : null}
          </>
        )}
      </section>

      {view.run ? (
        <section
          id="run-detail"
          aria-labelledby="run-detail-title"
          className="scroll-mt-20 rounded-lg border border-line bg-surface shadow-sm"
        >
          {selected === null ? (
            <EmptyState
              size="sm"
              icon={Bot}
              title="That run is no longer here"
              description="It belongs to another team, or the project it ran in has been deleted. The list above is current."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link href={hrefFor(view, { run: null })}>Back to the list</Link>
                </Button>
              }
            />
          ) : (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h2
                    id="run-detail-title"
                    className="text-sm leading-tight font-semibold text-fg"
                  >
                    {selected.title}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                    <Badge variant={MODE_BADGE[selected.mode]} size="sm">
                      {AGENT_MODE_META[selected.mode].label}
                    </Badge>
                    <Badge variant={RUN_STATUS_META[selected.status].badge} size="sm">
                      {RUN_STATUS_META[selected.status].label}
                    </Badge>
                    <span>{selected.modelName ?? 'Model removed'}</span>
                    <span aria-hidden="true">·</span>
                    <Link
                      href={`/app/projects/${selected.projectId}`}
                      className="rounded-sm text-muted hover:text-primary"
                    >
                      {selected.projectName}
                    </Link>
                    <span aria-hidden="true">/</span>
                    <Link
                      href={`/app/projects/${selected.projectId}?conversation=${selected.conversationId}`}
                      className="rounded-sm text-muted hover:text-primary"
                    >
                      {selected.conversationTitle}
                    </Link>
                    <span aria-hidden="true">·</span>
                    <span>{selected.actorName || 'A teammate'}</span>
                    <span aria-hidden="true">·</span>
                    <time
                      dateTime={selected.createdAt.toISOString()}
                      title={formatDateTime(selected.createdAt.toISOString())}
                    >
                      {formatRelativeTime(selected.createdAt.toISOString())}
                    </time>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button asChild variant="secondary" size="sm">
                    <Link
                      href={`/app/projects/${selected.projectId}?conversation=${selected.conversationId}`}
                    >
                      Open conversation
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="icon-sm" aria-label="Close run details">
                    <Link href={hrefFor(view, { run: null }, '#runs')}>
                      <X aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </header>

              <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3 xl:grid-cols-5">
                <div className="bg-surface px-4 py-3">
                  <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                    Cost
                  </dt>
                  <dd className="karo-numeric mt-0.5 text-[13px] font-medium text-ember">
                    {formatMicroUsd(selected.chargedMicroUsd, { precise: true })}
                  </dd>
                  <dd className="text-[11px] text-subtle">
                    {selected.usedByok ? 'Tokens on your own API key' : 'Charged to this team'}
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                    Weighted tokens
                  </dt>
                  <dd className="karo-numeric mt-0.5 text-[13px] font-medium text-fg">
                    {formatCompactNumber(selected.weightedTokens)}
                  </dd>
                  <dd className="karo-numeric text-[11px] text-subtle">
                    {formatCompactNumber(selected.inputTokens)} in ·{' '}
                    {formatCompactNumber(selected.outputTokens)} out
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                    Duration
                  </dt>
                  <dd className="karo-numeric mt-0.5 text-[13px] font-medium text-fg">
                    {selectedDuration === null ? '—' : formatDuration(selectedDuration)}
                  </dd>
                  <dd className="text-[11px] text-subtle">
                    {selected.finishedAt
                      ? `Finished ${formatRelativeTime(selected.finishedAt)}`
                      : 'Still open'}
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                    Turns
                  </dt>
                  <dd className="karo-numeric mt-0.5 text-[13px] font-medium text-fg">
                    {formatNumber(selected.iterations)}/{formatNumber(selected.maxIterations)}
                  </dd>
                  <dd className="text-[11px] text-subtle">
                    A turn is one model call plus the tools it asked for
                  </dd>
                </div>
                <div className="bg-surface px-4 py-3">
                  <dt className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                    Stopped because
                  </dt>
                  <dd className="mt-0.5 font-mono text-[12px] text-fg">
                    {selected.stopReason ?? '—'}
                  </dd>
                  <dd className="text-[11px] text-subtle">
                    {(selected.stopReason ? STOP_REASON_DETAIL[selected.stopReason] : null) ??
                      RUN_STATUS_META[selected.status].label}
                  </dd>
                </div>
              </dl>

              {selected.errorMessage ? (
                <div className="border-b border-line p-4">
                  <Alert variant="danger">
                    <AlertTitle>This run ended on an error</AlertTitle>
                    <AlertDescription>{selected.errorMessage}</AlertDescription>
                  </Alert>
                </div>
              ) : null}

              {selected.steps.length > 0 ? (
                <div className="border-b border-line px-4 py-3">
                  <h3 className="text-[12px] font-medium text-fg">Plan</h3>
                  <ol className="mt-2 space-y-1.5">
                    {selected.steps.map((step, index) => (
                      <li key={step.id} className="flex items-start gap-2">
                        <span className="karo-numeric mt-0.5 w-4 shrink-0 text-right text-[11px] text-subtle">
                          {index + 1}
                        </span>
                        <Badge
                          variant={STEP_BADGE[step.status] ?? 'neutral'}
                          size="sm"
                          className="mt-px shrink-0"
                        >
                          {step.status}
                        </Badge>
                        <span className="min-w-0">
                          <span className="block text-[12.5px] text-fg">{step.title}</span>
                          {step.detail ? (
                            <span className="block text-[11.5px] leading-snug text-muted">
                              {step.detail}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {selectedCalls.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={Wrench}
                  title="This run made no tool calls"
                  description="It answered from the conversation alone. Ask mode never touches the machine, and a short question in any mode often does not need to."
                />
              ) : (
                <Table className="min-w-[44rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-right">#</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>What it did</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedCalls.map((call, index) => {
                      const command = stringArg(call.args, COMMAND_KEYS);
                      const path = stringArg(call.args, PATH_KEYS);
                      const statusMeta = TOOL_STATUS_META[call.status];
                      return (
                        <TableRow key={call.id}>
                          <TableCell className="karo-numeric text-right text-subtle">
                            {index + 1}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className="flex items-center gap-1.5">
                              <span className="text-subtle">
                                {renderIcon(
                                  toolIconFor(call.toolName, call.source),
                                  'size-3.5',
                                )}
                              </span>
                              <span className="font-mono text-[12px] text-fg">
                                {call.toolName}
                              </span>
                              {call.source !== 'builtin' ? (
                                <Badge variant="outline" size="sm">
                                  {call.sourceRef ?? call.source}
                                </Badge>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[26rem]">
                            {command ? (
                              <code
                                className="block truncate font-mono text-[11.5px] text-fg"
                                title={command}
                              >
                                $ {command}
                              </code>
                            ) : path ? (
                              <code
                                className="block truncate font-mono text-[11.5px] text-muted"
                                title={path}
                              >
                                {path}
                              </code>
                            ) : null}
                            {call.resultSummary ? (
                              <span
                                className={cn(
                                  'block truncate text-[11.5px]',
                                  call.isError ? 'text-danger' : 'text-muted',
                                )}
                                title={call.resultSummary}
                              >
                                {call.resultSummary}
                              </span>
                            ) : null}
                            {call.rejectedReason ? (
                              <span className="block truncate text-[11.5px] text-muted">
                                Rejected: {call.rejectedReason}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <Badge variant={statusMeta.badge} size="sm">
                              {statusMeta.label}
                            </Badge>
                            {call.requiresApproval ? (
                              <span className="block text-[11px] text-subtle">
                                {call.approvedAt
                                  ? `Approved ${formatRelativeTime(call.approvedAt)}`
                                  : 'Needed a person'}
                              </span>
                            ) : null}
                            {call.exitCode !== null && call.exitCode !== 0 ? (
                              <span className="karo-numeric block text-[11px] text-danger">
                                exit {call.exitCode}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="karo-numeric text-right text-muted">
                            {call.durationMs > 0 ? formatDuration(call.durationMs) : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
