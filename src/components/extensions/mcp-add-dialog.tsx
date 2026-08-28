'use client';

import { ArrowLeft, BookOpen, ShieldAlert } from 'lucide-react';
import * as React from 'react';

import { DynamicIcon } from '@/components/extensions/dynamic-icon';
import {
  McpServerFields,
  emptyMcpForm,
  mcpFormToBody,
  type McpFormValue,
} from '@/components/extensions/mcp-server-fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldHint, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { apiFetch, describeError } from '@/lib/client/api';
import type { McpTemplateView, ProjectOptionView } from '@/lib/extensions/types';

/**
 * Add-server dialog.
 *
 * Two ways in: a curated template (which fills the transport, command and the
 * exact env keys the server expects) or a manual definition. Templates never
 * ship a credential — every secret field starts empty and is filled in here.
 */

/**
 * Remote templates declare their credential as an env field, but a remote MCP
 * transport has no environment — the value has to travel as a request header.
 * This is the one mapping needed to bridge the two.
 */
const REMOTE_ENV_TO_HEADER: Record<string, string> = {
  MCP_AUTH_HEADER: 'Authorization',
};

/**
 * Splits an argument line the way a shell would for the simple cases, keeping
 * quoted paths in one piece. Not a shell parser: the field is seeded from the
 * template and edited, not authored from nothing.
 */
function splitArgs(line: string): string[] {
  return (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) =>
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
      ? token.slice(1, -1)
      : token,
  );
}

export type McpAddDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly McpTemplateView[];
  projects: readonly ProjectOptionView[];
  onAdded: () => void;
};

export function McpAddDialog({
  open,
  onOpenChange,
  templates,
  projects,
  onAdded,
}: McpAddDialogProps) {
  const [tab, setTab] = React.useState('template');
  const [selected, setSelected] = React.useState<McpTemplateView | null>(null);
  const [manual, setManual] = React.useState<McpFormValue>(emptyMcpForm);
  const [busy, setBusy] = React.useState(false);

  // Closing the dialog clears the draft so the next open starts on the template
  // grid. The reset is an adjustment during the render that observes the close,
  // not an effect, so it lands in the same commit instead of cascading one more.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setTab('template');
      setSelected(null);
      setManual(emptyMcpForm());
    }
  }

  async function submit(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await apiFetch('/api/mcp', { method: 'POST', json: body });
      toast.success('MCP server added', {
        description: 'Run a connection test to discover the tools it exposes.',
      });
      onOpenChange(false);
      onAdded();
    } catch (error) {
      const { title, message } = describeError(error);
      toast.error(title, { description: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-line px-5 pt-5 pb-4">
          <DialogTitle>Add an MCP server</DialogTitle>
          <DialogDescription>
            Model Context Protocol servers give the agent extra tools. Start from a template or
            define one yourself.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col">
          <div className="px-5 pt-3">
            <TabsList variant="pill">
              <TabsTrigger value="template">From a template</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="template" className="min-h-0">
            <ScrollArea className="max-h-[52vh]">
              <div className="px-5 py-4">
                {selected ? (
                  <TemplateConfigurator
                    template={selected}
                    projects={projects}
                    busy={busy}
                    onBack={() => setSelected(null)}
                    onSubmit={submit}
                  />
                ) : (
                  <TemplateGrid templates={templates} onSelect={setSelected} />
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="manual" className="min-h-0">
            <ScrollArea className="max-h-[52vh]">
              <div className="px-5 py-4">
                <McpServerFields
                  value={manual}
                  onChange={setManual}
                  projects={projects}
                  idPrefix="mcp-new"
                  disabled={busy}
                />
              </div>
            </ScrollArea>
            <DialogFooter className="border-t border-line px-5 py-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                loading={busy}
                disabled={manual.name.trim() === ''}
                onClick={() => void submit(mcpFormToBody(manual))}
              >
                Add server
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 *  Template grid
 * ------------------------------------------------------------------ */

function TemplateGrid({
  templates,
  onSelect,
}: {
  templates: readonly McpTemplateView[];
  onSelect: (template: McpTemplateView) => void;
}) {
  if (templates.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-line bg-surface-2 px-4 py-6 text-center text-[13px] text-muted">
        No templates are configured on this deployment. Use the Manual tab to define a server,
        or ask an administrator to seed the catalogue.
      </p>
    );
  }

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {templates.map((template) => {
        // A remote template always needs somewhere to dial, whether or not it
        // declares a required env field — saying "No configuration required"
        // over a URL the user has to supply is how the Custom HTTP server card
        // came to promise something the dialog could not deliver.
        const required = [
          ...(template.transport === 'stdio' ? [] : [{ label: 'Server URL' }]),
          ...template.env.filter((field) => field.required),
        ];
        return (
          <button
            key={template.key}
            type="button"
            onClick={() => onSelect(template)}
            className="group flex flex-col rounded-lg border border-line bg-surface p-3 text-left transition-colors duration-150 ease-[var(--k-ease)] hover:border-line-strong hover:bg-surface-2"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md border border-line bg-surface-2 text-muted group-hover:text-primary">
                <DynamicIcon name={template.icon} />
              </span>
              <span className="truncate text-[13px] font-medium text-fg">{template.name}</span>
              <Badge variant="outline" size="sm" className="ml-auto shrink-0 uppercase">
                {template.transport}
              </Badge>
            </div>
            <p className="karo-truncate-2 mt-2 text-[12px] leading-relaxed text-muted">
              {template.description}
            </p>
            <p className="mt-2 text-[11px] text-subtle">
              {required.length === 0
                ? 'No configuration required'
                : `You supply: ${required.map((field) => field.label).join(', ')}`}
            </p>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Template configurator
 * ------------------------------------------------------------------ */

function TemplateConfigurator({
  template,
  projects,
  busy,
  onBack,
  onSubmit,
}: {
  template: McpTemplateView;
  projects: readonly ProjectOptionView[];
  busy: boolean;
  onBack: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = React.useState(template.name);
  const [scope, setScope] = React.useState<'account' | 'project'>('account');
  const [projectId, setProjectId] = React.useState<string | null>(projects[0]?.id ?? null);
  const [requireApproval, setRequireApproval] = React.useState(template.requireApproval);
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(template.env.map((field) => [field.key, field.defaultValue])),
  );

  const isRemote = template.transport !== 'stdio';

  /**
   * The connection target, editable.
   *
   * Templates carry a `url` (remote) or a `command` plus `args` (stdio), and
   * this dialog used to submit them verbatim while rendering only the `env`
   * fields. For most templates that is right — the command *is* the template.
   * For the one called "Custom HTTP server" it was not: its whole purpose is to
   * reach a server the user runs, its `url` is the placeholder
   * `http://localhost:8931/mcp`, its only env field is optional, and so the
   * card advertised "No configuration required" and then offered no way to say
   * where the server actually is. The same shape bit `SQLite`, whose database
   * path is baked into `args`.
   */
  const [url, setUrl] = React.useState(template.url ?? '');
  const [argsText, setArgsText] = React.useState(template.args.join(' '));

  const missing = template.env.filter(
    (field) => field.required && (values[field.key] ?? '').trim() === '',
  );
  const urlMissing = isRemote && url.trim() === '';

  function build(): Record<string, unknown> {
    const env: Array<{ key: string; value: string; secret: boolean }> = [];
    const headers: Array<{ name: string; value: string; secret: boolean }> = [];

    for (const field of template.env) {
      const value = values[field.key] ?? '';
      if (value === '') continue;
      if (isRemote) {
        const headerName = REMOTE_ENV_TO_HEADER[field.key];
        if (!headerName) continue;
        headers.push({ name: headerName, value, secret: field.secret });
      } else {
        env.push({ key: field.key, value, secret: field.secret });
      }
    }

    return {
      name: name.trim(),
      description: template.description,
      scope,
      projectId: scope === 'project' ? projectId : null,
      transport: template.transport,
      command: template.command,
      args: isRemote ? template.args : splitArgs(argsText),
      url: isRemote ? url.trim() : template.url,
      env,
      headers,
      allowedTools: template.suggestedAllowedTools,
      requireApproval,
      isEnabled: true,
      templateKey: template.key,
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          iconLeft={<ArrowLeft />}
          onClick={onBack}
        >
          All templates
        </Button>
        <Badge variant="outline" size="sm" className="uppercase">
          {template.transport}
        </Badge>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-primary">
          <DynamicIcon name={template.icon} className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-fg">{template.name}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
            {template.description}
          </p>
          <a
            href={template.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 inline-flex items-center gap-1 rounded-sm text-[11px] text-primary hover:underline"
          >
            <BookOpen className="size-3" aria-hidden="true" />
            Server documentation
          </a>
        </div>
      </div>

      <Alert variant="warning" icon={ShieldAlert}>
        <AlertDescription>{template.safetyNote}</AlertDescription>
      </Alert>

      <Field disabled={busy}>
        <FieldLabel htmlFor="mcp-tpl-name" required>
          Name
        </FieldLabel>
        <Input
          id="mcp-tpl-name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldHint>Must be unique inside your team.</FieldHint>
      </Field>

      <div className="space-y-1.5">
        <Label id="mcp-tpl-scope">Available to</Label>
        <SegmentedControl
          aria-labelledby="mcp-tpl-scope"
          size="sm"
          fullWidth
          disabled={busy}
          options={[
            { value: 'account', label: 'Whole account' },
            { value: 'project', label: 'One project' },
          ]}
          value={scope}
          onValueChange={(next) => setScope(next as 'account' | 'project')}
        />
      </div>

      {scope === 'project' ? (
        <Field disabled={busy}>
          <FieldLabel htmlFor="mcp-tpl-project" required>
            Project
          </FieldLabel>
          {projects.length === 0 ? (
            <FieldHint>
              Create a project first, or install this for the whole account.
            </FieldHint>
          ) : (
            <Select value={projectId ?? ''} onValueChange={setProjectId} disabled={busy}>
              <SelectTrigger id="mcp-tpl-project" size="sm">
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

      {isRemote ? (
        <Field disabled={busy}>
          <FieldLabel htmlFor="mcp-tpl-url" required>
            Server URL
          </FieldLabel>
          <Input
            id="mcp-tpl-url"
            mono
            inputMode="url"
            autoComplete="off"
            value={url}
            placeholder="http://localhost:8931/mcp"
            onChange={(event) => setUrl(event.target.value)}
          />
          <FieldHint>
            Where Karo should reach this server. The template only suggests a default — point it
            at your own host and port.
          </FieldHint>
        </Field>
      ) : (
        <Field disabled={busy}>
          <FieldLabel htmlFor="mcp-tpl-args">Command arguments</FieldLabel>
          <Input
            id="mcp-tpl-args"
            mono
            autoComplete="off"
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
          />
          <FieldHint>
            Runs as <code className="text-fg">{template.command}</code> with these arguments.
            Edit them to point at a different path or database; leave them alone for the
            template&apos;s defaults.
          </FieldHint>
        </Field>
      )}

      {template.env.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[12px] font-medium text-fg">Values you supply</p>
          {template.env.map((field) => (
            <Field key={field.key} disabled={busy}>
              <FieldLabel htmlFor={`mcp-tpl-${field.key}`} required={field.required}>
                {field.label}
              </FieldLabel>
              <Input
                id={`mcp-tpl-${field.key}`}
                mono
                type={field.secret ? 'password' : 'text'}
                autoComplete="off"
                value={values[field.key] ?? ''}
                placeholder={field.placeholder ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
              <FieldHint>
                {field.description}
                {isRemote && field.secret && REMOTE_ENV_TO_HEADER[field.key]
                  ? ` Sent as the ${REMOTE_ENV_TO_HEADER[field.key]} header.`
                  : ''}
              </FieldHint>
            </Field>
          ))}
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface-2 p-3">
        <div className="min-w-0">
          <Label htmlFor="mcp-tpl-approval" className="text-[13px]">
            Ask before every destructive tool call
          </Label>
          <p className="mt-0.5 text-[12px] text-muted">
            {template.suggestedAllowedTools.length > 0
              ? `This template starts with ${template.suggestedAllowedTools.length} tools allowed. You can widen the list after the first connection.`
              : 'Every tool this server advertises will be allowed. Review them after the first connection.'}
          </p>
        </div>
        <Switch
          id="mcp-tpl-approval"
          checked={requireApproval}
          disabled={busy}
          onCheckedChange={setRequireApproval}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        {missing.length > 0 || urlMissing ? (
          <p className="mr-auto text-[12px] text-warning-soft-fg">
            Still needed:{' '}
            {[
              ...(urlMissing ? ['Server URL'] : []),
              ...missing.map((field) => field.label),
            ].join(', ')}
          </p>
        ) : null}
        <Button type="button" variant="secondary" size="sm" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button
          type="button"
          size="sm"
          loading={busy}
          disabled={missing.length > 0 || urlMissing || name.trim() === ''}
          onClick={() => void onSubmit(build())}
        >
          Add server
        </Button>
      </div>
    </div>
  );
}
