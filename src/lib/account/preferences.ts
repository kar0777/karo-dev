import {
  AGENT_PERMISSION_META,
  DEFAULT_AGENT_PERMISSIONS,
  type AgentPermissionKey,
  type AgentPermissions,
} from '@/lib/agent/policy';
import type { AgentMode, ShellKind } from '@/lib/db/schema';
import { normalizeLocale, type Locale } from '@/lib/i18n';

/**
 * Per-user preferences that the product needs but the `users` table has no
 * dedicated column for: avatar colour, notification switches and the personal
 * agent defaults a new project inherits.
 *
 * They live inside the existing `users.onboarding_state` jsonb under a single
 * `preferences` key. The schema is frozen for this slice, and inventing a
 * parallel table the migration does not create would be worse than one
 * namespaced object: every read merges over the defaults below, so a row
 * written before a key existed keeps working, and every write is a merge, so
 * two features editing different sections never clobber each other.
 */

/* ------------------------------------------------------------------ *
 *  Avatar colours
 * ------------------------------------------------------------------ */

export const AVATAR_COLORS = [
  'primary',
  'ember',
  'info',
  'success',
  'warning',
  'danger',
  'chart-4',
  'chart-5',
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

export const DEFAULT_AVATAR_COLOR: AvatarColor = 'primary';

/** Human names — a colour picker reads better than `chart-4`. */
export const AVATAR_COLOR_LABELS: Record<AvatarColor, string> = {
  primary: 'Jade',
  ember: 'Ember',
  info: 'Azure',
  success: 'Fern',
  warning: 'Amber',
  danger: 'Rust',
  'chart-4': 'Orchid',
  'chart-5': 'Moss',
};

/**
 * Written out literally because Tailwind v4 scans source text — a computed
 * `bg-${token}` would never make it into the generated stylesheet.
 */
export const AVATAR_COLOR_CLASSES: Record<AvatarColor, { swatch: string; surface: string }> = {
  primary: { swatch: 'bg-primary', surface: 'bg-primary-soft text-primary-soft-fg' },
  ember: { swatch: 'bg-ember', surface: 'bg-ember-soft text-ember-soft-fg' },
  info: { swatch: 'bg-info', surface: 'bg-info-soft text-info-soft-fg' },
  success: { swatch: 'bg-success', surface: 'bg-success-soft text-success-soft-fg' },
  warning: { swatch: 'bg-warning', surface: 'bg-warning-soft text-warning-soft-fg' },
  danger: { swatch: 'bg-danger', surface: 'bg-danger-soft text-danger-soft-fg' },
  'chart-4': { swatch: 'bg-chart-4', surface: 'bg-chart-4/18 text-chart-4' },
  'chart-5': { swatch: 'bg-chart-5', surface: 'bg-chart-5/18 text-chart-5' },
};

export function isAvatarColor(value: unknown): value is AvatarColor {
  return typeof value === 'string' && (AVATAR_COLORS as readonly string[]).includes(value);
}

export function normalizeAvatarColor(value: unknown): AvatarColor {
  return isAvatarColor(value) ? value : DEFAULT_AVATAR_COLOR;
}

/* ------------------------------------------------------------------ *
 *  Notifications
 * ------------------------------------------------------------------ */

export type NotificationPreferences = {
  usageAlerts: boolean;
  runCompletion: boolean;
  billingEvents: boolean;
  securityAlerts: boolean;
  weeklyDigest: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  usageAlerts: true,
  runCompletion: true,
  billingEvents: true,
  securityAlerts: true,
  weeklyDigest: false,
};

export type NotificationKey = keyof NotificationPreferences;

export const NOTIFICATION_META: Record<
  NotificationKey,
  { label: string; description: string; locked?: boolean }
> = {
  usageAlerts: {
    label: 'Usage alerts',
    description:
      'Tells you when weighted-token or compute usage crosses your team’s alert threshold, before a run is refused.',
  },
  runCompletion: {
    label: 'Run completion',
    description:
      'Notifies you when a long agent run finishes, stops for approval, or fails while you are on another page.',
  },
  billingEvents: {
    label: 'Billing events',
    description:
      'Invoices, successful and failed top-ups, plan changes and subscription problems.',
  },
  securityAlerts: {
    label: 'Security alerts',
    description:
      'New sign-ins, password changes, API keys added and servers registered. Always on — these cannot be turned off.',
    locked: true,
  },
  weeklyDigest: {
    label: 'Weekly digest',
    description:
      'A Monday summary of spend, top models and the projects your agent worked on last week.',
  },
};

/* ------------------------------------------------------------------ *
 *  Agent defaults
 * ------------------------------------------------------------------ */

export type AgentDefaults = {
  /** `null` means "use whatever the catalogue marks as default". */
  modelId: string | null;
  agentMode: AgentMode;
  shell: ShellKind;
  permissions: AgentPermissions;
};

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  modelId: null,
  agentMode: 'build',
  shell: 'bash',
  permissions: { ...DEFAULT_AGENT_PERMISSIONS },
};

export const AGENT_PERMISSION_KEYS = Object.keys(
  DEFAULT_AGENT_PERMISSIONS,
) as AgentPermissionKey[];

export type PermissionRisk = 'low' | 'medium' | 'high';

export const RISK_ORDER: readonly PermissionRisk[] = ['high', 'medium', 'low'];

export const RISK_META: Record<
  PermissionRisk,
  { label: string; badge: 'danger' | 'warning' | 'neutral'; blurb: string }
> = {
  high: {
    label: 'High risk',
    badge: 'danger',
    blurb: 'Can destroy work or reach outside the sandbox. Grant deliberately.',
  },
  medium: {
    label: 'Medium risk',
    badge: 'warning',
    blurb: 'Changes the machine or the network, but stays inside the sandbox.',
  },
  low: {
    label: 'Low risk',
    badge: 'neutral',
    blurb: 'Reads or observes. Safe to leave on for every project.',
  },
};

/** Permission keys bucketed by risk, in the order the settings UI renders them. */
export function permissionsByRisk(): Array<{
  risk: PermissionRisk;
  keys: AgentPermissionKey[];
}> {
  return RISK_ORDER.map((risk) => ({
    risk,
    keys: AGENT_PERMISSION_KEYS.filter((key) => AGENT_PERMISSION_META[key].risk === risk),
  })).filter((group) => group.keys.length > 0);
}

/* ------------------------------------------------------------------ *
 *  The bag
 * ------------------------------------------------------------------ */

export type UserPreferences = {
  avatarColor: AvatarColor;
  notifications: NotificationPreferences;
  agentDefaults: AgentDefaults;
};

export const PREFERENCES_KEY = 'preferences';

export function defaultPreferences(): UserPreferences {
  return {
    avatarColor: DEFAULT_AVATAR_COLOR,
    notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    agentDefaults: {
      ...DEFAULT_AGENT_DEFAULTS,
      permissions: { ...DEFAULT_AGENT_PERMISSIONS },
    },
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const AGENT_MODES: readonly AgentMode[] = ['ask', 'plan', 'build', 'auto'];
const SHELLS: readonly ShellKind[] = ['bash', 'sh', 'powershell', 'cmd'];

function agentMode(value: unknown, fallback: AgentMode): AgentMode {
  return typeof value === 'string' && (AGENT_MODES as readonly string[]).includes(value)
    ? (value as AgentMode)
    : fallback;
}

function shell(value: unknown, fallback: ShellKind): ShellKind {
  return typeof value === 'string' && (SHELLS as readonly string[]).includes(value)
    ? (value as ShellKind)
    : fallback;
}

/** Reads the preference bag out of `users.onboarding_state`, merged over defaults. */
export function readPreferences(
  onboardingState: Record<string, unknown> | null | undefined,
): UserPreferences {
  const stored = record(record(onboardingState)[PREFERENCES_KEY]);
  const defaults = defaultPreferences();

  const notifications = record(stored['notifications']);
  const agent = record(stored['agentDefaults']);
  const permissions = record(agent['permissions']);

  const resolvedPermissions = { ...DEFAULT_AGENT_PERMISSIONS };
  for (const key of AGENT_PERMISSION_KEYS) {
    resolvedPermissions[key] = bool(permissions[key], DEFAULT_AGENT_PERMISSIONS[key]);
  }

  return {
    avatarColor: normalizeAvatarColor(stored['avatarColor']),
    notifications: {
      usageAlerts: bool(notifications['usageAlerts'], defaults.notifications.usageAlerts),
      runCompletion: bool(notifications['runCompletion'], defaults.notifications.runCompletion),
      billingEvents: bool(notifications['billingEvents'], defaults.notifications.billingEvents),
      // Locked on by design — a compromised account must still get told.
      securityAlerts: true,
      weeklyDigest: bool(notifications['weeklyDigest'], defaults.notifications.weeklyDigest),
    },
    agentDefaults: {
      modelId: typeof agent['modelId'] === 'string' ? agent['modelId'] : null,
      agentMode: agentMode(agent['agentMode'], defaults.agentDefaults.agentMode),
      shell: shell(agent['shell'], defaults.agentDefaults.shell),
      permissions: resolvedPermissions,
    },
  };
}

export type PreferencesPatch = {
  avatarColor?: AvatarColor;
  notifications?: Partial<NotificationPreferences>;
  agentDefaults?: Partial<Omit<AgentDefaults, 'permissions'>> & {
    permissions?: Partial<AgentPermissions>;
  };
};

/**
 * Non-destructive merge back into the whole `onboarding_state` object, so the
 * onboarding tour's own keys survive a settings save and vice versa.
 */
export function mergePreferences(
  onboardingState: Record<string, unknown> | null | undefined,
  patch: PreferencesPatch,
): Record<string, unknown> {
  const base = record(onboardingState);
  const current = readPreferences(base);

  const next: UserPreferences = {
    avatarColor: patch.avatarColor ?? current.avatarColor,
    notifications: {
      ...current.notifications,
      ...patch.notifications,
      securityAlerts: true,
    },
    agentDefaults: {
      modelId:
        patch.agentDefaults && 'modelId' in patch.agentDefaults
          ? (patch.agentDefaults.modelId ?? null)
          : current.agentDefaults.modelId,
      agentMode: patch.agentDefaults?.agentMode ?? current.agentDefaults.agentMode,
      shell: patch.agentDefaults?.shell ?? current.agentDefaults.shell,
      permissions: {
        ...current.agentDefaults.permissions,
        ...patch.agentDefaults?.permissions,
      },
    },
  };

  return { ...base, [PREFERENCES_KEY]: next };
}

/* ------------------------------------------------------------------ *
 *  Locale & theme
 * ------------------------------------------------------------------ */

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

export function normalizeTheme(value: unknown): ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : 'dark';
}

export function normalizeUserLocale(value: unknown): Locale {
  return normalizeLocale(value);
}
