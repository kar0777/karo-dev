export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';

import { countSeats, listMembers, listPendingInvitations } from '@/lib/account/team';
import { getActiveTeam, requireUser } from '@/lib/auth/guards';
import { env } from '@/lib/env';
import { assignableRoles, can } from '@/lib/rbac/permissions';
import { loadBillingContext } from '@/lib/usage/metering';
import { InvitationsPanel } from '@/components/settings/invitations-panel';
import { MembersTable } from '@/components/settings/members-table';
import { RoleReference } from '@/components/settings/role-reference';
import { TeamSettingsForm } from '@/components/settings/team-settings-form';
import { PageHeader } from '@/components/ui/page-header';

export const metadata: Metadata = {
  title: 'Team',
  description: 'Members, roles, invitations and team settings.',
};

export default async function TeamPage() {
  const { user } = await requireUser();
  const { team, role } = await getActiveTeam(user.id);
  const billing = await loadBillingContext(team.id);

  const [members, invitations, seats] = await Promise.all([
    listMembers(team.id, team.ownerId),
    can(role, 'team.invite') ? listPendingInvitations(team.id) : Promise.resolve([]),
    countSeats(team.id, billing.plan.maxTeamMembers),
  ]);

  const invitableRoles = assignableRoles(role).filter((value) => value !== 'owner');

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title={team.name}
        description={
          team.isPersonal
            ? 'Your personal workspace. Invite people here to share its projects, sandboxes and quota.'
            : 'Everyone who can reach this workspace, what their role allows, and who is still waiting to accept.'
        }
        breadcrumbs={[{ label: 'Karo', href: '/app' }, { label: 'Team' }]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <MembersTable
            members={members}
            currentUserId={user.id}
            actorRole={role}
            teamName={team.name}
          />

          <InvitationsPanel
            invitations={invitations}
            seats={seats}
            planName={billing.plan.name}
            canInvite={can(role, 'team.invite')}
            invitableRoles={invitableRoles}
          />
        </div>

        <div className="min-w-0 space-y-5">
          <TeamSettingsForm
            initial={{ name: team.name, slug: team.slug, avatarColor: team.avatarColor }}
            appUrl={env.APP_URL.replace(/\/+$/, '')}
            canEdit={can(role, 'team.update')}
          />

          <RoleReference currentRole={role} />
        </div>
      </div>
    </div>
  );
}
