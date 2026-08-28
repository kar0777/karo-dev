'use client';

import {
  MoreHorizontal,
  Pencil,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  ScrollText,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { ConfirmDialog } from '@/components/extensions/confirm-dialog';
import { McpAddDialog } from '@/components/extensions/mcp-add-dialog';
import { McpEditDialog } from '@/components/extensions/mcp-edit-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusDot, type StatusDotStatus } from '@/components/ui/dot';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { EmptyState } from '@/components/ui/empty-state';
import { Meter } from '@/components/ui/meter';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import type { ConnectionStatus } from '@/lib/db/schema';
import type { McpServerView, McpTemplateView, ProjectOptionView } from '@/lib/extensions/types';
import { formatRelativeTime, pluralize } from '@/lib/utils';

/** Connection status → the dot vocabulary the rest of the product uses. */
export function statusDot(status: ConnectionStatus, enabled: boolean): StatusDotStatus {
  if (!enabled) return 'off';
  if (status === 'connected') return 'live';
  if (status === 'connecting') return 'pending';
  if (status === 'error') return 'error';
  return 'idle';
}

export function statusLabel(status: ConnectionStatus, enabled: boolean): string {
  if (!enabled) return 'Disabled';
  if (status === 'connected') return 'Connected';
  if (status === 'connecting') return 'Connecting';
  if (status === 'error') return 'Failed';
  return 'Not connected';
}

const TRANSPORT_LABEL: Record<string, string> = { stdio: 'stdio', http: 'HTTP', sse: 'SSE' };

export type McpServerListProps = {
  servers: readonly McpServerView[];
  templates: readonly McpTemplateView[];
  projects: readonly ProjectOptionView[];
  canManage: boolean;
  limits: { maxMcpServers: number; planName: string };
};

export function McpServerList({
  servers,
  templates,
  projects,
  canManage,
  limits,
}: McpServerListProps) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<McpServerView | null>(null);
  const [deleting, setDeleting] = React.useState<McpServerView | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  const atLimit = servers.length >= limits.maxMcpServers;

  async function run(id: string, work: () => Promise<void>) {
    setPending(id);
    try {
      await work();
      router.refresh();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setPending(null);
    }
  }

  async function toggleEnabled(server: McpServerView, isEnabled: boolean) {
    await run(server.id, async () => {
      await apiFetch(`/api/mcp/${server.id}`, { method: 'PATCH', json: { isEnabled } });
      toast.success(isEnabled ? `${server.name} enabled` : `${server.name} disabled`, {
        description: isEnabled
          ? 'Its tools will be offered to the agent on the next run.'
          : 'It stays configured but will not be dialled.',
      });
    });
  }

  async function test(server: McpServerView) {
    await run(server.id, async () => {
      const response = await apiFetch<{ result: { ok: boolean; message: string } }>(
        `/api/mcp/${server.id}/test`,
        { method: 'POST' },
      );
      if (response.result.ok) {
        toast.success(`${server.name} is reachable`, { description: response.result.message });
      } else {
        toast.error(`${server.name} did not connect`, {
          description: `${response.result.message} Open the server to read the connection log.`,
        });
      }
    });
  }

  async function reconnect(server: McpServerView) {
    await run(server.id, async () => {
      const response = await apiFetch<{ result: { ok: boolean; message: string } }>(
        `/api/mcp/${server.id}/reconnect`,
        { method: 'POST' },
      );
      if (response.result.ok) {
        toast.success(`${server.name} reconnected`, { description: response.result.message });
      } else {
        toast.error(`${server.name} could not reconnect`, {
          description: `${response.result.message} Check the command or URL and try again.`,
        });
      }
    });
  }

  async function remove(server: McpServerView) {
    await apiFetch(`/api/mcp/${server.id}`, { method: 'DELETE' });
    toast.success(`${server.name} removed`, {
      description: 'Its discovered tools are gone too. Add it again at any time.',
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <Meter
            className="max-w-sm"
            value={servers.length}
            max={limits.maxMcpServers}
            label="MCP servers"
            caption={`${servers.length} / ${limits.maxMcpServers} on ${limits.planName}`}
          />
          {canManage ? (
            <Button
              type="button"
              size="sm"
              iconLeft={<Plus />}
              disabled={atLimit}
              title={
                atLimit
                  ? `The ${limits.planName} plan includes ${limits.maxMcpServers} MCP servers.`
                  : undefined
              }
              onClick={() => setAdding(true)}
            >
              Add server
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {atLimit && canManage ? (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-warning-soft-fg">
          You have used every MCP server slot on {limits.planName}. Remove one, or upgrade the
          plan to connect more.
        </p>
      ) : null}

      {servers.length === 0 ? (
        <Card>
          <EmptyState
            icon={Plug}
            title="No MCP servers connected"
            description="MCP servers give the agent tools beyond the built-ins — a database it can query, a repository it can read, a knowledge graph it can remember into."
            action={
              canManage ? (
                <Button
                  type="button"
                  size="sm"
                  iconLeft={<Plus />}
                  onClick={() => setAdding(true)}
                >
                  Add your first server
                </Button>
              ) : (
                <span className="text-[12px] text-subtle">
                  Ask a team admin to add one — your role can view servers but not change them.
                </span>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead>
                <TableHead className="hidden sm:table-cell">Transport</TableHead>
                <TableHead className="hidden md:table-cell">Scope</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Tools</TableHead>
                <TableHead className="hidden lg:table-cell">Last connected</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((server) => {
                const busy = pending === server.id;
                return (
                  <TableRow key={server.id}>
                    <TableCell>
                      <Link
                        href={`/app/mcp/${server.id}`}
                        className="rounded-sm font-medium text-fg hover:text-primary"
                      >
                        {server.name}
                      </Link>
                      {server.description ? (
                        <p className="mt-0.5 max-w-xs truncate text-[12px] text-muted">
                          {server.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" size="sm">
                        {TRANSPORT_LABEL[server.transport] ?? server.transport}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge
                        variant={server.scope === 'project' ? 'info' : 'neutral'}
                        size="sm"
                      >
                        {server.scope === 'project'
                          ? (server.projectName ?? 'Project')
                          : 'Account'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <StatusDot
                          status={statusDot(server.status, server.isEnabled)}
                          label={null}
                        />
                        <span className="text-[12px] text-muted">
                          {statusLabel(server.status, server.isEnabled)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="karo-numeric hidden text-muted lg:table-cell">
                      {server.toolCount === 0 ? '—' : server.toolCount}
                    </TableCell>
                    <TableCell className="hidden text-muted lg:table-cell">
                      {server.lastConnectedAt
                        ? formatRelativeTime(server.lastConnectedAt)
                        : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={server.isEnabled}
                        disabled={!canManage || busy}
                        aria-label={`Enable ${server.name}`}
                        onCheckedChange={(checked) => void toggleEnabled(server, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            loading={busy}
                            aria-label={`Actions for ${server.name}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={!canManage}
                            onSelect={() => void test(server)}
                          >
                            <PlugZap />
                            Test connection
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!canManage}
                            onSelect={() => void reconnect(server)}
                          >
                            <RefreshCw />
                            Reconnect
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/app/mcp/${server.id}#logs`}>
                              <ScrollText />
                              View logs
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={!canManage}
                            onSelect={() => setEditing(server)}
                          >
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="danger"
                            disabled={!canManage}
                            onSelect={() => setDeleting(server)}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <McpAddDialog
        open={adding}
        onOpenChange={setAdding}
        templates={templates}
        projects={projects}
        onAdded={() => router.refresh()}
      />

      <McpEditDialog
        server={editing}
        projects={projects}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? 'this server'}?`}
        description={
          <>
            The configuration, its stored secrets and {deleting?.toolCount ?? 0}{' '}
            {pluralize(deleting?.toolCount ?? 0, 'discovered tool')} are removed. Runs that used
            these tools will simply stop offering them. This cannot be undone.
          </>
        }
        confirmLabel="Delete server"
        onConfirm={async () => {
          if (deleting) await remove(deleting);
        }}
      />
    </div>
  );
}
