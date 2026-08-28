import { asc, eq } from 'drizzle-orm';

import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedPlugins, plugins, users } from '@/lib/db/schema';
import { toInstalledPluginView, toPluginView } from '@/lib/extensions/plugin-view';
import { loadTeamPlan } from '@/lib/extensions/service';

/** `GET /api/plugins` — the marketplace catalogue with this team's install state. */
export const GET = defineHandler({ auth: 'required' }, async ({ user }) => {
  const { team } = await getActiveTeam(user.id);
  await requireApiTeamPermission(team.id, 'plugin.read');

  const plan = await loadTeamPlan(team.id);

  const catalogue = await db
    .select()
    .from(plugins)
    .where(eq(plugins.isActive, true))
    .orderBy(asc(plugins.name));

  const installations = await db
    .select({
      installation: installedPlugins,
      installerName: users.name,
      installerEmail: users.email,
    })
    .from(installedPlugins)
    .leftJoin(users, eq(users.id, installedPlugins.installedById))
    .where(eq(installedPlugins.teamId, team.id));

  const byPlugin = new Map(installations.map((row) => [row.installation.pluginId, row]));

  return json({
    plugins: catalogue.map((plugin) => {
      const row = byPlugin.get(plugin.id);
      const installed = row
        ? toInstalledPluginView(
            row.installation,
            plugin.version,
            row.installerName || row.installerEmail || 'A team member',
          )
        : null;
      return toPluginView(plugin, plan, installed);
    }),
    limits: {
      maxPlugins: plan.maxPlugins,
      used: installations.length,
      planName: plan.name,
      planTier: plan.tier,
    },
  });
});
