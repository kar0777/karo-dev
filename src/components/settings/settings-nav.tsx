import Link from 'next/link';
import {
  Bell,
  Bot,
  Cpu,
  KeyRound,
  Server,
  ShieldCheck,
  TriangleAlert,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Section switcher.
 *
 * Real links rather than local state: each section is its own URL, so it can be
 * bookmarked, deep-linked from an error message ("check Settings → Servers"),
 * opened in a new tab, and reached with the browser's back button.
 */

export const SETTINGS_SECTIONS = [
  'profile',
  'security',
  'agent',
  'models',
  'servers',
  'notifications',
  'danger',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SECTION_META: Record<
  SettingsSection,
  { label: string; description: string; icon: LucideIcon }
> = {
  profile: {
    label: 'Profile',
    description: 'Your name, email address, avatar colour, language and theme.',
    icon: User,
  },
  security: {
    label: 'Security',
    description: 'Password and the devices currently signed in to this account.',
    icon: ShieldCheck,
  },
  agent: {
    label: 'Agent defaults',
    description: 'What a new project inherits: model, mode, shell and permissions.',
    icon: Bot,
  },
  models: {
    label: 'Model & API',
    description: 'Which provider runs your models, on whose key, and what your plan unlocks.',
    icon: Cpu,
  },
  servers: {
    label: 'Servers',
    description: 'Run sandboxes on hardware you own, over an outbound-only connection.',
    icon: Server,
  },
  notifications: {
    label: 'Notifications',
    description: 'Usage alerts, run completion and billing events.',
    icon: Bell,
  },
  danger: {
    label: 'Danger zone',
    description: 'Permanently delete this account and everything it owns.',
    icon: TriangleAlert,
  },
};

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function SettingsNav({ active }: { active: SettingsSection }) {
  return (
    <nav
      aria-label="Settings sections"
      className="karo-no-scrollbar -mx-1 overflow-x-auto px-1 lg:overflow-visible"
    >
      <ul className="flex gap-1 lg:flex-col">
        {SETTINGS_SECTIONS.map((section) => {
          const meta = SECTION_META[section];
          const Icon = meta.icon;
          const isActive = section === active;
          return (
            <li key={section} className="shrink-0">
              <Link
                href={`/app/settings?section=${section}`}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-colors duration-150 ease-[var(--k-ease)] lg:w-full',
                  isActive
                    ? 'bg-surface-2 font-medium text-fg'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                  section === 'danger' && !isActive && 'text-danger/80 hover:text-danger',
                  section === 'danger' && isActive && 'text-danger',
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                {meta.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Also used as the api-keys / team page link target for the BYOK gate. */
export const API_KEYS_LINK = { href: '/app/api-keys', icon: KeyRound } as const;
