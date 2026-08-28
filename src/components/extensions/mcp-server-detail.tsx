'use client';

import {
  Activity,
  CircleCheck,
  CircleX,
  Pencil,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

import { ConfirmDialog } from '@/components/extensions/confirm-dialog';
import { McpEditDialog } from '@/components/extensions/mcp-edit-dialog';
import { statusDot, statusLabel } from '@/components/extensions/mcp-server-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardToolbar,
} from '@/components/ui/card';
import { StatusDot } from '@/components/ui/dot';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import type {
  LogLine,
  McpServerDetailView,
  McpToolView,
  ProjectOptionView,
} from '@/lib/extensions/types';
import { cn, formatDateTime, formatRelativeTime } from '@/lib/utils';

type TestResponse = {
  result: { ok: boolean; message: string; toolCount: number; latencyMs: number };
  status: ConnectionStatus;
  statusMessage: string | null;
  lastConnectedAt: string | null;
  lastHealthCheckAt: string | null;
  logs: LogLine[];
  tools: McpToolView[];
};

export type McpServerDetailProps = {
  server: McpServerDetailView;
  projects: readonly ProjectOptionView[];
  canManage: boolean;
};

export function McpServerDetail({ server, projects, canManage }: McpServerDetailProps) {
  const router = useRouter();

  const [status, setStatus] = React.useState(server.status);
  const [statusMessage, setStatusMessage] = React.useState(server.statusMessage);
  const [lastConnectedAt, setLastConnectedAt] = React.useState(server.lastConnectedAt);
  const [lastHealthCheckAt, setLastHealthCheckAt] = React.useState(server.lastHealthCheckAt);
  const [logs, setLogs] = React.useState<LogLine[]>(server.logs);
  const [tools, setTools] = React.useState<McpToolView[]>(server.tools);
  const [allowedTools, setAllowedTools] = React.useState<string[]>(server.allowedTools);
  const [requireApproval, setRequireApproval] = React.useState(server.requireApproval);
  const [isEnabled, setIsEnabled] = React.useState(server.isEnabled);

  const [busy, setBusy] = React.useState<'test' | 'reconnect' | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  function applyTest(response: TestResponse) {
    setStatus(response.status);
    setStatusMessage(response.statusMessage);
    setLastConnectedAt(response.lastConnectedAt);
    setLastHealthCheckAt(response.lastHealthCheckAt);
    setLogs(response.logs);
    setTools(response.tools);
  }

  async function probe(kind: 'test' | 'reconnect') {
    setBusy(kind);
    try {
      const response = await apiFetch<TestResponse>(
        `/api/mcp/${server.id}/${kind === 'test' ? 'test' : 'reconnect'}`,
        { method: 'POST' },
      );
      applyTest(response);
      if (response.result.ok) {
        toast.success('Connected', {
          description: `${response.result.message} (${response.result.latencyMs} ms)`,
        });
      } else {
        toast.error('Could not connect', { description: response.result.message });
      }
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(null);
    }
  }

  async function patchServer(patch: Record<string, unknown>, successMessage: string) {
    try {
      await apiFetch(`/api/mcp/${server.id}`, { method: 'PATCH', json: patch });
      toast.success(successMessage);
      router.refresh();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
      router.refresh();
    }
  }

  async function toggleTool(tool: McpToolView, next: boolean) {
    const previous = tools;
    setTools((current) =>
      current.map((row) => (row.id === tool.id ? { ...row, isEnabled: next } : row)),
    );
    try {
      const response = await apiFetch<{ tools: McpToolView[]; allowedTools: string[] }>(
        `/api/mcp/${server.id}/tools`,
        { method: 'PATCH', json: { toolId: tool.id, isEnabled: next } },
      );
      setTools(response.tools);
      setAllowedTools(response.allowedTools);
    } catch (error) {
      setTools(previous);
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    }
  }

  const enabledTools = tools.filter((tool) => tool.isEnabled);
  const destructiveEnabled = enabledTools.filter((tool) => tool.isDestructive);
  const healthHistory = React.useMemo(() => buildHealthHistory(logs), [logs]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <StatusDot status={statusDot(status, isEnabled)} label={null} />
            {statusLabel(status, isEnabled)}
            <Badge variant="outline" size="sm" className="uppercase">
              {server.transport}
            </Badge>
            <Badge variant={server.scope === 'project' ? 'info' : 'neutral'} size="sm">
              {server.scope === 'project' ? (server.projectName ?? 'Project') : 'Account'}
            </Badge>
          </CardTitle>
          <CardDescription>
            {statusMessage ?? 'This server has not been contacted yet.'}
          </CardDescription>
          <CardToolbar>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconLeft={<PlugZap />}
              loading={busy === 'test'}
              disabled={!canManage || busy !== null}
              onClick={() => void probe('test')}
            >
              Test connection
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconLeft={<RefreshCw />}
              loading={busy === 'reconnect'}
              disabled={!canManage || busy !== null}
              onClick={() => void probe('reconnect')}
            >
              Reconnect
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Edit this server"
              disabled={!canManage}
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Delete this server"
              disabled={!canManage}
              onClick={() => setDeleting(true)}
            >
              <Trash2 />
            </Button>
          </CardToolbar>
        </CardHeader>

        <CardContent className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Endpoint">
            <code className="karo-truncate-2 block font-mono text-[12px] break-all text-fg">
              {server.transport === 'stdio'
                ? [server.command, ...server.args].filter(Boolean).join(' ')
                : (server.url ?? '—')}
            </code>
          </Detail>
          <Detail label="Tools discovered">
            <span className="karo-numeric">{tools.length}</span>
            <span className="text-subtle"> · {enabledTools.length} allowed</span>
          </Detail>
          <Detail label="Last connected">
            {lastConnectedAt ? formatRelativeTime(lastConnectedAt) : 'Never'}
          </Detail>
          <Detail label="Last health check">
            {lastHealthCheckAt ? formatRelativeTime(lastHealthCheckAt) : 'Never'}
          </Detail>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Safety</CardTitle>
            <CardDescription>
              How much the agent is trusted with this server during a run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ToggleRow
              id="mcp-require-approval"
              label="Require approval for destructive tools"
              description={
                destructiveEnabled.length > 0
                  ? `${destructiveEnabled.length} of the allowed tools look destructive. With this on, the run pauses for you before each one.`
                  : 'None of the allowed tools currently look destructive, but new ones may appear after a reconnect.'
              }
              checked={requireApproval}
              disabled={!canManage}
              onCheckedChange={(checked) => {
                setRequireApproval(checked);
                void patchServer(
                  { requireApproval: checked },
                  checked ? 'Approval required' : 'Approval turned off',
                );
              }}
            />
            <ToggleRow
              id="mcp-enabled"
              label="Enabled"
              description="Disabled servers keep their configuration but are never dialled during a run."
              checked={isEnabled}
              disabled={!canManage}
              onCheckedChange={(checked) => {
                setIsEnabled(checked);
                void patchServer(
                  { isEnabled: checked },
                  checked ? 'Server enabled' : 'Server disabled',
                );
              }}
            />
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
                <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
                Allow-list
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                {allowedTools.length === 0
                  ? 'Every tool this server advertises is allowed, including any it adds later. Switch tools off below to pin the list.'
                  : `Only these ${allowedTools.length} tools may be called: ${allowedTools.join(', ')}.`}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card id="health">
          <CardHeader>
            <CardTitle>Health check history</CardTitle>
            <CardDescription>The last connection attempts and what came back.</CardDescription>
          </CardHeader>
          <CardContent>
            {healthHistory.length === 0 ? (
              <EmptyState
                size="sm"
                icon={Activity}
                title="No checks yet"
                description="Run a connection test to record the first result."
              />
            ) : (
              <ul className="space-y-2">
                {healthHistory.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="flex items-start gap-2">
                    {entry.level === 'error' ? (
                      <CircleX
                        className="mt-0.5 size-3.5 shrink-0 text-danger"
                        aria-hidden="true"
                      />
                    ) : (
                      <CircleCheck
                        className="mt-0.5 size-3.5 shrink-0 text-success"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-[12px] text-fg">{entry.message}</p>
                      <p className="karo-numeric text-[11px] text-subtle">
                        {formatDateTime(entry.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Discovered tools</CardTitle>
          <CardDescription>
            What this server offers the agent. Switching a tool off removes it from the
            allow-list immediately — running conversations pick that up on their next tool call.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {tools.length === 0 ? (
            <EmptyState
              icon={PlugZap}
              title="Nothing discovered yet"
              description="Tools appear after the first successful connection. Run a connection test to populate this list."
              action={
                canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    iconLeft={<PlugZap />}
                    loading={busy === 'test'}
                    onClick={() => void probe('test')}
                  >
                    Test connection
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead className="hidden sm:table-cell">Calls</TableHead>
                  <TableHead className="hidden lg:table-cell">Last called</TableHead>
                  <TableHead className="text-right">Allowed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tools.map((tool) => (
                  <TableRow key={tool.id}>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <code className="font-mono text-[12px] text-fg">{tool.name}</code>
                        {tool.isDestructive ? (
                          <Badge variant="warning" size="sm">
                            Destructive
                          </Badge>
                        ) : null}
                      </span>
                      <p className="mt-0.5 text-[12px] text-muted md:hidden">
                        {tool.description || 'No description provided by the server.'}
                      </p>
                    </TableCell>
                    <TableCell className="hidden max-w-md text-muted md:table-cell">
                      <span className="karo-truncate-2">
                        {tool.description || 'No description provided by the server.'}
                      </span>
                    </TableCell>
                    <TableCell className="karo-numeric hidden text-muted sm:table-cell">
                      {tool.callCount}
                    </TableCell>
                    <TableCell className="hidden text-muted lg:table-cell">
                      {tool.lastCalledAt ? formatRelativeTime(tool.lastCalledAt) : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={tool.isEnabled}
                        disabled={!canManage}
                        aria-label={`Allow the ${tool.name} tool`}
                        onCheckedChange={(checked) => void toggleTool(tool, checked)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card id="logs">
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Terminal className="size-3.5 text-muted" aria-hidden="true" />
            Connection log
          </CardTitle>
          <CardDescription>
            The last 50 events for this server, newest at the bottom.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <EmptyState
              size="sm"
              icon={Terminal}
              title="No events yet"
              description="Connection attempts, tool discovery and failures are recorded here."
            />
          ) : (
            <ScrollArea className="max-h-72 rounded-md border border-line bg-term-bg">
              <pre className="p-3 font-mono text-[12px] leading-relaxed text-term-fg">
                {logs.map((line, index) => (
                  <div key={`${line.at}-${index}`} className="flex gap-2">
                    <span className="shrink-0 text-term-fg/45">
                      {new Date(line.at).toISOString().slice(11, 19)}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 uppercase',
                        line.level === 'error' ? 'text-danger' : 'text-primary',
                      )}
                    >
                      {line.level.padEnd(5, ' ')}
                    </span>
                    <span className="break-all whitespace-pre-wrap">{line.message}</span>
                  </div>
                ))}
              </pre>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {server.status === 'error' && isEnabled ? (
        <Alert variant="danger">
          <AlertTitle>This server is failing</AlertTitle>
          <AlertDescription>
            Karo skips unreachable MCP servers rather than failing the run, so the agent is
            currently working without these tools. Fix the command or URL and reconnect, or
            disable the server to stop the retries.
          </AlertDescription>
        </Alert>
      ) : null}

      <McpEditDialog
        server={editing ? server : null}
        projects={projects}
        onOpenChange={(open) => setEditing(open)}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${server.name}?`}
        description="The configuration, its stored secrets and every discovered tool are removed. This cannot be undone."
        confirmLabel="Delete server"
        onConfirm={async () => {
          try {
            await apiFetch(`/api/mcp/${server.id}`, { method: 'DELETE' });
            toast.success(`${server.name} removed`);
            router.push('/app/mcp');
            router.refresh();
          } catch (error) {
            const { title, message } = describeError(error);
            toast.error(title, { description: message });
          }
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Pieces
 * ------------------------------------------------------------------ */

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] tracking-wide text-subtle uppercase">{label}</p>
      <div className="mt-0.5 text-[13px] text-fg">{children}</div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface-2 p-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium text-fg">
          {label}
        </label>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/**
 * The connection manager appends one log line per status transition, so the
 * health history is those lines read newest-first — there is no second store to
 * keep in sync.
 */
function buildHealthHistory(logs: readonly LogLine[]): LogLine[] {
  return [...logs]
    .reverse()
    .filter(
      (line) =>
        line.level === 'error' ||
        /^(Connected|Healthy|Disconnected)/i.test(line.message.trim()),
    )
    .slice(0, 8);
}
