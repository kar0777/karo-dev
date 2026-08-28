'use client';

import { ArrowUp, CircleStop, Paperclip, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { SegmentedControl } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AGENT_MODES, AGENT_MODE_META } from '@/lib/agent/policy';
import type { AgentMode } from '@/lib/db/schema';
import { cn, formatBytes, formatCompactNumber } from '@/lib/utils';

import { filterSlashCommands, SlashPalette } from './slash-palette';
import type { SlashCommand } from './slash-commands';
import type { ComposerAttachment } from './workspace-context';
import { useWorkspace } from './workspace-context';

/**
 * The message composer.
 *
 * Three things share this one control: prose, attachments and the slash
 * palette. The palette is opened by a leading `/` and closed by Escape or by
 * the token stopping being a command — never by blur, because clicking a
 * command must not race the textarea losing focus.
 */

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

const TEXT_LIKE =
  /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|x-sh|sql|toml))|(\.(md|txt|json|ya?ml|toml|csv|log|env|ts|tsx|js|jsx|py|rb|go|rs|java|sh|sql|css|html?)$)/i;

function isTextLike(file: File): boolean {
  return TEXT_LIKE.test(file.type) || TEXT_LIKE.test(file.name);
}

function readFileAs(file: File, mode: 'text' | 'dataUrl'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result ?? ''));
    if (mode === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

let attachmentCounter = 0;

export function Composer() {
  const {
    data,
    mode,
    setMode,
    modelId,
    setModelId,
    isStreaming,
    phase,
    sendMessage,
    stopRun,
    slashCommands,
    runSlashCommand,
    notify,
    initialPrompt,
  } = useWorkspace();

  // Seeded, not forced: `initialPrompt` is only the *initial* draft, so the user
  // can edit or clear what the onboarding wizard carried over. Reading it in the
  // initialiser rather than an effect means it is there on the first paint and
  // never overwrites what someone has since typed.
  const [value, setValue] = React.useState(initialPrompt);
  const [attachments, setAttachments] = React.useState<ComposerAttachment[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(false);

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const listboxId = React.useId();

  const activeModel =
    data.models.find((model) => model.id === modelId) ?? data.models[0] ?? null;

  /* ---- Auto-grow ---- */
  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 260)}px`;
  }, [value]);

  /* ---- Slash detection ---- */
  const slashQuery = React.useMemo(() => {
    if (!value.startsWith('/')) return null;
    const firstLine = value.split('\n')[0] ?? '';
    const space = firstLine.indexOf(' ');
    return space === -1 ? firstLine.slice(1) : firstLine.slice(1, space);
  }, [value]);

  const commandMatches = React.useMemo(
    () => (slashQuery === null ? [] : filterSlashCommands(slashCommands, slashQuery)),
    [slashCommands, slashQuery],
  );

  // Whether the palette is showing is a plain function of the token being typed
  // and whether Escape has dismissed that token, so it is derived rather than
  // stored. Only the dismissal and the highlight are state, and both are reset
  // here — during render, not from an effect, so the palette never paints a frame
  // for the previous token's matches. Resetting the dismissal on every change is
  // what makes Escape dismiss once: type on and the palette comes back.
  const [seenQuery, setSeenQuery] = React.useState(slashQuery);
  if (slashQuery !== seenQuery) {
    setSeenQuery(slashQuery);
    setDismissed(false);
    setActiveIndex(0);
  }

  const paletteOpen = slashQuery !== null && !dismissed;

  const tokenEstimate = React.useMemo(() => {
    const attachmentChars = attachments.reduce(
      (total, attachment) => total + attachment.inlineContent.length,
      0,
    );
    return Math.ceil((value.length + attachmentChars) / 4);
  }, [attachments, value]);

  const contextPercent = activeModel
    ? Math.min(100, Math.round((tokenEstimate / activeModel.contextWindow) * 100))
    : 0;

  /* ---- Attachments ---- */

  const addFiles = React.useCallback(
    async (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      if (!incoming.length) return;

      const accepted: ComposerAttachment[] = [];
      let total = attachments.reduce((sum, item) => sum + item.sizeBytes, 0);

      for (const file of incoming) {
        if (attachments.length + accepted.length >= MAX_ATTACHMENTS) {
          notify('warning', `Up to ${MAX_ATTACHMENTS} attachments per message.`);
          break;
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          notify(
            'warning',
            `${file.name} is too large.`,
            `The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)} per file.`,
          );
          continue;
        }
        if (total + file.size > MAX_TOTAL_BYTES) {
          notify('warning', 'That would exceed the total attachment limit for one message.');
          break;
        }
        const isImage = file.type.startsWith('image/');
        if (isImage && activeModel && !activeModel.supportsVision) {
          notify(
            'warning',
            `${activeModel.displayName} cannot read images.`,
            'Pick a vision-capable model to attach screenshots.',
          );
          continue;
        }
        if (!isImage && !isTextLike(file)) {
          notify(
            'warning',
            `${file.name} is not a text or image file.`,
            'Attach source files, logs, JSON, Markdown or screenshots.',
          );
          continue;
        }
        try {
          const content = await readFileAs(file, isImage ? 'dataUrl' : 'text');
          attachmentCounter += 1;
          accepted.push({
            id: `att_${Date.now().toString(36)}_${attachmentCounter}`,
            filename: file.name,
            mimeType: file.type || 'text/plain',
            sizeBytes: file.size,
            inlineContent: content,
          });
          total += file.size;
        } catch {
          notify('error', `Could not read ${file.name}.`, 'Try attaching it again.');
        }
      }

      if (accepted.length) setAttachments((prev) => [...prev, ...accepted]);
    },
    [activeModel, attachments, notify],
  );

  /* ---- Submit ---- */

  const submit = React.useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;

    if (trimmed.startsWith('/')) {
      const firstLine = trimmed.split('\n')[0] ?? '';
      const space = firstLine.indexOf(' ');
      const name = (
        space === -1 ? firstLine.slice(1) : firstLine.slice(1, space)
      ).toLowerCase();
      const args = space === -1 ? '' : trimmed.slice(space + 1);
      const command = slashCommands.find((item) => item.name.toLowerCase() === name);
      if (command) {
        // Clearing the box removes the token, which closes the palette on its own.
        setValue('');
        runSlashCommand(command, args);
        return;
      }
      notify(
        'warning',
        `Unknown command /${name}`,
        'Type / to see everything Karo can run from here.',
      );
      return;
    }

    sendMessage(trimmed, attachments);
    setValue('');
    setAttachments([]);
  }, [attachments, notify, runSlashCommand, sendMessage, slashCommands, value]);

  const applyCommand = React.useCallback(
    (command: SlashCommand) => {
      const firstLine = value.split('\n')[0] ?? '';
      const space = firstLine.indexOf(' ');
      const args = space === -1 ? '' : value.slice(space + 1);
      setValue('');
      runSlashCommand(command, args);
      textareaRef.current?.focus();
    },
    [runSlashCommand, value],
  );

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (paletteOpen && commandMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % commandMatches.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + commandMatches.length) % commandMatches.length);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const command = commandMatches[activeIndex] ?? commandMatches[0];
        if (command) applyCommand(command);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const command = commandMatches[activeIndex] ?? commandMatches[0];
        if (command) setValue(`/${command.name} `);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }

    if (event.key === 'Escape' && isStreaming) {
      event.preventDefault();
      stopRun();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  const modeOptions = React.useMemo(
    () =>
      AGENT_MODES.map((value_) => ({
        value: value_,
        label: AGENT_MODE_META[value_].label,
        title: AGENT_MODE_META[value_].description,
      })),
    [],
  );

  const disabled = !data.capabilities.canRunAgent;

  return (
    <div
      className={cn(
        'relative border-t border-line bg-surface px-3 py-2.5 transition-colors duration-150',
        dragging && 'bg-primary-soft',
      )}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
      }}
    >
      {paletteOpen ? (
        <SlashPalette
          commands={commandMatches}
          activeIndex={activeIndex}
          onHover={setActiveIndex}
          onSelect={applyCommand}
          listboxId={listboxId}
        />
      ) : null}

      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 rounded-md border-2 border-dashed border-primary/60"
        />
      ) : null}

      {attachments.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 py-1 pr-1 pl-2"
            >
              {attachment.mimeType.startsWith('image/') ? (
                <img
                  src={attachment.inlineContent}
                  alt=""
                  className="size-6 rounded-sm border border-line object-cover"
                />
              ) : (
                <Paperclip aria-hidden="true" className="size-3 text-subtle" />
              )}
              <span className="max-w-40 truncate text-[11.5px] text-fg">
                {attachment.filename}
              </span>
              <span className="karo-numeric text-[10.5px] text-subtle">
                {formatBytes(attachment.sizeBytes)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-5"
                aria-label={`Remove ${attachment.filename}`}
                onClick={() =>
                  setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))
                }
              >
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="sr-only" htmlFor={`${listboxId}-input`}>
        Message the agent
      </label>
      <Textarea
        id={`${listboxId}-input`}
        ref={textareaRef}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length) {
            event.preventDefault();
            void addFiles(files);
          }
        }}
        placeholder={
          disabled
            ? 'Your role cannot run the agent in this project.'
            : 'Ask, plan or build — type / for commands'
        }
        aria-autocomplete="list"
        aria-controls={paletteOpen ? listboxId : undefined}
        aria-expanded={paletteOpen}
        aria-activedescendant={
          paletteOpen && commandMatches.length > 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        className="max-h-[260px] min-h-9 resize-none py-2"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            if (event.target.files?.length) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Attach files"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Attach code, logs or screenshots — up to {formatBytes(MAX_ATTACHMENT_BYTES)} each
          </TooltipContent>
        </Tooltip>

        <Select value={modelId ?? undefined} onValueChange={setModelId}>
          <SelectTrigger size="sm" className="w-auto min-w-40" aria-label="Model">
            <SelectValue placeholder="Choose a model" />
          </SelectTrigger>
          <SelectContent>
            {data.models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <SegmentedControl<AgentMode>
          options={modeOptions}
          value={mode}
          onValueChange={setMode}
          size="sm"
          aria-label="Agent mode"
        />

        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={contextPercent > 80 ? 'warning' : 'neutral'}
                size="sm"
                className="karo-numeric"
              >
                ≈{formatCompactNumber(tokenEstimate)} tok
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              Rough estimate of this message.{' '}
              {activeModel
                ? `${contextPercent}% of ${activeModel.displayName}'s ${formatCompactNumber(activeModel.contextWindow)}-token window.`
                : ''}
            </TooltipContent>
          </Tooltip>

          <span className="hidden text-[11px] text-subtle sm:inline">
            <Kbd>Enter</Kbd> send · <Kbd>Shift</Kbd>
            <Kbd>Enter</Kbd> newline
          </span>

          {isStreaming ? (
            <Button variant="secondary" size="sm" iconLeft={<CircleStop />} onClick={stopRun}>
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              iconLeft={<ArrowUp />}
              disabled={disabled || (!value.trim() && attachments.length === 0)}
              onClick={submit}
            >
              Send
            </Button>
          )}
        </div>
      </div>

      {phase === 'awaiting_approval' ? (
        <p className="mt-1.5 text-[11.5px] text-warning-soft-fg">
          The agent is waiting for your approval above before it continues.
        </p>
      ) : null}
    </div>
  );
}
