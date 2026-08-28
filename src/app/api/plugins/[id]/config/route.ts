import { eq } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedPlugins, plugins } from '@/lib/db/schema';
import { evaluatePluginHealth, toInstalledPluginView } from '@/lib/extensions/plugin-view';
import { pluginConfigSchema } from '@/lib/extensions/schemas';
import {
  findInstalledPlugin,
  loadTeamPlan,
  mergeSecrets,
  pathParam,
} from '@/lib/extensions/service';

/**
 * `PATCH /api/plugins/[id]/config` — configuration, enable/disable and the
 * "Update" action that re-pins an installation to the catalogue version.
 *
 * A secret is only ever written, never read back: sending an empty string for a
 * secret key clears it, sending a value replaces it, omitting it leaves the
 * stored value untouched.
 */
export const PATCH = defineHandler(
  {
    auth: 'required',
    body: pluginConfigSchema,
    audit: { action: AUDIT_ACTIONS.pluginConfigure, resourceType: 'plugin' },
  },
  async ({ user, body, params, setAudit }) => {
    const pluginId = pathParam(params, 'id');
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'plugin.manage');

    const [plugin] = await db.select().from(plugins).where(eq(plugins.id, pluginId)).limit(1);
    if (!plugin) throw new NotFoundError('Plugin not found.');

    const installation = await findInstalledPlugin(team.id, plugin.id);
    if (!installation) {
      throw new NotFoundError(`${plugin.name} is not installed.`, {
        title: 'Not installed',
        description: 'Install the plugin before configuring it.',
      });
    }

    const schema = new Map((plugin.configSchema ?? []).map((field) => [field.key, field]));

    const config: Record<string, string> = { ...(installation.config ?? {}) };
    for (const [key, value] of Object.entries(body.config ?? {})) {
      const field = schema.get(key);
      if (!field || field.secret) continue;
      if (value === '') delete config[key];
      else config[key] = value;
    }

    const secretPatch: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.secrets ?? {})) {
      const field = schema.get(key);
      if (!field || !field.secret) continue;
      secretPatch[key] = value;
    }

    const [updated] = await db
      .update(installedPlugins)
      .set({
        config,
        secretsCiphertext:
          Object.keys(secretPatch).length > 0
            ? mergeSecrets(installation.secretsCiphertext, secretPatch)
            : installation.secretsCiphertext,
        isEnabled: body.isEnabled ?? installation.isEnabled,
        version: body.upgrade ? plugin.version : installation.version,
        grantedPermissions: body.upgrade
          ? (plugin.permissions ?? []).map((permission) => permission.key)
          : installation.grantedPermissions,
        updatedAt: new Date(),
      })
      .where(eq(installedPlugins.id, installation.id))
      .returning();

    if (!updated) throw new ConflictError('The configuration could not be saved. Try again.');

    const plan = await loadTeamPlan(team.id);
    const health = evaluatePluginHealth(plugin, updated, plan);

    const [withHealth] = await db
      .update(installedPlugins)
      .set({
        healthStatus: health.status,
        healthMessage: health.message,
        lastHealthCheckAt: new Date(),
      })
      .where(eq(installedPlugins.id, updated.id))
      .returning();

    setAudit({
      teamId: team.id,
      resourceId: plugin.id,
      summary: body.upgrade
        ? `Plugin "${plugin.name}" updated to ${plugin.version}`
        : `Plugin "${plugin.name}" configured`,
      metadata: {
        configKeys: Object.keys(body.config ?? {}),
        secretKeys: Object.keys(secretPatch),
        isEnabled: updated.isEnabled,
        upgraded: Boolean(body.upgrade),
      },
    });

    return json({
      installation: toInstalledPluginView(
        withHealth ?? updated,
        plugin.version,
        user.name || user.email,
      ),
      health,
    });
  },
);
