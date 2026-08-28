import { eq } from 'drizzle-orm';

import { NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedPlugins, plugins } from '@/lib/db/schema';
import { evaluatePluginHealth, toInstalledPluginView } from '@/lib/extensions/plugin-view';
import { findInstalledPlugin, loadTeamPlan, pathParam } from '@/lib/extensions/service';

/**
 * `POST /api/plugins/[id]/health` — re-evaluates whether a run that used this
 * plugin would work, and persists the verdict so the marketplace card shows it
 * without re-checking on every render.
 *
 * A failed check is a 200 with `ok: false`. Only "the plugin is not installed"
 * is an error, because that is a bug in the caller rather than a plugin state.
 */
export const POST = defineHandler({ auth: 'required' }, async ({ user, params }) => {
  const pluginId = pathParam(params, 'id');
  const { team } = await getActiveTeam(user.id);
  await requireApiTeamPermission(team.id, 'plugin.read');

  const [plugin] = await db.select().from(plugins).where(eq(plugins.id, pluginId)).limit(1);
  if (!plugin) throw new NotFoundError('Plugin not found.');

  const installation = await findInstalledPlugin(team.id, plugin.id);
  if (!installation) {
    throw new NotFoundError(`${plugin.name} is not installed.`, {
      title: 'Not installed',
      description: 'There is nothing to health-check until the plugin is installed.',
    });
  }

  const plan = await loadTeamPlan(team.id);
  const health = evaluatePluginHealth(plugin, installation, plan);

  const [updated] = await db
    .update(installedPlugins)
    .set({
      healthStatus: health.status,
      healthMessage: health.message,
      lastHealthCheckAt: new Date(),
    })
    .where(eq(installedPlugins.id, installation.id))
    .returning();

  return json({
    health,
    installation: toInstalledPluginView(
      updated ?? installation,
      plugin.version,
      user.name || user.email,
    ),
  });
});
