export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { toApiKeyView } from '@/lib/account/api-keys';
import { buildInstallCommand, toWorkerView } from '@/lib/account/byos';
import { PLAN_TIER_LABELS, planTierAtLeast } from '@/lib/account/plans';
import {
  normalizeTheme,
  normalizeUserLocale,
  readPreferences,
} from '@/lib/account/preferences';
import { describeSession } from '@/lib/account/sessions';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { listUserSessions } from '@/lib/auth/session';
import { configuredProviderKeys } from '@/lib/ai';
import { db } from '@/lib/db';
import {
  byosWorkers,
  conversations,
  models,
  projects,
  providers,
  sandboxes,
  teamMembers,
  teams,
  userApiKeys,
  type PlanTier,
  type ShellKind,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import { can } from '@/lib/rbac/permissions';
import { loadBillingContext } from '@/lib/usage/metering';
import { AgentDefaultsForm, type ShellOption } from '@/components/settings/agent-defaults-form';
import { DangerZone } from '@/components/settings/danger-zone';
import {
  ModelApiSection,
  type ModelAvailability,
} from '@/components/settings/model-api-section';
import { NotificationsForm } from '@/components/settings/notifications-form';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecuritySection } from '@/components/settings/security-section';
import { ServersSection } from '@/components/settings/servers-section';
import {
  SECTION_META,
  SettingsNav,
  isSettingsSection,
  type SettingsSection,
} from '@/components/settings/settings-nav';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Profile, security, agent defaults, model provider, servers and notifications.',
};

const SHELL_LABELS: Record<ShellKind, string> = {
  bash: 'bash',
  sh: 'sh (POSIX)',
  powershell: 'PowerShell',
  cmd: 'cmd.exe',
};

const ALL_SHELLS: ShellKind[] = ['bash', 'sh', 'powershell', 'cmd'];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.section) ? params.section[0] : params.section;
  const section: SettingsSection = isSettingsSection(raw) ? raw : 'profile';

  const { user, session } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);
  const billing = await loadBillingContext(team.id);
  const preferences = readPreferences(user.onboardingState);
  const meta = SECTION_META[section];

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Settings"
        description="Everything about your account: how you sign in, what the agent may do, and where your work runs."
        breadcrumbs={[{ label: 'Karo', href: '/app' }, { label: 'Settings' }]}
      />

      <div className="grid gap-5 lg:grid-cols-[190px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <SettingsNav active={section} />
        </div>

        <section aria-label={meta.label} className="min-w-0 space-y-4">
          <div className="lg:hidden">
            <h2 className="text-[15px] font-semibold text-fg">{meta.label}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">{meta.description}</p>
          </div>

          {section === 'profile' ? (
            <ProfileForm
              initial={{
                name: user.name,
                email: user.email,
                emailVerified: Boolean(user.emailVerifiedAt),
                avatarColor: preferences.avatarColor,
                locale: normalizeUserLocale(user.locale),
                theme: normalizeTheme(user.theme),
              }}
            />
          ) : null}

          {section === 'security'
            ? await renderSecurity(user.id, session.id, user.passwordHash)
            : null}

          {section === 'agent'
            ? await renderAgentDefaults(
                preferences.agentDefaults,
                billing.plan.tier,
                billing.plan.name,
                billing.plan.allowedShells,
              )
            : null}

          {section === 'models'
            ? await renderModelApi(
                user.id,
                billing.plan.tier,
                billing.plan.name,
                billing.plan.allowByok,
              )
            : null}

          {section === 'servers'
            ? await renderServers(
                team.id,
                can(role, 'worker.manage'),
                billing.plan.allowOwnServer,
                billing.plan.name,
              )
            : null}

          {section === 'notifications' ? (
            <NotificationsForm
              initial={preferences.notifications}
              usageAlertThresholdPercent={Math.round(team.usageAlertThreshold * 100)}
            />
          ) : null}

          {section === 'danger' ? await renderDanger(user.id, user.email, user.isDemo) : null}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Section loaders
 *
 *  Each section queries only what it renders, so opening "Profile" does not
 *  pay for the model catalogue or the worker list.
 * ------------------------------------------------------------------ */

async function renderSecurity(userId: string, sessionId: string, passwordHash: string | null) {
  const rows = await listUserSessions(userId);
  const views = rows
    .map((row) => describeSession(row, sessionId))
    .sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) || b.lastUsedAt.localeCompare(a.lastUsedAt),
    );

  return <SecuritySection sessions={views} hasPassword={Boolean(passwordHash)} />;
}

async function renderAgentDefaults(
  defaults: ReturnType<typeof readPreferences>['agentDefaults'],
  planTier: PlanTier,
  planName: string,
  allowedShells: string[],
) {
  const rows = await db
    .select({ model: models, provider: providers })
    .from(models)
    .innerJoin(providers, eq(providers.id, models.providerId))
    .where(eq(models.isEnabled, true))
    .orderBy(asc(models.sortOrder), asc(models.displayName));

  const options = rows.map((row) => ({
    id: row.model.id,
    label: row.model.displayName,
    providerName: row.provider.name,
    available: planTierAtLeast(planTier, row.model.minPlanTier),
    requiredPlanLabel: PLAN_TIER_LABELS[row.model.minPlanTier],
  }));

  const shells: ShellOption[] = ALL_SHELLS.map((value) => ({
    value,
    label: SHELL_LABELS[value],
    available: allowedShells.includes(value),
  }));

  return (
    <AgentDefaultsForm
      defaults={defaults}
      models={options}
      shells={shells}
      planName={planName}
    />
  );
}

async function renderModelApi(
  userId: string,
  planTier: PlanTier,
  planName: string,
  allowByok: boolean,
) {
  const [modelRows, keyRows, providerRows] = await Promise.all([
    db
      .select({ model: models, provider: providers })
      .from(models)
      .innerJoin(providers, eq(providers.id, models.providerId))
      .where(eq(models.isEnabled, true))
      .orderBy(desc(models.isDefault), asc(models.sortOrder), asc(models.displayName)),
    db.select().from(userApiKeys).where(eq(userApiKeys.userId, userId)),
    db.select().from(providers),
  ]);

  const providerNames = new Map(providerRows.map((row) => [row.key, row.name]));

  /**
   * What this user can genuinely reach: Karo's platform credentials plus their
   * own active BYOK keys. Without the user's keys here, the page told an
   * operator with a personal W&B key that every Omniakey model was "Included"
   * — included in nothing, since no credential anywhere could serve it.
   */
  const reachable = new Set<string>(configuredProviderKeys());
  for (const key of keyRows) {
    if (key.isActive) reachable.add(key.providerKey);
  }

  const catalogue: ModelAvailability[] = modelRows.map((row) => ({
    id: row.model.id,
    name: row.model.displayName,
    providerKey: row.provider.key,
    providerName: row.provider.name,
    family: row.model.family,
    contextWindow: row.model.contextWindow,
    minPlanTier: row.model.minPlanTier,
    requiredPlanLabel: PLAN_TIER_LABELS[row.model.minPlanTier],
    available: planTierAtLeast(planTier, row.model.minPlanTier),
    ready: reachable.has(row.provider.key),
    isDefault: row.model.isDefault,
    supportsVision: row.model.supportsVision,
    supportsTools: row.model.supportsTools,
  }));

  // What actually answers this user's runs: their own active key first, then
  // Karo's platform credentials, then the simulator. The raw `env.AI_PROVIDER`
  // describes the install, not the person viewing the page.
  const activeByokKey = keyRows.find((row) => row.isActive);
  const platformKey = configuredProviderKeys()[0];
  const activeKey = activeByokKey?.providerKey ?? platformKey ?? 'mock';
  const activeName = activeByokKey
    ? `${providerNames.get(activeKey) ?? activeKey} (your key)`
    : platformKey
      ? (providerNames.get(activeKey) ?? env.AI_PROVIDER_NAME)
      : 'Karo simulator (nothing configured)';

  return (
    <ModelApiSection
      demoMode={env.DEMO_MODE}
      activeProvider={{ key: activeKey, name: activeName, configured: reachable.size > 0 }}
      byok={keyRows.map((row) => {
        const view = toApiKeyView(row, providerNames.get(row.providerKey));
        return {
          id: view.id,
          label: view.label,
          providerName: view.providerName,
          maskedKey: view.maskedKey,
          verification: view.verification,
          isActive: view.isActive,
        };
      })}
      models={catalogue}
      planName={planName}
      allowByok={allowByok}
    />
  );
}

async function renderServers(
  teamId: string,
  canManage: boolean,
  allowOwnServer: boolean,
  planName: string,
) {
  const rows = await db
    .select()
    .from(byosWorkers)
    .where(and(eq(byosWorkers.teamId, teamId), ne(byosWorkers.status, 'revoked')))
    .orderBy(desc(byosWorkers.createdAt));

  const now = Date.now();

  return (
    <ServersSection
      workers={rows.map((row) => toWorkerView(row, now))}
      canManage={canManage}
      allowOwnServer={allowOwnServer}
      planName={planName}
      installCommandExample={buildInstallCommand('INSTALL_TOKEN')}
      installCommandExampleWindows={buildInstallCommand('INSTALL_TOKEN', 'powershell')}
    />
  );
}

async function renderDanger(userId: string, email: string, isDemo: boolean) {
  const owned = await db.select().from(teams).where(eq(teams.ownerId, userId));
  const ownedIds = owned.map((team) => team.id);

  const memberCounts = await Promise.all(
    owned.map(async (team) => {
      const [row] = await db
        .select({ total: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id));
      return { name: team.name, others: Math.max(0, (row?.total ?? 1) - 1) };
    }),
  );

  const [projectCount, sandboxCount, conversationCount, keyCount, workerCount] =
    await Promise.all([
      countRows(
        db.select({ total: count() }).from(projects).where(inTeams(projects.teamId, ownedIds)),
      ),
      countRows(
        db
          .select({ total: count() })
          .from(sandboxes)
          .where(inTeams(sandboxes.teamId, ownedIds)),
      ),
      countRows(
        db
          .select({ total: count() })
          .from(conversations)
          .where(eq(conversations.userId, userId)),
      ),
      countRows(
        db.select({ total: count() }).from(userApiKeys).where(eq(userApiKeys.userId, userId)),
      ),
      countRows(
        db
          .select({ total: count() })
          .from(byosWorkers)
          .where(inTeams(byosWorkers.teamId, ownedIds)),
      ),
    ]);

  return (
    <DangerZone
      email={email}
      isDemo={isDemo}
      ownedSoloTeams={memberCounts.filter((team) => team.others === 0).map((team) => team.name)}
      ownedSharedTeams={memberCounts.filter((team) => team.others > 0).map((team) => team.name)}
      removed={{
        projects: projectCount,
        sandboxes: sandboxCount,
        conversations: conversationCount,
        apiKeys: keyCount,
        servers: workerCount,
      }}
    />
  );
}

/** `inArray` with an empty list is invalid SQL; `false` is the honest answer. */
function inTeams(column: AnyPgColumn, teamIds: string[]): SQL {
  return teamIds.length === 0 ? sql`false` : inArray(column, teamIds);
}

async function countRows(query: Promise<Array<{ total: number }>>): Promise<number> {
  const rows = await query;
  return rows[0]?.total ?? 0;
}
