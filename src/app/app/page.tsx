import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ArrowRight, Bot, Boxes, Clock, Coins, Cpu, FolderGit2, Wallet } from 'lucide-react';

import { FirstRun } from '@/components/app/dashboard/first-run';
import { NewProjectButton } from '@/components/app/dashboard/new-project-button';
import { QuotaStat } from '@/components/app/dashboard/quota-stat';
import { UsageChart } from '@/components/app/dashboard/usage-chart';
import { RUNTIME_TARGET_META, SANDBOX_STATUS_META, templateIcon } from '@/components/app/meta';
import {
  loadActiveSandboxes,
  loadModelOptions,
  loadProjectTemplates,
  loadRecentProjects,
  loadRecentRuns,
  loadShellContext,
  loadUsageTrend,
  loadWorkerOptions,
} from '@/components/app/shell-data';
import { ACTIVE_TEAM_COOKIE } from '@/components/app/team-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardToolbar } from '@/components/ui/card';
import { StatusDot, type StatusDotStatus } from '@/components/ui/dot';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatGrid } from '@/components/ui/stat';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { plans, type SandboxStatus } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  formatCompactNumber,
  formatHours,
  formatMicroUsd,
  formatNumber,
  formatRelativeTime,
} from '@/lib/utils';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const RUN_STATUS_DOT: Record<string, StatusDotStatus> = {
  queued: 'pending',
  running: 'live',
  awaiting_approval: 'pending',
  succeeded: 'idle',
  failed: 'error',
  cancelled: 'off',
};

const RUN_STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_approval: 'Waiting for you',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function OverviewPage() {
  const { user } = await requireUser();
  if (!user.onboardingCompletedAt) redirect('/app/onboarding');

  const cookieStore = await cookies();
  const active = await getActiveTeam(
    user.id,
    cookieStore.get(ACTIVE_TEAM_COOKIE)?.value ?? null,
  ).catch(() => getActiveTeam(user.id, null));

  const teamId = active.team.id;

  const [context, recentProjects, recentRuns, sandboxList, trend, templates, models, workers] =
    await Promise.all([
      loadShellContext(user.id, teamId),
      loadRecentProjects(teamId),
      loadRecentRuns(teamId),
      loadActiveSandboxes(teamId),
      loadUsageTrend(teamId),
      loadProjectTemplates(),
      loadModelOptions(),
      loadWorkerOptions(teamId),
    ]);

  const [planRow] = await db.select().from(plans).where(eq(plans.id, context.plan.id)).limit(1);
  const allowOwnServer = planRow?.allowOwnServer ?? true;
  const allowExternalSandbox = planRow?.allowExternalSandbox ?? false;

  const { quota, plan } = context;
  const firstName = user.name.trim().split(/\s+/)[0] ?? '';
  const periodEnds = new Date(quota.periodEnd);
  const hasProjects = context.projects.length > 0;

  const newProjectButton = (
    <NewProjectButton
      templates={templates}
      models={models}
      workers={workers}
      allowOwnServer={allowOwnServer}
      allowExternalSandbox={allowExternalSandbox}
      planName={plan.name}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6">
      <PageHeader
        title={`${greeting(new Date())}${firstName ? `, ${firstName}` : ''}`}
        description={
          plan.subscribed
            ? `${active.team.name} is on ${plan.name}. Included quota resets ${formatRelativeTime(periodEnds)}.`
            : `${active.team.name} is on ${plan.name} — you pay only for what you use, and nothing runs without balance.`
        }
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/usage">View usage</Link>
            </Button>
            {newProjectButton}
          </>
        }
      />

      <div className="mt-5 space-y-5">
        <StatGrid columns={4}>
          <QuotaStat
            label="Weighted tokens"
            icon={Coins}
            value={formatCompactNumber(quota.weightedTokensUsed)}
            meter={
              plan.subscribed
                ? {
                    value: quota.weightedTokensUsed,
                    max: quota.weightedTokensIncluded,
                    caption: `of ${formatCompactNumber(quota.weightedTokensIncluded)}`,
                  }
                : undefined
            }
            caption={
              plan.subscribed
                ? `Included in ${plan.name}. Anything beyond is billed at the overage rate.`
                : 'Every request is billed from your balance at the model’s current price.'
            }
          />
          <QuotaStat
            label="Compute hours"
            icon={Cpu}
            tone="ember"
            value={formatHours(quota.computeHoursUsed)}
            meter={
              plan.subscribed
                ? {
                    value: quota.computeHoursUsed,
                    max: quota.computeHoursIncluded,
                    tone: 'ember',
                    caption: `of ${formatHours(quota.computeHoursIncluded)}`,
                  }
                : undefined
            }
            caption="One base hour is 0.25 vCPU with 512 MB RAM. Sleeping sandboxes cost nothing."
          />
          <QuotaStat
            label="Active sandboxes"
            icon={Boxes}
            value={formatNumber(quota.activeSandboxes)}
            meter={{
              value: quota.activeSandboxes,
              max: quota.maxActiveSandboxes,
              caption: `of ${formatNumber(quota.maxActiveSandboxes)} allowed`,
            }}
            caption={
              quota.activeSandboxes >= quota.maxActiveSandboxes
                ? 'At the plan limit — stop one before starting another.'
                : 'Machines currently provisioned, including sleeping ones.'
            }
          />
          <QuotaStat
            label="Spend this period"
            icon={Wallet}
            tone="ember"
            value={formatMicroUsd(quota.spendMicroUsd)}
            caption={
              plan.subscribed
                ? `Overage and pay-as-you-go charges since ${new Date(quota.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`
                : `Balance remaining: ${formatMicroUsd(quota.balanceMicroUsd)}.`
            }
          />
        </StatGrid>

        {!hasProjects ? (
          <FirstRun
            templates={templates}
            models={models}
            workers={workers}
            allowOwnServer={allowOwnServer}
            allowExternalSandbox={allowExternalSandbox}
            planName={plan.name}
            firstName={firstName}
          />
        ) : null}

        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Continue where you left off</CardTitle>
              <CardToolbar>
                <Button asChild variant="ghost" size="xs" iconRight={<ArrowRight />}>
                  <Link href="/app/projects">All projects</Link>
                </Button>
              </CardToolbar>
            </CardHeader>
            <CardContent className={recentProjects.length === 0 ? 'p-0' : 'p-2'}>
              {recentProjects.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={FolderGit2}
                  title="No projects yet"
                  description="Projects hold your files, your conversations and the machine they run on."
                  action={newProjectButton}
                />
              ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {recentProjects.map((project) => {
                    const Icon = templateIcon(
                      templates.find((t) => t.key === project.template)?.icon,
                    );
                    const status = project.sandboxStatus as SandboxStatus | null;
                    const statusMeta = status ? SANDBOX_STATUS_META[status] : null;
                    const runtime = RUNTIME_TARGET_META[project.runtimeTarget];
                    return (
                      <li key={project.id}>
                        <Link
                          href={`/app/projects/${project.id}`}
                          className="flex h-full flex-col gap-1.5 rounded-md border border-line bg-surface p-3 transition-[border-color,background-color] duration-150 ease-[var(--k-ease)] hover:border-line-strong hover:bg-surface-2"
                        >
                          <span className="flex items-center gap-2">
                            <Icon className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                            <span className="flex-1 truncate text-[13px] font-medium text-fg">
                              {project.name}
                            </span>
                            {statusMeta ? (
                              <StatusDot status={statusMeta.dot} label={statusMeta.label} />
                            ) : null}
                          </span>
                          <span className="karo-truncate-2 min-h-[2.2em] text-[12px] leading-snug text-muted">
                            {project.description || 'No description yet.'}
                          </span>
                          <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] text-subtle">
                            <Badge variant="outline" size="sm">
                              {runtime.short}
                            </Badge>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="size-3" aria-hidden="true" />
                              {formatRelativeTime(project.lastActivityAt)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage — last 14 days</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageChart data={trend} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Recent agent runs</CardTitle>
              <CardToolbar>
                <Button asChild variant="ghost" size="xs" iconRight={<ArrowRight />}>
                  <Link href="/app/agents">All runs</Link>
                </Button>
              </CardToolbar>
            </CardHeader>
            <CardContent className={recentRuns.length === 0 ? 'p-0' : 'p-0'}>
              {recentRuns.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={Bot}
                  title="The agent has not run yet"
                  description="Open a project and send a message. Every run is recorded here with its status, tokens and cost."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {recentRuns.map((run) => (
                    <li key={run.id}>
                      <Link
                        href={`/app/projects/${run.projectId}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 ease-[var(--k-ease)] hover:bg-surface-2"
                      >
                        <StatusDot
                          status={RUN_STATUS_DOT[run.status] ?? 'idle'}
                          label={RUN_STATUS_LABEL[run.status] ?? run.status}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-fg">
                            {run.title}
                          </span>
                          <span className="block truncate text-[11px] text-subtle">
                            {run.projectName} · {RUN_STATUS_LABEL[run.status] ?? run.status} ·{' '}
                            {formatRelativeTime(run.finishedAt ?? run.createdAt)}
                          </span>
                        </span>
                        <span className="karo-numeric hidden shrink-0 text-right text-[11px] sm:block">
                          <span className="block text-muted">
                            {formatCompactNumber(run.weightedTokens)} wt
                          </span>
                          <span className="block text-ember">
                            {formatMicroUsd(run.chargedMicroUsd)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sandboxes</CardTitle>
              <CardToolbar>
                <Button asChild variant="ghost" size="xs" iconRight={<ArrowRight />}>
                  <Link href="/app/sandboxes">Manage</Link>
                </Button>
              </CardToolbar>
            </CardHeader>
            <CardContent className="p-0">
              {sandboxList.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={Boxes}
                  title="No machines running"
                  description="A sandbox starts the first time the agent needs to touch the filesystem or a shell."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {sandboxList.map((sandbox) => {
                    const meta = SANDBOX_STATUS_META[sandbox.status as SandboxStatus];
                    return (
                      <li key={sandbox.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <StatusDot status={meta?.dot ?? 'idle'} label={meta?.label ?? null} />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-fg">
                            {sandbox.name}
                          </span>
                          <Badge
                            variant={sandbox.status === 'running' ? 'primary' : 'neutral'}
                            size="sm"
                          >
                            {meta?.label ?? sandbox.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-subtle">
                          {sandbox.statusMessage ?? meta?.detail ?? ''}
                        </p>
                        <p className="karo-numeric mt-1 text-[11px] text-muted">
                          {sandbox.projectName ?? 'Unattached'} · {sandbox.cpuCores} vCPU ·{' '}
                          {formatNumber(sandbox.memoryMb)} MB
                          {sandbox.status === 'running'
                            ? ` · ${Math.round(sandbox.cpuPercent)}% CPU`
                            : ''}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {context.notifications.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              {context.unreadNotifications > 0 ? (
                <CardToolbar>
                  <Badge variant="ember" size="sm">
                    {context.unreadNotifications} unread
                  </Badge>
                </CardToolbar>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-line">
                {context.notifications.slice(0, 5).map((notification) => (
                  <li
                    key={notification.id}
                    className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5"
                  >
                    <StatusDot
                      status={
                        notification.level === 'error'
                          ? 'error'
                          : notification.level === 'warning'
                            ? 'pending'
                            : notification.level === 'success'
                              ? 'live'
                              : 'sleeping'
                      }
                      label={notification.level}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg">{notification.title}</p>
                      {notification.body ? (
                        <p className="mt-0.5 text-[12px] leading-snug text-muted">
                          {notification.body}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-subtle">
                      <time dateTime={notification.createdAt}>
                        {formatRelativeTime(notification.createdAt)}
                      </time>
                      {notification.actionHref ? (
                        <Link
                          href={notification.actionHref}
                          className="rounded-sm font-medium text-primary hover:underline"
                        >
                          {notification.actionLabel ?? 'Open'}
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
