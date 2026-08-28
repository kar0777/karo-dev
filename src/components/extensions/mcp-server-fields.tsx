'use client';

import * as React from 'react';

import {
  KeyValueEditor,
  newKeyValueRow,
  type KeyValueRow,
} from '@/components/extensions/key-value-editor';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { McpServerView, ProjectOptionView } from '@/lib/extensions/types';

/**
 * The shared field set for adding and editing an MCP server. Kept separate from
 * the dialogs so "Add → Manual" and "Edit" cannot drift apart.
 */

export type McpFormValue = {
  name: string;
  description: string;
  scope: 'account' | 'project';
  projectId: string | null;
  transport: 'stdio' | 'http' | 'sse';
  command: string;
  /** One argument per line — quoting rules are a footgun nobody needs here. */
  argsText: string;
  url: string;
  env: KeyValueRow[];
  headers: KeyValueRow[];
  requireApproval: boolean;
  isEnabled: boolean;
};

export function emptyMcpForm(): McpFormValue {
  return {
    name: '',
    description: '',
    scope: 'account',
    projectId: null,
    transport: 'stdio',
    command: '',
    argsText: '',
    url: '',
    env: [],
    headers: [],
    requireApproval: true,
    isEnabled: true,
  };
}

export function mcpFormFromServer(server: McpServerView): McpFormValue {
  const storedSecrets = new Set(server.secretKeys);

  const env: KeyValueRow[] = [
    ...server.env.map((entry) => newKeyValueRow({ key: entry.key, value: entry.value })),
    ...[...storedSecrets]
      .filter((key) => !key.startsWith('header:'))
      .map((key) => newKeyValueRow({ key, secret: true, stored: true })),
  ];

  const headers: KeyValueRow[] = [
    ...server.headers.map((entry) => newKeyValueRow({ key: entry.name, value: entry.value })),
    ...[...storedSecrets]
      .filter((key) => key.startsWith('header:'))
      .map((key) => newKeyValueRow({ key: key.slice(7), secret: true, stored: true })),
  ];

  return {
    name: server.name,
    description: server.description,
    scope: server.scope,
    projectId: server.projectId,
    transport: server.transport,
    command: server.command ?? '',
    argsText: (server.args ?? []).join('\n'),
    url: server.url ?? '',
    env,
    headers,
    requireApproval: server.requireApproval,
    isEnabled: server.isEnabled,
  };
}

function parseArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Wire shape. Rows for a stored secret that was not replaced are dropped so the
 * server keeps the encrypted value it already has; a row that *was* replaced is
 * sent, including an empty string, which clears the key.
 */
function submittableRows(rows: KeyValueRow[]): KeyValueRow[] {
  return rows
    .filter((row) => row.key.trim() !== '')
    .filter((row) => !(row.stored && !row.replacing));
}

function serialiseEnv(rows: KeyValueRow[]) {
  return submittableRows(rows).map((row) => ({
    key: row.key.trim(),
    value: row.value,
    secret: row.secret,
  }));
}

function serialiseHeaders(rows: KeyValueRow[]) {
  return submittableRows(rows).map((row) => ({
    name: row.key.trim(),
    value: row.value,
    secret: row.secret,
  }));
}

export function mcpFormToBody(value: McpFormValue) {
  return {
    name: value.name.trim(),
    description: value.description.trim(),
    scope: value.scope,
    projectId: value.scope === 'project' ? value.projectId : null,
    transport: value.transport,
    command: value.transport === 'stdio' ? value.command.trim() : null,
    args: value.transport === 'stdio' ? parseArgs(value.argsText) : [],
    url: value.transport === 'stdio' ? null : value.url.trim(),
    env: value.transport === 'stdio' ? serialiseEnv(value.env) : [],
    headers: value.transport === 'stdio' ? [] : serialiseHeaders(value.headers),
    requireApproval: value.requireApproval,
    isEnabled: value.isEnabled,
  };
}

const TRANSPORTS = [
  { value: 'stdio' as const, label: 'stdio' },
  { value: 'http' as const, label: 'HTTP' },
  { value: 'sse' as const, label: 'SSE' },
];

export type McpServerFieldsProps = {
  value: McpFormValue;
  onChange: (value: McpFormValue) => void;
  projects: readonly ProjectOptionView[];
  idPrefix: string;
  disabled?: boolean;
};

export function McpServerFields({
  value,
  onChange,
  projects,
  idPrefix,
  disabled = false,
}: McpServerFieldsProps) {
  const patch = React.useCallback(
    (next: Partial<McpFormValue>) => onChange({ ...value, ...next }),
    [onChange, value],
  );

  return (
    <div className="space-y-4">
      <Field disabled={disabled}>
        <FieldLabel htmlFor={`${idPrefix}-name`} required>
          Name
        </FieldLabel>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          maxLength={80}
          required
          placeholder="Postgres (read replica)"
          onChange={(event) => patch({ name: event.target.value })}
        />
        <FieldHint>Shown in the tool namespace the agent sees, so keep it short.</FieldHint>
      </Field>

      <Field disabled={disabled}>
        <FieldLabel htmlFor={`${idPrefix}-description`}>What it is for</FieldLabel>
        <Input
          id={`${idPrefix}-description`}
          value={value.description}
          maxLength={400}
          placeholder="Read-only queries against the analytics replica"
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label id={`${idPrefix}-scope-label`}>Available to</Label>
          <SegmentedControl
            aria-labelledby={`${idPrefix}-scope-label`}
            size="sm"
            fullWidth
            disabled={disabled}
            options={[
              { value: 'account', label: 'Whole account' },
              { value: 'project', label: 'One project' },
            ]}
            value={value.scope}
            onValueChange={(scope) =>
              patch({
                scope: scope as 'account' | 'project',
                projectId:
                  scope === 'project' ? (value.projectId ?? projects[0]?.id ?? null) : null,
              })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label id={`${idPrefix}-transport-label`}>Transport</Label>
          <SegmentedControl
            aria-labelledby={`${idPrefix}-transport-label`}
            size="sm"
            fullWidth
            disabled={disabled}
            options={TRANSPORTS}
            value={value.transport}
            onValueChange={(transport) =>
              patch({ transport: transport as McpFormValue['transport'] })
            }
          />
        </div>
      </div>

      {value.scope === 'project' ? (
        <Field disabled={disabled}>
          <FieldLabel htmlFor={`${idPrefix}-project`} required>
            Project
          </FieldLabel>
          {projects.length === 0 ? (
            <FieldHint>
              You have no projects yet. Create one first, or leave the scope on the whole
              account.
            </FieldHint>
          ) : (
            <Select
              value={value.projectId ?? ''}
              onValueChange={(projectId) => patch({ projectId })}
              disabled={disabled}
            >
              <SelectTrigger id={`${idPrefix}-project`} size="sm">
                <SelectValue placeholder="Pick a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      ) : null}

      {value.transport === 'stdio' ? (
        <>
          <Field disabled={disabled}>
            <FieldLabel htmlFor={`${idPrefix}-command`} required>
              Command
            </FieldLabel>
            <Input
              id={`${idPrefix}-command`}
              mono
              value={value.command}
              placeholder="npx"
              onChange={(event) => patch({ command: event.target.value })}
            />
            <FieldHint>
              Runs inside the sandbox, never on the Karo host. Use the launcher only — put
              everything else in Arguments.
            </FieldHint>
          </Field>

          <Field disabled={disabled}>
            <FieldLabel htmlFor={`${idPrefix}-args`}>Arguments</FieldLabel>
            <Textarea
              id={`${idPrefix}-args`}
              mono
              rows={4}
              value={value.argsText}
              placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/workspace'}
              onChange={(event) => patch({ argsText: event.target.value })}
            />
            <FieldHint>One argument per line — no shell quoting to get wrong.</FieldHint>
          </Field>

          <div className="space-y-1.5">
            <Label>Environment variables</Label>
            <KeyValueEditor
              rows={value.env}
              onChange={(env) => patch({ env })}
              noun="Variable"
              keyPlaceholder="POSTGRES_CONNECTION_STRING"
              valuePlaceholder="value"
              idPrefix={`${idPrefix}-env`}
              disabled={disabled}
            />
          </div>
        </>
      ) : (
        <>
          <Field disabled={disabled}>
            <FieldLabel htmlFor={`${idPrefix}-url`} required>
              Endpoint URL
            </FieldLabel>
            <Input
              id={`${idPrefix}-url`}
              mono
              type="url"
              inputMode="url"
              value={value.url}
              placeholder="https://mcp.example.com/mcp"
              onChange={(event) => patch({ url: event.target.value })}
            />
            <FieldHint>
              Must be publicly resolvable. Karo blocks private ranges, loopback and cloud
              metadata endpoints — a connection test will tell you if the address is refused.
            </FieldHint>
          </Field>

          <div className="space-y-1.5">
            <Label>Request headers</Label>
            <KeyValueEditor
              rows={value.headers}
              onChange={(headers) => patch({ headers })}
              noun="Header"
              keyPlaceholder="Authorization"
              valuePlaceholder="Bearer …"
              idPrefix={`${idPrefix}-hdr`}
              disabled={disabled}
            />
          </div>
        </>
      )}

      <div className="space-y-2 rounded-md border border-line bg-surface-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor={`${idPrefix}-approval`} className="text-[13px]">
              Ask before every destructive tool call
            </Label>
            <p className="mt-0.5 text-[12px] text-muted">
              Recommended. Karo flags tools whose name or description suggests they change
              something, and pauses the run until you approve.
            </p>
          </div>
          <Switch
            id={`${idPrefix}-approval`}
            checked={value.requireApproval}
            disabled={disabled}
            onCheckedChange={(checked) => patch({ requireApproval: checked })}
          />
        </div>

        <div className="flex items-start justify-between gap-3 border-t border-line pt-2">
          <div className="min-w-0">
            <Label htmlFor={`${idPrefix}-enabled`} className="text-[13px]">
              Enabled
            </Label>
            <p className="mt-0.5 text-[12px] text-muted">
              Disabled servers stay configured but are never dialled during a run.
            </p>
          </div>
          <Switch
            id={`${idPrefix}-enabled`}
            checked={value.isEnabled}
            disabled={disabled}
            onCheckedChange={(checked) => patch({ isEnabled: checked })}
          />
        </div>
      </div>
    </div>
  );
}
