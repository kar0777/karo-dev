'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { Building2, Check, ChevronsUpDown, Plus, UserRound } from 'lucide-react';

import { useSession } from '@/components/app/session-provider';
import type { ShellTeamOption } from '@/components/app/shell-data';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ROLE_LABELS } from '@/lib/rbac/permissions';
import { cn, initials } from '@/lib/utils';
import type { PlanTier } from '@/lib/db/schema';

/**
 * Team switcher.
 *
 * The active team is a client preference, so it lives in a plain cookie the
 * app layout reads on the next render. It is not a security boundary — the
 * layout still resolves membership server-side and falls back to the default
 * team if the cookie names one you are not in.
 */

export const ACTIVE_TEAM_COOKIE = 'karo_team';

const PLAN_BADGE: Record<PlanTier, 'neutral' | 'primary' | 'ember'> = {
  payg: 'neutral',
  lite: 'neutral',
  pro: 'primary',
  scale: 'primary',
  ultra: 'ember',
};

/**
 * Assigning to `document.cookie` is a write to a value the compiler treats as
 * frozen for the duration of a render, so it is not allowed to happen inside the
 * component. The write lives here instead — same cookie, same attributes, still
 * called from the click handler.
 */
function persistActiveTeam(teamId: string) {
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${ACTIVE_TEAM_COOKIE}=${encodeURIComponent(teamId)}; path=/; max-age=${oneYear}; samesite=lax`;
}

export type TeamSwitcherProps = {
  teams: readonly ShellTeamOption[];
  planName: string;
  planTier: PlanTier;
  collapsed?: boolean;
};

export function TeamSwitcher({
  teams,
  planName,
  planTier,
  collapsed = false,
}: TeamSwitcherProps) {
  const { team } = useSession();
  const router = useRouter();
  const [switching, setSwitching] = React.useState<string | null>(null);

  function switchTo(teamId: string) {
    if (teamId === team.id) return;
    setSwitching(teamId);
    persistActiveTeam(teamId);
    // A refresh re-runs the layout, which re-resolves membership server-side.
    router.push('/app');
    router.refresh();
  }

  const trigger = (
    <button
      type="button"
      aria-label={`Team: ${team.name}. Switch team`}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md border border-transparent p-1.5 text-left',
        'transition-colors duration-150 ease-[var(--k-ease)] hover:border-line hover:bg-surface-2',
        collapsed && 'justify-center',
      )}
    >
      <Avatar size="sm" className="shrink-0">
        <AvatarFallback>{initials(team.name)}</AvatarFallback>
      </Avatar>
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-fg">{team.name}</span>
            <span className="block truncate text-[11px] text-subtle">{planName}</span>
          </span>
          <Badge variant={PLAN_BADGE[planTier]} size="sm" className="shrink-0 uppercase">
            {planTier}
          </Badge>
          <ChevronsUpDown className="size-3.5 shrink-0 text-subtle" aria-hidden="true" />
        </>
      )}
    </button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">
              {team.name} · {planName}
            </TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Teams</DropdownMenuLabel>
        {teams.map((option) => {
          const active = option.id === team.id;
          return (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => switchTo(option.id)}
              disabled={switching !== null && switching !== option.id}
              className="gap-2"
            >
              {option.isPersonal ? (
                <UserRound className="size-4" aria-hidden="true" />
              ) : (
                <Building2 className="size-4" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.name}</span>
                <span className="block truncate text-[11px] text-subtle">
                  {ROLE_LABELS[option.role]} · {option.planName}
                </span>
              </span>
              {active ? <Check className="size-3.5 text-primary" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/app/team')} className="gap-2">
          <Plus className="size-4" aria-hidden="true" />
          Invite people to {team.name}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
