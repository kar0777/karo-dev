'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Crown, UserMinus } from 'lucide-react';

import { AVATAR_COLOR_CLASSES } from '@/lib/account/preferences';
import type { MemberView } from '@/lib/account/team';
import { apiFetch, describeError } from '@/lib/client/api';
import type { TeamRole } from '@/lib/db/schema';
import { ROLE_LABELS, assignableRoles, can, outranks } from '@/lib/rbac/permissions';
import { cn, formatDate, initials } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '@/components/ui';

export type MembersTableProps = {
  members: MemberView[];
  currentUserId: string;
  actorRole: TeamRole;
  teamName: string;
};

export function MembersTable({
  members,
  currentUserId,
  actorRole,
  teamName,
}: MembersTableProps) {
  const grantable = React.useMemo(
    () => assignableRoles(actorRole).filter((role) => role !== 'owner'),
    [actorRole],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Everyone with access to {teamName}. A role decides what they can do — projects,
          sandboxes, billing and the audit log are all gated by it.
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        <TooltipProvider delayDuration={200}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="hidden md:table-cell">Joined</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  actorRole={actorRole}
                  currentUserId={currentUserId}
                  grantable={grantable}
                  teamName={teamName}
                />
              ))}
            </TableBody>
          </Table>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

function MemberRow({
  member,
  actorRole,
  currentUserId,
  grantable,
  teamName,
}: {
  member: MemberView;
  actorRole: TeamRole;
  currentUserId: string;
  grantable: TeamRole[];
  teamName: string;
}) {
  const router = useRouter();
  const [role, setRole] = React.useState<TeamRole>(member.role);
  const [savingRole, setSavingRole] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const isSelf = member.userId === currentUserId;

  const roleBlockedReason = member.isOwner
    ? 'The owner keeps full control of the team and cannot be demoted.'
    : !can(actorRole, 'team.role.update')
      ? 'Only the team owner can change roles.'
      : !outranks(actorRole, member.role)
        ? `You can only change members below ${ROLE_LABELS[actorRole]}.`
        : null;

  const removeBlockedReason = member.isOwner
    ? 'The owner cannot be removed. Transfer ownership first.'
    : isSelf
      ? null
      : !can(actorRole, 'team.member.remove')
        ? 'Your role cannot remove members.'
        : !outranks(actorRole, member.role)
          ? `You can only remove members below ${ROLE_LABELS[actorRole]}.`
          : null;

  async function changeRole(next: TeamRole) {
    const previous = role;
    setRole(next);
    setSavingRole(true);
    try {
      await apiFetch(`/api/team/members/${member.userId}`, {
        method: 'PATCH',
        json: { role: next },
      });
      toast.success(`${member.name} is now ${ROLE_LABELS[next]}`);
      router.refresh();
    } catch (error) {
      setRole(previous);
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setSavingRole(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      await apiFetch(`/api/team/members/${member.userId}`, { method: 'DELETE' });
      setConfirmOpen(false);
      if (isSelf) {
        toast.success(`You left ${teamName}`);
        window.location.assign('/app');
        return;
      }
      toast.success(`${member.name} removed`, {
        description: 'Their sessions keep working, but this team is no longer visible to them.',
      });
      router.refresh();
    } catch (error) {
      const described = describeError(error);
      toast.error(described.title, { description: described.message });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold',
              AVATAR_COLOR_CLASSES[member.avatarColor].surface,
            )}
          >
            {initials(member.name)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-fg">{member.name}</span>
              {member.isOwner ? (
                <Badge size="sm" variant="ember">
                  <Crown className="size-3" aria-hidden="true" />
                  Owner
                </Badge>
              ) : null}
              {isSelf ? (
                <Badge size="sm" variant="outline">
                  You
                </Badge>
              ) : null}
            </div>
            <span className="truncate text-[12px] text-muted">{member.email}</span>
          </div>
        </div>
      </TableCell>

      <TableCell className="karo-numeric hidden text-muted md:table-cell">
        {formatDate(member.joinedAt)}
      </TableCell>

      <TableCell>
        {roleBlockedReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Badge size="md" variant="neutral">
                  {ROLE_LABELS[member.role]}
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent>{roleBlockedReason}</TooltipContent>
          </Tooltip>
        ) : (
          <Select
            value={role}
            disabled={savingRole}
            onValueChange={(value) => changeRole(value as TeamRole)}
          >
            <SelectTrigger
              size="sm"
              className="w-[8.5rem]"
              aria-label={`Role for ${member.name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {grantable.map((option) => (
                <SelectItem key={option} value={option}>
                  {ROLE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TableCell>

      <TableCell className="text-right">
        {removeBlockedReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button variant="ghost" size="sm" disabled iconLeft={<UserMinus />}>
                  Remove
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{removeBlockedReason}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<UserMinus />}
            className="text-danger hover:bg-danger-soft hover:text-danger"
            onClick={() => setConfirmOpen(true)}
          >
            {isSelf ? 'Leave' : 'Remove'}
          </Button>
        )}

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {isSelf ? `Leave ${teamName}?` : `Remove ${member.name} from ${teamName}?`}
              </DialogTitle>
              <DialogDescription>
                {isSelf
                  ? 'You lose access to this team’s projects, sandboxes and usage immediately. Anything you created stays with the team, and an admin can invite you back.'
                  : 'They lose access to this team’s projects, sandboxes and usage immediately. Everything they created stays with the team.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={removing} onClick={remove}>
                {isSelf ? 'Leave team' : 'Remove member'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}
