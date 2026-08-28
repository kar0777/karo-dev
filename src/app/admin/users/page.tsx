import { UsersTable } from '@/components/admin/users-table';
import { PageHeader } from '@/components/ui/page-header';
import { Stat, StatGrid } from '@/components/ui/stat';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { formatCompactNumber } from '@/lib/utils';

import {
  countActiveUsers,
  listAdminUsers,
  loadUserStats,
  type UserRoleFilter,
  type UserStatusFilter,
} from '../_data/users';

export const dynamic = 'force-dynamic';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The stat cutoffs are per-request by design, but the clock belongs in a helper
 * rather than in the component body — reading it inline makes render impure. One
 * read serves both windows so the two figures always describe the same instant.
 */
function statCutoffs(): { thirtyDaysAgo: Date; oneDayAgo: Date } {
  const now = Date.now();
  return {
    thirtyDaysAgo: new Date(now - 30 * 24 * 60 * 60 * 1000),
    oneDayAgo: new Date(now - 24 * 60 * 60 * 1000),
  };
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user: admin } = await requirePlatformAdmin();
  const params = await searchParams;

  const q = firstParam(params.q) ?? '';
  const status = (firstParam(params.status) ?? 'all') as UserStatusFilter;
  const role = (firstParam(params.role) ?? 'all') as UserRoleFilter;
  const page = Math.max(1, Number.parseInt(firstParam(params.page) ?? '1', 10) || 1);

  const { thirtyDaysAgo, oneDayAgo } = statCutoffs();

  const [list, stats, activeToday] = await Promise.all([
    listAdminUsers({ q, page, status, role }),
    loadUserStats(thirtyDaysAgo),
    countActiveUsers(oneDayAgo),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Users"
        description="Every account on the platform. Open a row for teams, spend, recent runs and the account's audit trail."
      />

      <StatGrid columns={4}>
        <Stat label="Accounts" value={formatCompactNumber(stats.total)} />
        <Stat
          label="New in 30 days"
          value={formatCompactNumber(stats.recent)}
          tone="primary"
          caption="Signed up in the last 30 days"
        />
        <Stat
          label="Seen in 24h"
          value={formatCompactNumber(activeToday)}
          caption="Had an authenticated request"
        />
        <Stat
          label="Suspended"
          value={formatCompactNumber(stats.suspended)}
          caption={`${stats.admins} platform admin${stats.admins === 1 ? '' : 's'}`}
        />
      </StatGrid>

      <UsersTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        query={{ q, status, role }}
        currentAdminId={admin.id}
      />
    </div>
  );
}
