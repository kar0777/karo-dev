import {
  Boxes,
  Coins,
  Cpu,
  Gauge,
  LayoutGrid,
  Plug,
  ReceiptText,
  ScrollText,
  Settings2,
  SquareTerminal,
  TicketPercent,
  ShieldAlert,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The admin console's own navigation. It is deliberately flat: an operator
 * chasing an incident should never have to remember which submenu the audit log
 * lives under.
 */

export type AdminNavItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export type AdminNavGroup = {
  label: string;
  items: AdminNavItem[];
};

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: 'Business',
    items: [
      {
        href: '/admin',
        label: 'Overview',
        description: 'Revenue, margin, growth and open incidents',
        icon: LayoutGrid,
      },
      {
        href: '/admin/usage',
        label: 'Usage',
        description: 'Platform-wide tokens and compute',
        icon: Gauge,
      },
      {
        href: '/admin/costs',
        label: 'Costs',
        description: 'Unit economics and break-even',
        icon: Coins,
      },
      {
        href: '/admin/coupons',
        label: 'Coupons',
        description: 'Promo codes: bonus credit and plan discounts',
        icon: TicketPercent,
      },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      {
        href: '/admin/plans',
        label: 'Plans',
        description: 'Every quota and capability, editable',
        icon: ReceiptText,
      },
      {
        href: '/admin/models',
        label: 'Models',
        description: 'Model catalogue and price history',
        icon: Cpu,
      },
      {
        href: '/admin/providers',
        label: 'Providers',
        description: 'Upstream connections and health',
        icon: Plug,
      },
      {
        href: '/admin/cli-tools',
        label: 'CLI agents',
        description: 'Installable terminal coding agents',
        icon: SquareTerminal,
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/admin/users',
        label: 'Users',
        description: 'Accounts, roles and suspensions',
        icon: Users,
      },
      {
        href: '/admin/sandboxes',
        label: 'Sandboxes',
        description: 'The whole fleet, across all teams',
        icon: Boxes,
      },
      {
        href: '/admin/incidents',
        label: 'Incidents',
        description: 'Status, severity and timeline',
        icon: ShieldAlert,
      },
      {
        href: '/admin/audit',
        label: 'Audit',
        description: 'Every privileged action, searchable',
        icon: ScrollText,
      },
      {
        href: '/admin/settings',
        label: 'Settings',
        description: 'Every tunable number in the product',
        icon: Settings2,
      },
    ],
  },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((group) => group.items);

/** Longest-prefix match so `/admin/users?q=x` still highlights Users. */
export function activeAdminHref(pathname: string): string {
  let best = '/admin';
  for (const item of ADMIN_NAV_ITEMS) {
    if (item.href === '/admin') continue;
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (item.href.length > best.length) best = item.href;
    }
  }
  return best;
}
