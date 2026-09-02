'use client';

import {
  CircleCheck,
  CloudDownload,
  ExternalLink,
  RefreshCw,
  Rocket,
  Search,
} from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CodeBlock } from '@/components/ui/code-block';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented';
import { apiFetch, describeError } from '@/lib/client/api';
import { cn } from '@/lib/utils';

/**
 * The CLI agents catalogue — "terminals by license".
 *
 * One dialog answers both places a user might want Claude Code, Codex, Gemini
 * CLI and friends: installed into the running Karo sandbox (the installer
 * types the vendor's own install command into a real terminal so progress is
 * visible and honest), or on the user's own machine with the same official
 * commands. Karo redistributes nothing; proprietary tools authenticate with
 * the user's own account or license inside the terminal.
 */

export type CliToolView = {
  id: string;
  slug: string;
  name: string;
  vendor: string;
  description: string;
  license: string;
  licenseKind: 'free' | 'proprietary';
  licenseUrl: string | null;
  docsUrl: string | null;
  authKind: 'login' | 'api_key' | 'none';
  authNote: string;
  apiKeyEnvVar: string | null;
  installCommands: { sandbox: string; macos: string; linux: string; windows: string };
  launchCommand: string;
  install: {
    status: 'installed' | 'missing' | 'unknown';
    version: string | null;
    lastCheckedAt: string;
  } | null;
};

const INSTALL_CHECK_DELAY_MS = 4_000;

type MachineOs = 'macos' | 'linux' | 'windows';

export function CliAgentsDialog({
  open,
  onOpenChange,
  sandboxId,
  sandboxRunning,
  onSendToTerminal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sandboxId: string | null;
  sandboxRunning: boolean;
  onSendToTerminal: (title: string, command: string) => void;
}) {
  const [tools, setTools] = React.useState<CliToolView[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busySlug, setBusySlug] = React.useState<string | null>(null);
  const [attachKeys, setCheckedOs] = React.useState<Record<string, boolean>>({});
  const [tab, setTab] = React.useState<'sandbox' | 'machine'>('sandbox');
  const [machineOs, setMachineOs] = React.useState<MachineOs>('macos');
  const checkTimers = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  const load = React.useCallback(async () => {
    if (!sandboxId) return;
    try {
      const payload = await apiFetch<{ tools: CliToolView[] }>(
        `/api/cli-tools?sandboxId=${encodeURIComponent(sandboxId)}`,
      );
      setTools(payload.tools);
      setLoadError(null);
    } catch (error) {
      setLoadError(describeError(error).message);
    }
  }, [sandboxId]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The reset starts from a microtask rather than the effect body — a
    // render-phase setState here would be the cascading-render pattern.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setTools(null);
      setLoadError(null);
      return load();
    });
    return () => {
      cancelled = true;
      for (const timer of checkTimers.current) clearTimeout(timer);
      checkTimers.current = [];
    };
  }, [open, load]);

  const recheck = React.useCallback(
    async (slug: string) => {
      if (!sandboxId) return;
      try {
        const result = await apiFetch<{
          status: 'installed' | 'missing' | 'unknown';
          version: string | null;
        }>(`/api/cli-tools/${slug}/check`, { json: { sandboxId } });
        setTools((prev) =>
          (prev ?? []).map((tool) =>
            tool.slug === slug
              ? {
                  ...tool,
                  install: {
                    status: result.status,
                    version: result.version,
                    lastCheckedAt: new Date().toISOString(),
                  },
                }
              : tool,
          ),
        );
      } catch {
        // The badge stays as-is; the user can press check again.
      }
    },
    [sandboxId],
  );

  const install = React.useCallback(
    (tool: CliToolView) => {
      if (!sandboxRunning) return;
      setBusySlug(tool.slug);
      onSendToTerminal(`Install ${tool.name}`, tool.installCommands.sandbox);
      const timer = setTimeout(() => {
        void recheck(tool.slug).finally(() => setBusySlug(null));
      }, INSTALL_CHECK_DELAY_MS);
      checkTimers.current.push(timer);
    },
    [onSendToTerminal, recheck, sandboxRunning],
  );

  const launch = React.useCallback(
    async (tool: CliToolView) => {
      if (!sandboxRunning || !sandboxId) return;
      setBusySlug(tool.slug);
      try {
        const attachKey =
          tool.authKind === 'api_key' &&
          (attachKeys[tool.slug] ?? true) &&
          Boolean(tool.apiKeyEnvVar);
        const payload = await apiFetch<{ sessionId: string; command: string }>(
          `/api/cli-tools/${tool.slug}/launch`,
          { json: { sandboxId, attachKey } },
        );
        onSendToTerminal(tool.name, payload.command);
      } catch {
        // Errors surface as toasts from the fetch helper; keep the dialog open.
      } finally {
        setBusySlug(null);
      }
    },
    [attachKeys, onSendToTerminal, sandboxId, sandboxRunning],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>CLI agents</DialogTitle>
          <DialogDescription>
            Install a terminal coding agent — into this sandbox, or on your machine with the
            vendor’s own commands. Karo does not distribute these tools; proprietary ones use
            your own account or license key.
          </DialogDescription>
        </DialogHeader>

        <div className="pb-1">
          <SegmentedControl
            aria-label="Install target"
            value={tab}
            onValueChange={(value) => setTab(value)}
            fullWidth
            options={[
              { value: 'sandbox', label: 'In this sandbox' },
              { value: 'machine', label: 'On my machine' },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {tab === 'sandbox' ? (
            <div className="flex flex-col gap-2">
              {!sandboxRunning ? (
                <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-muted">
                  Start the sandbox to install or launch tools here.
                </p>
              ) : null}
              {loadError ? (
                <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-danger">
                  {loadError}
                </p>
              ) : null}
              {tools === null && !loadError ? (
                <div className="flex flex-col gap-2">
                  {[0, 1, 2].map((index) => (
                    <div
                      key={index}
                      className="h-[76px] animate-pulse rounded-md bg-surface-2"
                    />
                  ))}
                </div>
              ) : null}
              {tools?.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No CLI agents in the catalogue"
                  description="A platform admin can add tools under Admin → CLI agents."
                />
              ) : null}
              {tools?.map((tool) => (
                <ToolCard
                  key={tool.slug}
                  tool={tool}
                  sandboxRunning={sandboxRunning}
                  busy={busySlug === tool.slug}
                  attachKeys={attachKeys}
                  onCheckedOsChange={(slug, value) =>
                    setCheckedOs((prev) => ({ ...prev, [slug]: value }))
                  }
                  onInstall={() => install(tool)}
                  onLaunch={() => void launch(tool)}
                  onCheck={() => void recheck(tool.slug)}
                />
              ))}
            </div>
          ) : (
            <MachineInstall tools={tools ?? []} os={machineOs} onOsChange={setMachineOs} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolCard({
  tool,
  sandboxRunning,
  busy,
  attachKeys,
  onCheckedOsChange,
  onInstall,
  onLaunch,
  onCheck,
}: {
  tool: CliToolView;
  sandboxRunning: boolean;
  busy: boolean;
  attachKeys: Record<string, boolean>;
  onCheckedOsChange: (slug: string, value: boolean) => void;
  onInstall: () => void;
  onLaunch: () => void;
  onCheck: () => void;
}) {
  const installed = tool.install?.status === 'installed';
  const attachDefault = attachKeys[tool.slug] ?? true;

  return (
    <div
      className={cn(
        'rounded-md border border-line bg-surface p-3 transition-colors',
        installed && 'border-success/40',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[13px] font-semibold uppercase text-fg"
        >
          {tool.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13.5px] font-medium text-fg">{tool.name}</span>
            {tool.vendor ? (
              <span className="text-[12px] text-subtle">{tool.vendor}</span>
            ) : null}
            <Badge variant={tool.licenseKind === 'free' ? 'neutral' : 'warning'} size="sm">
              {tool.licenseKind === 'free'
                ? `License: ${tool.license}`
                : 'Your license required'}
            </Badge>
            {installed ? (
              <Badge variant="success" size="sm">
                <CircleCheck aria-hidden="true" className="size-3" />
                Installed{tool.install?.version ? ` · ${tool.install.version}` : ''}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{tool.description}</p>

          {tool.authKind === 'api_key' && tool.apiKeyEnvVar ? (
            <div className="mt-2 flex items-center gap-2">
              <Checkbox
                id={`attach-${tool.slug}`}
                checked={attachDefault}
                onCheckedChange={(value) => onCheckedOsChange(tool.slug, value === true)}
              />
              <Label htmlFor={`attach-${tool.slug}`} className="text-[12px] text-muted">
                Attach a key from my vault as {tool.apiKeyEnvVar} on launch
              </Label>
            </div>
          ) : null}
          {tool.authKind === 'login' && tool.authNote ? (
            <p className="mt-1.5 text-[12px] text-subtle">{tool.authNote}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            {tool.docsUrl ? (
              <a
                href={tool.docsUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`${tool.name} documentation`}
                className="rounded-md p-1.5 text-subtle hover:bg-surface-2 hover:text-fg"
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ) : null}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Check if ${tool.name} is installed`}
              disabled={!sandboxRunning || busy}
              onClick={onCheck}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={!sandboxRunning || busy}
              loading={busy && !installed}
              onClick={onInstall}
            >
              <CloudDownload aria-hidden="true" className="size-3.5" />
              {installed ? 'Reinstall' : 'Install'}
            </Button>
            <Button
              size="sm"
              disabled={!sandboxRunning || busy || tool.install?.status === 'missing'}
              title={
                tool.install?.status === 'missing' ? `Install ${tool.name} first` : undefined
              }
              onClick={onLaunch}
            >
              <Rocket aria-hidden="true" className="size-3.5" />
              Launch
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MachineInstall({
  tools,
  os,
  onOsChange,
}: {
  tools: CliToolView[];
  os: MachineOs;
  onOsChange: (os: MachineOs) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">
          Run the agent next to Karo in your own terminal. Install with the official command,
          then sign in inside the tool with your own account or key.
        </p>
        <SegmentedControl
          aria-label="Operating system"
          value={os}
          onValueChange={(value) => onOsChange(value)}
          size="sm"
          options={[
            { value: 'macos', label: 'macOS' },
            { value: 'linux', label: 'Linux' },
            { value: 'windows', label: 'Windows' },
          ]}
        />
      </div>
      {tools.map((tool) => (
        <div key={tool.slug}>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[13px] font-medium text-fg">{tool.name}</span>
            <span className="text-[11.5px] text-subtle">{tool.vendor}</span>
          </div>
          <CodeBlock
            code={tool.installCommands[os]}
            language="bash"
            filename={`install ${tool.slug}`}
            maxHeight={120}
          />
        </div>
      ))}
      {tools.length === 0 ? (
        <p className="text-[13px] text-subtle">Catalogue is still loading…</p>
      ) : null}
    </div>
  );
}
