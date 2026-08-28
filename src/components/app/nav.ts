import {
  Bot,
  Boxes,
  CreditCard,
  FolderGit2,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Plug,
  Puzzle,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import type * as React from 'react';

import type { LooseTranslationKey, Translator } from '@/lib/i18n';

/**
 * The product navigation, in one place.
 *
 * The sidebar, the command palette and the top-bar breadcrumbs all read from
 * this table, so a route is added — with its icon, its group and the sentence
 * that explains it — exactly once.
 *
 * `label` stays English and stays required. It is the fallback, and it keeps
 * every existing reader of this table working untouched: only the callers that
 * have a translator to hand need to know about `labelKey`, via `localizeNav`.
 */

export type NavIcon = React.ComponentType<{ className?: string }>;

export type NavItem = {
  href: string;
  label: string;
  /** Dictionary key for `label`. Absent means the English above is the only copy. */
  labelKey?: LooseTranslationKey;
  icon: NavIcon;
  /** One line of context. Shown in the command palette and as a tooltip. */
  hint: string;
  /** `/app` is a prefix of every other route, so it only matches exactly. */
  exact?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  labelKey?: LooseTranslationKey;
  items: readonly NavItem[];
};

export const APP_NAV: readonly NavGroup[] = [
  {
    id: 'build',
    label: 'Build',
    labelKey: 'nav.groupBuild',
    items: [
      {
        href: '/app',
        label: 'Overview',
        labelKey: 'nav.overview',
        icon: LayoutDashboard,
        hint: 'Usage, recent projects and what the agent has been doing',
        exact: true,
      },
      {
        href: '/app/projects',
        label: 'Projects',
        labelKey: 'nav.projects',
        icon: FolderGit2,
        hint: 'Every workspace you and your team have created',
      },
      {
        href: '/app/agents',
        label: 'Agents',
        labelKey: 'nav.agents',
        icon: Bot,
        hint: 'Agent runs, their tool calls and what each one cost',
      },
      {
        href: '/app/sandboxes',
        label: 'Sandboxes',
        labelKey: 'nav.sandboxes',
        icon: Boxes,
        hint: 'The Linux machines your projects run on',
      },
    ],
  },
  {
    id: 'extend',
    label: 'Extend',
    labelKey: 'nav.groupExtend',
    items: [
      {
        href: '/app/mcp',
        // No `labelKey` on purpose. The dictionary's `nav.mcp` is "MCP servers",
        // which is right for the marketing nav and too long for a rail that
        // collapses to icons — and "MCP" is the same acronym in both locales, so
        // there is nothing here to translate. Wiring the key would have quietly
        // renamed this item in English.
        label: 'MCP',
        icon: Plug,
        hint: 'Connect Model Context Protocol servers and their tools',
      },
      {
        href: '/app/skills',
        label: 'Skills',
        labelKey: 'nav.skills',
        icon: Sparkles,
        hint: 'Reusable instructions that teach the agent a workflow',
      },
      {
        href: '/app/plugins',
        label: 'Plugins',
        labelKey: 'nav.plugins',
        icon: Puzzle,
        hint: 'Packaged integrations that add tools to the sandbox',
      },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    labelKey: 'nav.groupAccount',
    items: [
      {
        href: '/app/usage',
        label: 'Usage',
        labelKey: 'nav.usage',
        icon: Gauge,
        hint: 'Weighted tokens, compute hours and cost over time',
      },
      {
        href: '/app/billing',
        label: 'Billing',
        labelKey: 'nav.billing',
        icon: CreditCard,
        hint: 'Plan, balance, invoices and payment method',
      },
      {
        href: '/app/api-keys',
        label: 'API keys',
        labelKey: 'nav.apiKeys',
        icon: KeyRound,
        hint: 'Bring your own provider keys and register your own servers',
      },
      {
        href: '/app/team',
        label: 'Team',
        labelKey: 'nav.team',
        icon: Users,
        hint: 'Members, roles and pending invitations',
      },
      {
        href: '/app/settings',
        label: 'Settings',
        labelKey: 'nav.settings',
        icon: Settings,
        hint: 'Profile, appearance, notifications and security',
      },
    ],
  },
];

export const ALL_NAV_ITEMS: readonly NavItem[] = APP_NAV.flatMap((group) => group.items);

/**
 * The same table with `label` resolved through a translator.
 *
 * Returned as new objects rather than mutated in place: `APP_NAV` is a module
 * constant shared by the sidebar, the command palette and the breadcrumbs, and
 * one of those rendering in a different locale must not change what the others
 * see. Items with no `labelKey` keep their English label, and `t()` falls back
 * to English for a key the dictionary is missing — so this degrades to exactly
 * the previous behaviour rather than to blank labels.
 */
export function localizeNav(t: Translator): readonly NavGroup[] {
  return APP_NAV.map((group) => ({
    ...group,
    label: group.labelKey ? t(group.labelKey) : group.label,
    items: group.items.map((item) => ({
      ...item,
      label: item.labelKey ? t(item.labelKey) : item.label,
    })),
  }));
}

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/* ------------------------------------------------------------------ *
 *  Breadcrumbs
 * ------------------------------------------------------------------ */

/**
 * Segment labels the URL cannot supply on its own. Anything absent falls back
 * to a title-cased segment, and record ids (`prj_01j…`) are shortened rather
 * than printed in full — the page header underneath shows the real name.
 */
const SEGMENT_LABELS: Record<string, string> = {
  app: 'Karo',
  projects: 'Projects',
  agents: 'Agents',
  sandboxes: 'Sandboxes',
  mcp: 'MCP',
  skills: 'Skills',
  plugins: 'Plugins',
  usage: 'Usage',
  billing: 'Billing',
  'api-keys': 'API keys',
  team: 'Team',
  settings: 'Settings',
  onboarding: 'Get started',
  new: 'New',
  conversations: 'Chat',
};

/**
 * Dictionary keys for the segments that have one.
 *
 * Only exact equivalents are listed. `mcp` is an acronym that does not change
 * language; `onboarding` and `conversations` have no matching key, and inventing
 * one to reuse marketing copy ("Get started" is the sign-up CTA) would put the
 * wrong words in a breadcrumb. Anything absent keeps the English above, which is
 * what this function did before it could translate at all.
 */
const SEGMENT_LABEL_KEYS: Record<string, LooseTranslationKey> = {
  app: 'common.appName',
  projects: 'nav.projects',
  agents: 'nav.agents',
  sandboxes: 'nav.sandboxes',
  skills: 'nav.skills',
  plugins: 'nav.plugins',
  usage: 'nav.usage',
  billing: 'nav.billing',
  'api-keys': 'nav.apiKeys',
  team: 'nav.team',
  settings: 'nav.settings',
  new: 'common.new',
};

const ID_SEGMENT = /^[a-z0-9]{2,5}_[0-9a-z]{8,}$/;

export type Crumb = { label: string; href?: string };

/**
 * `t` is optional so the many callers that have no translator — and the tests —
 * keep working unchanged, producing exactly the English they produced before.
 */
export function buildBreadcrumbs(pathname: string, t?: Translator): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const rootLabel = t ? t('common.appName') : 'Karo';
  if (segments.length === 0) return [{ label: rootLabel }];

  const crumbs: Crumb[] = [];
  let href = '';

  for (const [index, segment] of segments.entries()) {
    href += `/${segment}`;
    const last = index === segments.length - 1;

    const key = t ? SEGMENT_LABEL_KEYS[segment] : undefined;
    let label = key && t ? t(key) : SEGMENT_LABELS[segment];
    if (!label) {
      label = ID_SEGMENT.test(segment)
        ? `${segment.slice(0, segment.indexOf('_') + 5)}…`
        : segment.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    }

    // The first segment is always `app`, which is the Overview route.
    crumbs.push({ label, href: last ? undefined : index === 0 ? '/app' : href });
  }

  return crumbs;
}
