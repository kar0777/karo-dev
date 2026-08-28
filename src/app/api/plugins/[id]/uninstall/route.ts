import { eq, sql } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedPlugins, plugins } from '@/lib/db/schema';
import { findInstalledPlugin, pathParam } from '@/lib/extensions/service';

/** `POST /api/plugins/[id]/uninstall` — removes the plugin and its stored config. */
export const POST = defineHandler(
  {
    auth: 'required',
    audit: {
      action: AUDIT_ACTIONS.pluginUninstall,
      resourceType: 'plugin',
      severity: 'notice',
    },
  },
  async ({ user, params, setAudit }) => {
    const pluginId = pathParam(params, 'id');
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'plugin.manage');

    const [plugin] = await db.select().from(plugins).where(eq(plugins.id, pluginId)).limit(1);
    if (!plugin) throw new NotFoundError('Plugin not found.');

    const installation = await findInstalledPlugin(team.id, plugin.id);
    if (!installation) {
      throw new NotFoundError(`${plugin.name} is not installed.`, {
        title: 'Not installed',
        description: 'Nothing to remove — this plugin is not installed for your team.',
      });
    }

    await db.delete(installedPlugins).where(eq(installedPlugins.id, installation.id));
    await db
      .update(plugins)
      .set({ installCount: sql`greatest(${plugins.installCount} - 1, 0)` })
      .where(eq(plugins.id, plugin.id));

    setAudit({
      teamId: team.id,
      resourceId: plugin.id,
      summary: `Plugin "${plugin.name}" removed`,
      metadata: { version: installation.version },
    });

    return json({ ok: true, pluginId: plugin.id });
  },
);
