import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/api/errors';
import { defineHandler } from '@/lib/api/handler';
import { created } from '@/lib/api/responses';
import { AUDIT_ACTIONS } from '@/lib/audit';
import { getActiveTeam, requireApiTeamPermission } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { installedPlugins, plugins } from '@/lib/db/schema';
import { evaluatePluginHealth, toInstalledPluginView } from '@/lib/extensions/plugin-view';
import { pluginInstallSchema } from '@/lib/extensions/schemas';
import {
  assertPluginQuota,
  buildSecrets,
  loadTeamPlan,
  pathParam,
  tierAtLeast,
} from '@/lib/extensions/service';
import { ID_PREFIX, newId } from '@/lib/ids';

/**
 * `POST /api/plugins/[id]/install`
 *
 * The consent step is enforced server-side: every permission the plugin
 * declares has to appear in `grantedPermissions`, and `acceptedPermissions`
 * must be literally `true`. A client that skips the consent screen gets a 400,
 * not a silent install.
 */
export const POST = defineHandler(
  {
    auth: 'required',
    body: pluginInstallSchema,
    audit: { action: AUDIT_ACTIONS.pluginInstall, resourceType: 'plugin', severity: 'notice' },
  },
  async ({ user, body, params, setAudit }) => {
    const pluginId = pathParam(params, 'id');
    const { team } = await getActiveTeam(user.id);
    await requireApiTeamPermission(team.id, 'plugin.manage');

    const [plugin] = await db
      .select()
      .from(plugins)
      .where(and(eq(plugins.id, pluginId), eq(plugins.isActive, true)))
      .limit(1);
    if (!plugin) throw new NotFoundError('Plugin not found.');

    const plan = await loadTeamPlan(team.id);
    if (!tierAtLeast(plan.tier, plugin.minPlanTier)) {
      throw new ForbiddenError(`${plugin.name} is not included in the ${plan.name} plan.`, {
        code: 'quota_exceeded',
        title: `${plugin.name} needs a higher plan`,
        description: `Upgrade to unlock ${plugin.name}, or pick a plugin included in ${plan.name}. Nothing was installed.`,
        details: { minPlanTier: plugin.minPlanTier, planTier: plan.tier },
      });
    }

    if (plugin.requiresPrivileged) {
      throw new ForbiddenError('This plugin asks for a privileged container.', {
        title: 'Refused: privileged container',
        description:
          'Karo never runs privileged containers. This plugin cannot be installed on any plan.',
      });
    }

    const declared = plugin.permissions ?? [];
    const granted = new Set(body.grantedPermissions);
    const missing = declared.filter((permission) => !granted.has(permission.key));
    if (missing.length > 0) {
      throw new ValidationError(
        'Every permission this plugin declares must be granted before it installs.',
        missing.map((permission) => ({
          path: 'grantedPermissions',
          message: `"${permission.label}" was not granted.`,
          code: 'permission_not_granted',
        })),
        {
          title: 'Permissions not accepted',
          description:
            'A plugin runs with everything it declares or not at all. Accept the full list, or cancel the install.',
        },
      );
    }

    const [existing] = await db
      .select({ id: installedPlugins.id })
      .from(installedPlugins)
      .where(
        and(
          eq(installedPlugins.teamId, team.id),
          eq(installedPlugins.pluginId, plugin.id),
          isNull(installedPlugins.projectId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new ConflictError(`${plugin.name} is already installed.`, {
        title: 'Already installed',
        description: 'Open it from the marketplace to change its configuration or remove it.',
      });
    }

    await assertPluginQuota(team.id, plan);

    const schema = new Map((plugin.configSchema ?? []).map((field) => [field.key, field]));
    const config: Record<string, string> = {};
    const secretBag: Record<string, string> = {};

    for (const field of schema.values()) {
      if (field.secret) {
        const value = body.secrets[field.key];
        if (value) secretBag[field.key] = value;
      } else {
        const value = body.config[field.key] ?? field.default ?? '';
        if (value) config[field.key] = value;
      }
    }

    const missingRequired = (plugin.configSchema ?? [])
      .filter((field) => field.required)
      .filter((field) => (field.secret ? !secretBag[field.key] : !config[field.key]));
    if (missingRequired.length > 0) {
      throw new ValidationError(
        'Fill in the required configuration before installing.',
        missingRequired.map((field) => ({
          path: `config.${field.key}`,
          message: `${field.label} is required.`,
          code: 'required',
        })),
        {
          title: 'Configuration incomplete',
          description: `${plugin.name} cannot start without these values. Fill them in and install again.`,
        },
      );
    }

    const id = newId(ID_PREFIX.installedPlugin);
    const [installation] = await db
      .insert(installedPlugins)
      .values({
        id,
        pluginId: plugin.id,
        teamId: team.id,
        projectId: null,
        installedById: user.id,
        version: plugin.version,
        config,
        secretsCiphertext: buildSecrets(secretBag),
        grantedPermissions: declared.map((permission) => permission.key),
      })
      .returning();

    if (!installation) throw new ConflictError('The plugin could not be installed. Try again.');

    const health = evaluatePluginHealth(plugin, installation, plan);
    const [withHealth] = await db
      .update(installedPlugins)
      .set({
        healthStatus: health.status,
        healthMessage: health.message,
        lastHealthCheckAt: new Date(),
      })
      .where(eq(installedPlugins.id, installation.id))
      .returning();

    await db
      .update(plugins)
      .set({ installCount: sql`${plugins.installCount} + 1` })
      .where(eq(plugins.id, plugin.id));

    setAudit({
      teamId: team.id,
      resourceId: plugin.id,
      summary: `Plugin "${plugin.name}" installed`,
      metadata: {
        version: plugin.version,
        grantedPermissions: declared.map((permission) => permission.key),
        configKeys: Object.keys(config),
        secretKeys: Object.keys(secretBag),
      },
    });

    return created({
      installation: toInstalledPluginView(
        withHealth ?? installation,
        plugin.version,
        user.name || user.email,
      ),
      health,
    });
  },
);
