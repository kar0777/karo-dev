'use client';

import Link from 'next/link';

import {
  Archive,
  ArchiveRestore,
  Clock,
  Copy,
  Ellipsis,
  ExternalLink,
  MessagesSquare,
  Pencil,
  Trash2,
} from 'lucide-react';

import {
  RUNTIME_TARGET_META,
  SANDBOX_STATUS_META,
  templateIcon,
  type IconComponent,
} from '@/components/app/meta';
import type { ProjectView } from '@/components/app/projects/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { StatusDot } from '@/components/ui/dot';
import { Spinner } from '@/components/ui/spinner';
import type { SandboxStatus } from '@/lib/db/schema';
import { cn, formatRelativeTime, pluralize } from '@/lib/utils';

export type ProjectAction = 'rename' | 'duplicate' | 'archive' | 'restore' | 'delete';

/**
 * Renders whichever lucide component the project's template resolved to.
 *
 * `templateIcon` only ever hands back one of a fixed set of module-level
 * components, so the element type really is stable — but resolving it and using
 * it as a JSX tag in the same function body is indistinguishable from declaring
 * a component during render, which would remount the icon on every pass. The
 * card resolves the component and this module-scope wrapper renders it, which
 * keeps the two apart without duplicating the icon whitelist.
 */
function TemplateIcon({ icon: Icon, className }: { icon: IconComponent; className?: string }) {
  return <Icon className={className} aria-hidden="true" />;
}

export type ProjectCardProps = {
  project: ProjectView;
  templateIconName: string | undefined;
  view: 'grid' | 'list';
  canUpdate: boolean;
  canDelete: boolean;
  /** Set while a mutation for this card is in flight. */
  busy?: boolean;
  onAction: (action: ProjectAction, project: ProjectView) => void;
};

export function ProjectCard({
  project,
  templateIconName,
  view,
  canUpdate,
  canDelete,
  busy = false,
  onAction,
}: ProjectCardProps) {
  const icon = templateIcon(templateIconName);
  const runtime = RUNTIME_TARGET_META[project.runtimeTarget];
  const status = project.sandboxStatus as SandboxStatus | null;
  const statusMeta = status ? SANDBOX_STATUS_META[status] : null;
  const href = `/app/projects/${project.id}`;

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-subtle hover:text-fg"
          aria-label={`Actions for ${project.name}`}
        >
          {busy ? <Spinner size="xs" label={null} /> : <Ellipsis className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <Link href={href}>
            <ExternalLink className="size-4" aria-hidden="true" />
            Open
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canUpdate} onSelect={() => onAction('rename', project)}>
          <Pencil className="size-4" aria-hidden="true" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canUpdate} onSelect={() => onAction('duplicate', project)}>
          <Copy className="size-4" aria-hidden="true" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canUpdate}
          onSelect={() => onAction(project.archived ? 'restore' : 'archive', project)}
        >
          {project.archived ? (
            <ArchiveRestore className="size-4" aria-hidden="true" />
          ) : (
            <Archive className="size-4" aria-hidden="true" />
          )}
          {project.archived ? 'Restore' : 'Archive'}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="danger"
          disabled={!canDelete}
          onSelect={() => onAction('delete', project)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const meta = (
    <>
      <Badge variant="outline" size="sm">
        {runtime.short}
      </Badge>
      {project.modelName ? (
        <Badge variant="neutral" size="sm" className="max-w-36 truncate">
          {project.modelName}
        </Badge>
      ) : null}
      {project.archived ? (
        <Badge variant="warning" size="sm">
          Archived
        </Badge>
      ) : null}
    </>
  );

  if (view === 'list') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 ease-[var(--k-ease)] hover:bg-surface-2',
          busy && 'opacity-60',
        )}
      >
        <TemplateIcon icon={icon} className="size-4 shrink-0 text-subtle" />
        <Link href={href} className="min-w-0 flex-1 rounded-sm">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-fg">{project.name}</span>
            {statusMeta ? (
              <StatusDot status={statusMeta.dot} size="sm" label={statusMeta.label} />
            ) : null}
          </span>
          <span className="block truncate text-[11.5px] text-muted">
            {project.description || 'No description'}
          </span>
        </Link>
        <div className="hidden shrink-0 items-center gap-1.5 md:flex">{meta}</div>
        <span className="hidden w-28 shrink-0 text-right text-[11px] text-subtle sm:block">
          {formatRelativeTime(project.lastActivityAt)}
        </span>
        {menu}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col rounded-lg border border-line bg-surface p-3.5',
        'transition-[border-color,box-shadow] duration-150 ease-[var(--k-ease)] hover:border-line-strong hover:shadow-md',
        busy && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2">
          <TemplateIcon icon={icon} className="size-4 text-subtle" />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={href} className="rounded-sm">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-fg">{project.name}</span>
              {statusMeta ? (
                <StatusDot status={statusMeta.dot} size="sm" label={statusMeta.label} />
              ) : null}
            </span>
          </Link>
          <p className="truncate text-[11px] text-subtle">
            {statusMeta ? statusMeta.label : 'No sandbox yet'}
          </p>
        </div>
        {menu}
      </div>

      <p className="karo-truncate-2 mt-2.5 min-h-[2.4em] text-[12px] leading-snug text-muted">
        {project.description || 'No description yet — add one so the agent has context.'}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">{meta}</div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5 text-[11px] text-subtle">
        <span className="inline-flex items-center gap-1">
          <MessagesSquare className="size-3" aria-hidden="true" />
          {project.conversationCount} {pluralize(project.conversationCount, 'conversation')}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3" aria-hidden="true" />
          {formatRelativeTime(project.lastActivityAt)}
        </span>
      </div>
    </div>
  );
}
