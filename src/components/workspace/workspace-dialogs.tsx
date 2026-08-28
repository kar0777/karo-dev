'use client';

import { Check } from 'lucide-react';
import * as React from 'react';

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
import { Kbd } from '@/components/ui/kbd';
import { Meter } from '@/components/ui/meter';
import { AGENT_MODES, AGENT_MODE_META } from '@/lib/agent/policy';
import type { AgentMode } from '@/lib/db/schema';
import { cn, formatCompactNumber, formatMicroUsd } from '@/lib/utils';

import { SLASH_CATEGORY_ORDER, type SlashCommandCategory } from './slash-commands';
import { useWorkspace } from './workspace-context';

/**
 * Dialogs opened by slash commands (`/help`, `/context`, `/model`, `/mode`).
 * They live together because they share one `dialog` slot in the workspace
 * state — only one can be open, which is what the palette expects.
 */
export function WorkspaceDialogs() {
  const {
    dialog,
    closeDialog,
    slashCommands,
    data,
    modelId,
    setModelId,
    mode,
    setMode,
    messages,
    compactConversation,
  } = useWorkspace();

  const activeModel = data.models.find((model) => model.id === modelId) ?? null;

  const grouped = React.useMemo(() => {
    const map = new Map<SlashCommandCategory, typeof slashCommands>();
    for (const command of slashCommands) {
      const bucket = map.get(command.category);
      if (bucket) bucket.push(command);
      else map.set(command.category, [command]);
    }
    return [...map.entries()].sort(
      (a, b) => SLASH_CATEGORY_ORDER.indexOf(a[0]) - SLASH_CATEGORY_ORDER.indexOf(b[0]),
    );
  }, [slashCommands]);

  const contextEstimate = React.useMemo(() => {
    const characters = messages.reduce((total, message) => {
      const tools = message.toolCalls.reduce(
        (sum, call) => sum + call.output.length + JSON.stringify(call.args).length,
        0,
      );
      return total + message.content.length + (message.thinking?.length ?? 0) + tools;
    }, 0);
    return Math.ceil(characters / 4);
  }, [messages]);

  const windowSize = activeModel?.contextWindow ?? 128_000;

  return (
    <>
      <Dialog open={dialog === 'help'} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Slash commands</DialogTitle>
            <DialogDescription>
              Type <Kbd>/</Kbd> at the start of the composer to search these without leaving the
              keyboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {grouped.map(([category, commands]) => (
              <section key={category}>
                <h3 className="text-[11px] font-medium tracking-wide text-subtle uppercase">
                  {category}
                </h3>
                <ul className="mt-1.5 divide-y divide-line rounded-md border border-line">
                  {commands.map((command) => (
                    <li
                      key={command.name}
                      className="flex items-baseline gap-3 px-2.5 py-1.5 text-[12.5px]"
                    >
                      <code className="w-40 shrink-0 font-mono font-medium text-fg">
                        /{command.name}
                        {command.argHint ? (
                          <span className="ml-1 font-normal text-subtle">
                            {command.argHint}
                          </span>
                        ) : null}
                      </code>
                      <span className="min-w-0 flex-1 text-muted">{command.description}</span>
                      {command.shortcut ? <Kbd>{command.shortcut}</Kbd> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={closeDialog}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === 'context'}
        onOpenChange={(open) => (open ? null : closeDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Context window</DialogTitle>
            <DialogDescription>
              An estimate of what this conversation currently sends to the model on every turn.
            </DialogDescription>
          </DialogHeader>
          <Meter
            value={contextEstimate}
            max={windowSize}
            label={activeModel?.displayName ?? 'Current model'}
            caption={`${formatCompactNumber(contextEstimate)} / ${formatCompactNumber(windowSize)} tokens`}
            showPercent
          />
          <dl className="mt-1 space-y-1.5 text-[12.5px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Turns in this chat</dt>
              <dd className="karo-numeric text-fg">{messages.length}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Max output per turn</dt>
              <dd className="karo-numeric text-fg">
                {formatCompactNumber(activeModel?.maxOutputTokens ?? 0)}
              </dd>
            </div>
          </dl>
          <p className="text-[12px] leading-relaxed text-muted">
            When this gets close to full, run <code className="font-mono">/compact</code> to
            replace older turns with a summary, or start a new chat.
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={closeDialog}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => {
                closeDialog();
                compactConversation();
              }}
            >
              Compact now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'model'} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a model</DialogTitle>
            <DialogDescription>
              Prices are what Karo charges you per million tokens, margin included.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1">
            {data.models.map((model) => {
              const selected = model.id === modelId;
              return (
                <li key={model.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setModelId(model.id);
                      closeDialog();
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-md border px-2.5 py-2 text-left',
                      'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'border-line-accent bg-primary-soft'
                        : 'border-line bg-surface hover:bg-surface-2',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                        {model.displayName}
                        {model.supportsVision ? (
                          <Badge variant="info" size="sm">
                            vision
                          </Badge>
                        ) : null}
                      </p>
                      <p className="karo-numeric mt-0.5 text-[11.5px] text-muted">
                        {formatCompactNumber(model.contextWindow)} ctx ·{' '}
                        {formatMicroUsd(model.inputMicroUsdPerMtok)} in /{' '}
                        {formatMicroUsd(model.outputMicroUsdPerMtok)} out per Mtok ·{' '}
                        {model.providerName}
                      </p>
                    </div>
                    {selected ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'mode'} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agent mode</DialogTitle>
            <DialogDescription>
              Modes cap what the agent may do, on top of this project&apos;s permissions.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1">
            {AGENT_MODES.map((value) => {
              const meta = AGENT_MODE_META[value as AgentMode];
              const selected = value === mode;
              return (
                <li key={value}>
                  <button
                    type="button"
                    onClick={() => {
                      setMode(value);
                      closeDialog();
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-md border px-2.5 py-2 text-left',
                      'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'border-line-accent bg-primary-soft'
                        : 'border-line bg-surface hover:bg-surface-2',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-fg">{meta.label}</p>
                      <p className="mt-0.5 text-[12px] leading-snug text-muted">
                        {meta.description}
                      </p>
                    </div>
                    {selected ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
