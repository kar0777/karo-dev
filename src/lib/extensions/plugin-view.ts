import 'server-only';

import type { installedPlugins, plugins, Plan } from '@/lib/db/schema';
import { isNewerVersion, secretKeyNames, tierAtLeast } from '@/lib/extensions/service';
import type { InstalledPluginView, PluginView } from '@/lib/extensions/types';

export function toInstalledPluginView(
  installation: typeof installedPlugins.$inferSelect,
  catalogueVersion: string,
  installedByName: string,
): InstalledPluginView {
  return {
    id: installation.id,
    pluginId: installation.pluginId,
    version: installation.version,
    isEnabled: installation.isEnabled,
    config: installation.config ?? {},
    secretKeys: secretKeyNames(installation.secretsCiphertext),
    grantedPermissions: installation.grantedPermissions ?? [],
    healthStatus: installation.healthStatus,
    healthMessage: installation.healthMessage,
    lastHealthCheckAt: installation.lastHealthCheckAt?.toISOString() ?? null,
    installedAt: installation.createdAt.toISOString(),
    installedByName,
    updateAvailable: isNewerVersion(catalogueVersion, installation.version),
  };
}

export function toPluginView(
  plugin: typeof plugins.$inferSelect,
  plan: Plan,
  installed: InstalledPluginView | null,
): PluginView {
  return {
    id: plugin.id,
    key: plugin.key,
    name: plugin.name,
    description: plugin.description,
    longDescription: plugin.longDescription,
    version: plugin.version,
    publisher: plugin.publisher,
    category: plugin.category,
    icon: plugin.icon,
    permissions: plugin.permissions ?? [],
    configSchema: plugin.configSchema ?? [],
    providedTools: plugin.providedTools ?? [],
    providedCommands: plugin.providedCommands ?? [],
    minPlanTier: plugin.minPlanTier,
    requiresPrivileged: plugin.requiresPrivileged,
    isVerified: plugin.isVerified,
    installCount: plugin.installCount,
    homepageUrl: plugin.homepageUrl,
    planAllows: tierAtLeast(plan.tier, plugin.minPlanTier),
    installed,
  };
}

export type PluginHealthResult = {
  ok: boolean;
  status: 'connected' | 'error';
  message: string;
  missingConfig: string[];
};

/**
 * Health for a plugin means "would a run that used this plugin work right now".
 *
 * There is no external service to ping — a plugin is a runtime installed into
 * the sandbox — so the check is over the things that actually break a run:
 * required configuration that is not set, a plan downgrade that revoked the
 * plugin, a permission the user never granted, and the privileged-container
 * rule that no catalogue plugin is allowed to need.
 */
export function evaluatePluginHealth(
  plugin: typeof plugins.$inferSelect,
  installation: typeof installedPlugins.$inferSelect,
  plan: Plan,
): PluginHealthResult {
  const secrets = new Set(secretKeyNames(installation.secretsCiphertext));
  const config = installation.config ?? {};

  const missingConfig = (plugin.configSchema ?? [])
    .filter((field) => field.required)
    .filter((field) =>
      field.secret ? !secrets.has(field.key) : !(config[field.key] ?? '').trim(),
    )
    .map((field) => field.label);

  if (!tierAtLeast(plan.tier, plugin.minPlanTier)) {
    return {
      ok: false,
      status: 'error',
      message: `${plugin.name} needs a higher plan than ${plan.name}. Upgrade, or uninstall it to stop the agent from trying to use it.`,
      missingConfig,
    };
  }

  if (plugin.requiresPrivileged) {
    return {
      ok: false,
      status: 'error',
      message: `${plugin.name} asks for a privileged container, which Karo never grants. Remove it — it cannot run.`,
      missingConfig,
    };
  }

  if (missingConfig.length > 0) {
    return {
      ok: false,
      status: 'error',
      message: `Configuration incomplete: ${missingConfig.join(', ')}. Fill these in and check again.`,
      missingConfig,
    };
  }

  const granted = new Set(installation.grantedPermissions ?? []);
  const ungranted = (plugin.permissions ?? []).filter((p) => !granted.has(p.key));
  if (ungranted.length > 0) {
    return {
      ok: false,
      status: 'error',
      message: `${ungranted.length} permission${ungranted.length === 1 ? '' : 's'} added since you installed this plugin. Re-accept them in the plugin detail view.`,
      missingConfig,
    };
  }

  if (!installation.isEnabled) {
    return {
      ok: true,
      status: 'connected',
      message: 'Configured correctly, but disabled — the agent will not load it.',
      missingConfig,
    };
  }

  return {
    ok: true,
    status: 'connected',
    message: `Ready. ${plugin.providedTools?.length ?? 0} tools available to the agent.`,
    missingConfig,
  };
}
