export const dynamic = 'force-dynamic';

import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { PluginMarketplace } from '@/components/extensions/plugin-marketplace';
import { PageHeader } from '@/components/ui/page-header';
import { AUDIT_ACTIONS, auditActionLabel } from '@/lib/audit';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { auditEvents, installedPlugins, plugins, users } from '@/lib/db/schema';
import { toInstalledPluginView, toPluginView } from '@/lib/extensions/plugin-view';
import { loadTeamPlan } from '@/lib/extensions/service';
import type { PluginAuditEntryView } from '@/lib/extensions/types';
import { can } from '@/lib/rbac/permissions';

export const metadata = {
  title: 'Plugins',
  description: 'Install packaged runtimes that give the agent more tools inside its sandbox.',
};

/**
 * The three actions that make up a plugin's history. All of them are written by
 * the `/api/plugins/[id]/*` routes with the *catalogue* plugin id in
 * `resourceId`, which is what lets the trail be bucketed per plugin below.
 * `plugin.uninstall` is included deliberately: a plugin that was removed and
 * installed again should show that, otherwise the trail reads as if nothing
 * happened between the two installs.
 */
const PLUGIN_AUDIT_ACTIONS: string[] = [
  AUDIT_ACTIONS.pluginInstall,
  AUDIT_ACTIONS.pluginConfigure,
  AUDIT_ACTIONS.pluginUninstall,
];

/** Entries kept per plugin. The detail dialog shows a recent trail, not a log. */
const AUDIT_PER_PLUGIN = 6;

/**
 * A single ordered read is enough to fill every plugin's trail because plugin
 * events are rare, human-driven and plan-capped: installing, reconfiguring or
 * removing a plugin happens a handful of times per team, not per run. The cap
 * only bites for a team that has reconfigured plugins hundreds of times, and
 * even then it drops the oldest entries of the least recently touched plugin —
 * which is the right thing for a view labelled "recent".
 */
const AUDIT_SCAN_LIMIT = 400;

export default async function PluginsPage() {
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);

  const [catalogue, installations, auditRows, plan] = await Promise.all([
    db.select().from(plugins).where(eq(plugins.isActive, true)).orderBy(asc(plugins.name)),
    db
      .select({
        installation: installedPlugins,
        installerName: users.name,
        installerEmail: users.email,
      })
      .from(installedPlugins)
      .leftJoin(users, eq(users.id, installedPlugins.installedById))
      .where(eq(installedPlugins.teamId, team.id)),
    db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        summary: auditEvents.summary,
        actorType: auditEvents.actorType,
        pluginId: auditEvents.resourceId,
        at: auditEvents.createdAt,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.userId))
      .where(
        and(eq(auditEvents.teamId, team.id), inArray(auditEvents.action, PLUGIN_AUDIT_ACTIONS)),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(AUDIT_SCAN_LIMIT),
    loadTeamPlan(team.id),
  ]);

  const byPlugin = new Map(installations.map((row) => [row.installation.pluginId, row]));

  const pluginViews = catalogue.map((plugin) => {
    const row = byPlugin.get(plugin.id);
    return toPluginView(
      plugin,
      plan,
      row
        ? toInstalledPluginView(
            row.installation,
            plugin.version,
            row.installerName || row.installerEmail || 'A team member',
          )
        : null,
    );
  });

  // Seeded with every catalogue plugin so the map is total: a plugin with no
  // history gets an empty array rather than a missing key, and events whose
  // plugin has since been deactivated are dropped instead of leaking into a
  // dialog that cannot be opened.
  const auditByPlugin: Record<string, PluginAuditEntryView[]> = Object.fromEntries(
    catalogue.map((plugin) => [plugin.id, [] as PluginAuditEntryView[]]),
  );

  for (const row of auditRows) {
    const bucket = row.pluginId === null ? undefined : auditByPlugin[row.pluginId];
    if (!bucket || bucket.length >= AUDIT_PER_PLUGIN) continue;
    bucket.push({
      id: row.id,
      action: row.action,
      label: auditActionLabel(row.action),
      summary: row.summary,
      // Only user-driven routes write these actions today, so a missing user row
      // means the account was deleted rather than that Karo acted on its own —
      // but a non-user actor type is still named for what it is.
      actorName:
        row.actorType === 'user'
          ? row.actorName || row.actorEmail || 'A former team member'
          : 'Karo',
      at: row.at.toISOString(),
    });
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Plugins"
        description="A plugin installs a runtime into the sandbox and registers the tools that come with it — a Docker daemon, a database client, a browser driver. Because those tools are then available to every run this team makes, each install asks you to read what it can reach before you accept."
        breadcrumbs={[{ label: 'Karo', href: '/app' }, { label: 'Plugins' }]}
      />

      <PluginMarketplace
        plugins={pluginViews}
        auditByPlugin={auditByPlugin}
        canManage={can(role, 'plugin.manage')}
        limits={{ maxPlugins: plan.maxPlugins, planName: plan.name }}
      />
    </div>
  );
}
