'use client';

import '@xterm/xterm/css/xterm.css';

import type { ITheme, Terminal } from '@xterm/xterm';
import {
  Check,
  Eraser,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  SquareTerminal,
  X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusDot, type StatusDotStatus } from '@/components/ui/dot';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { apiFetch, apiStream, describeError } from '@/lib/client/api';
import type { ShellKind } from '@/lib/db/schema';
import type { TerminalChunk } from '@/lib/sandbox/types';
import { cn } from '@/lib/utils';

import { CliAgentsDialog } from './cli-agents-dialog';
import { oklchToHex } from './monaco-theme';
import { SandboxBanner } from './sandbox-banner';
import type { WorkspaceTerminalSeed } from './types';
import { useWorkspace } from './workspace-context';

/**
 * The terminal.
 *
 * Sessions are kept mounted while the tab is hidden so switching back does not
 * lose the buffer, and the stream reconnects with backoff instead of dying on
 * the first dropped connection — a build that takes four minutes must survive a
 * laptop lid.
 */

const FALLBACK_THEME: ITheme = {
  background: '#080705',
  foreground: '#eae9e6',
  cursor: '#54d2a8',
  cursorAccent: '#080705',
  selectionBackground: 'rgba(84, 210, 168, 0.28)',
  black: '#2a2825',
  red: '#f55f5e',
  green: '#72cf8e',
  yellow: '#eebb58',
  blue: '#65afeb',
  magenta: '#da89d7',
  cyan: '#54d2a8',
  white: '#d3d1cd',
  brightBlack: '#7b7974',
  brightRed: '#f9807f',
  brightGreen: '#93dda9',
  brightYellow: '#f5cd7f',
  brightBlue: '#8bc4f1',
  brightMagenta: '#e6a6e3',
  brightCyan: '#7fe0c0',
  brightWhite: '#f4f3f1',
};

function readTerminalTheme(): ITheme {
  if (typeof window === 'undefined') return FALLBACK_THEME;
  const styles = window.getComputedStyle(document.documentElement);
  const pick = (token: string, fallback: string) =>
    oklchToHex(styles.getPropertyValue(token).trim()) ?? fallback;

  const primary = pick('--k-primary', FALLBACK_THEME.cursor ?? '#54d2a8');
  return {
    ...FALLBACK_THEME,
    background: pick('--k-term-bg', FALLBACK_THEME.background ?? '#080705'),
    foreground: pick('--k-term-fg', FALLBACK_THEME.foreground ?? '#eae9e6'),
    cursor: primary,
    cursorAccent: pick('--k-term-bg', FALLBACK_THEME.cursorAccent ?? '#080705'),
    red: pick('--k-danger', FALLBACK_THEME.red ?? '#f55f5e'),
    green: pick('--k-success', FALLBACK_THEME.green ?? '#72cf8e'),
    yellow: pick('--k-warning', FALLBACK_THEME.yellow ?? '#eebb58'),
    blue: pick('--k-info', FALLBACK_THEME.blue ?? '#65afeb'),
    magenta: pick('--k-chart-4', FALLBACK_THEME.magenta ?? '#da89d7'),
    cyan: primary,
    brightBlack: pick('--k-fg-subtle', FALLBACK_THEME.brightBlack ?? '#7b7974'),
  };
}

type SessionState = {
  id: string;
  title: string;
  shell: ShellKind;
  cwd: string;
  scrollback: string;
  history: string[];
  status: 'connecting' | 'running' | 'idle' | 'reconnecting' | 'exited' | 'error';
  exitCode: number | null;
};

const STATUS_DOT: Record<SessionState['status'], StatusDotStatus> = {
  connecting: 'pending',
  running: 'live',
  idle: 'idle',
  reconnecting: 'pending',
  exited: 'off',
  error: 'error',
};

function seedToSession(seed: WorkspaceTerminalSeed): SessionState {
  return {
    id: seed.id,
    title: seed.title,
    shell: seed.shell,
    cwd: seed.cwd,
    scrollback: seed.scrollback,
    history: seed.history,
    status: 'connecting',
    exitCode: null,
  };
}

/* ------------------------------------------------------------------ *
 *  One live terminal
 * ------------------------------------------------------------------ */

function TerminalView({
  session,
  active,
  onStatus,
  onExit,
  injected,
}: {
  session: SessionState;
  active: boolean;
  onStatus: (id: string, status: SessionState['status']) => void;
  onExit: (id: string, code: number) => void;
  injected: { command: string; nonce: number } | null;
}) {
  const { resolvedTheme } = useTheme();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const fitRef = React.useRef<{ fit: () => void } | null>(null);
  const searchRef = React.useRef<{
    findNext: (term: string) => boolean;
    findPrevious: (term: string) => boolean;
  } | null>(null);
  const queueRef = React.useRef<string>('');
  const flushTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineRef = React.useRef('');
  const historyRef = React.useRef<string[]>(session.history);
  const historyIndex = React.useRef(-1);
  const [ready, setReady] = React.useState(false);
  const [searching, setSearching] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const sessionId = session.id;

  const send = React.useCallback(
    (data: string) => {
      queueRef.current += data;
      if (flushTimer.current) return;
      flushTimer.current = setTimeout(() => {
        const payload = queueRef.current;
        queueRef.current = '';
        flushTimer.current = null;
        if (!payload) return;
        void apiFetch(`/api/terminal/${sessionId}/input`, { json: { data: payload } }).catch(
          () => {
            termRef.current?.writeln(
              '\r\n\x1b[31mInput was not delivered — reconnecting…\x1b[0m',
            );
          },
        );
      }, 16);
    },
    [sessionId],
  );

  /* ---- Boot xterm ---- */
  React.useEffect(() => {
    let disposed = false;
    let term: Terminal | null = null;

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }, { WebLinksAddon }, { SearchAddon }] =
        await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
          import('@xterm/addon-web-links'),
          import('@xterm/addon-search'),
        ]);
      if (disposed || !containerRef.current) return;

      term = new XTerm({
        allowProposedApi: true,
        cursorBlink: true,
        convertEol: true,
        fontFamily:
          'var(--font-jetbrains-mono), ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 12.5,
        lineHeight: 1.35,
        scrollback: 8000,
        theme: readTerminalTheme(),
      });

      const fit = new FitAddon();
      const search = new SearchAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.loadAddon(search);
      term.open(containerRef.current);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;
      searchRef.current = search;

      if (session.scrollback) term.write(session.scrollback);

      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true;
        const mod = event.ctrlKey || event.metaKey;
        if (mod && event.shiftKey && event.key.toLowerCase() === 'c') {
          const selection = term?.getSelection();
          if (selection) void navigator.clipboard?.writeText(selection);
          return false;
        }
        if (mod && event.shiftKey && event.key.toLowerCase() === 'v') {
          void navigator.clipboard?.readText().then((text) => text && send(text));
          return false;
        }
        if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
          setSearching(true);
          return false;
        }
        return true;
      });

      term.onData((data) => {
        // Arrow keys drive a client-side history ring: the sandbox shell is not
        // guaranteed to be a readline-backed PTY, so Karo owns recall.
        if (data === '\x1b[A' || data === '\x1b[B') {
          const list = historyRef.current;
          if (list.length === 0) return;
          if (data === '\x1b[A') {
            historyIndex.current =
              historyIndex.current < 0
                ? list.length - 1
                : Math.max(0, historyIndex.current - 1);
          } else {
            historyIndex.current =
              historyIndex.current < 0
                ? -1
                : Math.min(list.length - 1, historyIndex.current + 1);
          }
          const entry = historyIndex.current >= 0 ? (list[historyIndex.current] ?? '') : '';
          lineRef.current = entry;
          send(`\x15${entry}`);
          return;
        }

        if (data === '\x03') {
          lineRef.current = '';
          historyIndex.current = -1;
          void apiFetch(`/api/terminal/${sessionId}/kill`, { json: {} }).catch(() => {
            /* The SIGINT byte below is the fallback. */
          });
          send('\x03');
          return;
        }

        if (data === '\r') {
          const line = lineRef.current.trim();
          if (line) {
            historyRef.current = [
              ...historyRef.current.filter((item) => item !== line),
              line,
            ].slice(-200);
          }
          historyIndex.current = -1;
          lineRef.current = '';
          send('\r');
          return;
        }

        if (data === '\x7f') {
          lineRef.current = lineRef.current.slice(0, -1);
          send(data);
          return;
        }

        if (data >= ' ') lineRef.current += data;
        send(data);
      });

      setReady(true);
    })();

    return () => {
      disposed = true;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      term?.dispose();
      termRef.current = null;
    };
    // Boot exactly once per session id — everything else is handled by effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /* ---- Theme flips ---- */
  React.useEffect(() => {
    if (termRef.current) termRef.current.options.theme = readTerminalTheme();
  }, [resolvedTheme]);

  /* ---- Fit + report size ---- */
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node || !ready || typeof ResizeObserver === 'undefined') return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {
          return;
        }
        const term = termRef.current;
        if (!term) return;
        void apiFetch(`/api/terminal/${sessionId}/resize`, {
          json: { cols: term.cols, rows: term.rows },
        }).catch(() => {
          /* A missed resize only costs wrapping; do not interrupt the user. */
        });
      }, 120);
    });
    observer.observe(node);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [ready, sessionId]);

  React.useEffect(() => {
    if (active && ready) {
      try {
        fitRef.current?.fit();
      } catch {
        /* The pane may be zero-sized mid-transition. */
      }
      termRef.current?.focus();
    }
  }, [active, ready]);

  /* ---- Stream with backoff ---- */
  React.useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      controller = new AbortController();
      onStatus(sessionId, attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        await apiStream<TerminalChunk>(
          `/api/terminal/${sessionId}/stream`,
          { method: 'GET', signal: controller.signal },
          (chunk) => {
            const term = termRef.current;
            if (!term) return;
            if (chunk.type === 'stdout' || chunk.type === 'stderr') {
              attempt = 0;
              term.write(chunk.data);
              onStatus(sessionId, 'running');
            } else if (chunk.type === 'exit') {
              term.writeln(`\r\n\x1b[90m[process exited with code ${chunk.exitCode}]\x1b[0m`);
              onExit(sessionId, chunk.exitCode);
            } else if (chunk.type === 'status') {
              onStatus(sessionId, chunk.status === 'running' ? 'running' : 'idle');
              if (chunk.message) {
                term.writeln(`\r\n\x1b[90m${chunk.message}\x1b[0m`);
              }
            } else if (chunk.type === 'error') {
              term.writeln(`\r\n\x1b[31m${chunk.message}\x1b[0m`);
              onStatus(sessionId, 'error');
            }
          },
        );
        if (cancelled) return;
        // A clean end of stream still means the shell is gone; reattach.
        throw new Error('stream ended');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        attempt += 1;
        onStatus(sessionId, 'reconnecting');
        const delay = Math.min(15_000, 1000 * 2 ** Math.min(attempt - 1, 4));
        if (attempt === 1) {
          termRef.current?.writeln(
            `\r\n\x1b[33mConnection lost — reconnecting in ${Math.round(delay / 1000)}s…\x1b[0m`,
          );
        }
        retryTimer = setTimeout(() => {
          if (!cancelled) void connect();
        }, delay);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [onExit, onStatus, ready, sessionId]);

  /* ---- Injected commands from /test, /lint, the preview tab, … ---- */
  const lastInjected = React.useRef(0);
  React.useEffect(() => {
    if (!injected || !ready || !active) return;
    if (injected.nonce === lastInjected.current) return;
    lastInjected.current = injected.nonce;
    lineRef.current = '';
    historyRef.current = [
      ...historyRef.current.filter((item) => item !== injected.command),
      injected.command,
    ].slice(-200);
    send(`${injected.command}\r`);
  }, [active, injected, ready, send]);

  return (
    <div className={cn('flex h-full min-h-0 flex-col', !active && 'hidden')}>
      {searching ? (
        <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-2 py-1.5">
          <Search aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
          <label className="sr-only" htmlFor={`term-search-${sessionId}`}>
            Search terminal output
          </label>
          <Input
            id={`term-search-${sessionId}`}
            autoFocus
            inputSize="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (event.shiftKey) searchRef.current?.findPrevious(query);
                else searchRef.current?.findNext(query);
              }
              if (event.key === 'Escape') setSearching(false);
            }}
            placeholder="Find in output"
            className="max-w-64"
          />
          <Button
            size="xs"
            variant="ghost"
            onClick={() => searchRef.current?.findPrevious(query)}
          >
            Previous
          </Button>
          <Button size="xs" variant="ghost" onClick={() => searchRef.current?.findNext(query)}>
            Next
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            aria-label="Close search"
            onClick={() => setSearching(false)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}

      <div className="karo-terminal min-h-0 flex-1 bg-term-bg">
        <div ref={containerRef} className="size-full" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Tab strip
 * ------------------------------------------------------------------ */

const SHELL_LABEL: Record<ShellKind, string> = {
  bash: 'Bash',
  sh: 'sh',
  powershell: 'PowerShell',
  cmd: 'Command Prompt',
};

export function TerminalPanel() {
  const { data, sandbox, terminalRequest, notify } = useWorkspace();

  const [sessions, setSessions] = React.useState<SessionState[]>(() =>
    data.terminals.map(seedToSession),
  );
  const [activeId, setActiveId] = React.useState<string | null>(data.terminals[0]?.id ?? null);
  const [shell, setShell] = React.useState<ShellKind>(data.project.defaultShell);
  const [creating, setCreating] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [cliDialogOpen, setCliDialogOpen] = React.useState(false);
  // A command queued for a specific session, created for it — the CLI-agents
  // installer "types" into the session it just opened once the pty is ready.
  const [pendingInject, setPendingInject] = React.useState<{
    sessionId: string;
    command: string;
    nonce: number;
  } | null>(null);

  const canUse = data.capabilities.canUseTerminal;
  const running = sandbox?.status === 'running';

  const onStatus = React.useCallback((id: string, status: SessionState['status']) => {
    setSessions((prev) =>
      prev.map((session) => (session.id === id ? { ...session, status } : session)),
    );
  }, []);

  const onExit = React.useCallback((id: string, code: number) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === id ? { ...session, status: 'exited', exitCode: code } : session,
      ),
    );
  }, []);

  const createSession = React.useCallback(
    async (options?: { title?: string; command?: string }) => {
      if (!sandbox) {
        notify('warning', 'Start a sandbox first.', 'A terminal needs a running machine.');
        return;
      }
      setCreating(true);
      try {
        const payload = await apiFetch<{ sessionId: string; title?: string }>('/api/terminal', {
          json: {
            sandboxId: sandbox.id,
            projectId: data.project.id,
            shell,
            cols: 100,
            rows: 28,
            ...(options?.title ? { title: options.title } : {}),
          },
        });
        const session: SessionState = {
          id: payload.sessionId,
          title:
            payload.title ?? options?.title ?? `${SHELL_LABEL[shell]} ${sessions.length + 1}`,
          shell,
          cwd: '/workspace',
          scrollback: '',
          history: [],
          status: 'connecting',
          exitCode: null,
        };
        setSessions((prev) => [...prev, session]);
        setActiveId(session.id);
        if (options?.command) {
          setPendingInject((prev) => ({
            sessionId: payload.sessionId,
            command: options.command!,
            nonce: (prev?.nonce ?? 0) + 1,
          }));
        }
        return session.id;
      } catch (error) {
        notify('error', 'Could not open a terminal', describeError(error).message);
      } finally {
        setCreating(false);
      }
    },
    [data.project.id, notify, sandbox, sessions.length, shell],
  );

  const closeSession = React.useCallback((id: string) => {
    void apiFetch(`/api/terminal/${id}/kill`, { json: {} }).catch(() => {
      /* Closing the tab locally is what the user asked for either way. */
    });
    setSessions((prev) => {
      const next = prev.filter((session) => session.id !== id);
      setActiveId((current) =>
        current === id ? (next[next.length - 1]?.id ?? null) : current,
      );
      return next;
    });
    setPendingInject((prev) => (prev?.sessionId === id ? null : prev));
  }, []);

  /** Opens a dedicated, titled session and "types" the command into it. */
  const sendToTerminal = React.useCallback(
    (title: string, command: string) => {
      void createSession({ title, command });
    },
    [createSession],
  );

  // Open the first terminal automatically once there is a machine to run it on.
  // The request is started from a microtask rather than from the effect body,
  // because createSession flips the `creating` flag and doing that synchronously
  // inside an effect is the cascading-render pattern React warns about. The
  // teardown cancels a request that has not started yet, so an effect that is
  // torn down in the same tick does not leave a terminal nobody asked for.
  React.useEffect(() => {
    if (sessions.length > 0 || creating || !running || !canUse) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      return createSession();
    });
    return () => {
      cancelled = true;
    };
    // Only react to the machine becoming available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, canUse]);

  if (!canUse) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={SquareTerminal}
          title="Terminals are not available to your role"
          description="Running shell commands needs the Developer role or above. Ask a team admin to change your role."
        />
      </div>
    );
  }

  const availableShells = data.shells;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-surface px-1.5 py-1">
        <div
          role="tablist"
          aria-label="Terminal sessions"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5"
        >
          {sessions.map((session) => {
            const isActive = session.id === activeId;
            const renaming = renamingId === session.id;
            return (
              <div
                key={session.id}
                className={cn(
                  'group/term flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1',
                  isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60',
                )}
              >
                <StatusDot status={STATUS_DOT[session.status]} size="sm" label={null} />
                {renaming ? (
                  <>
                    <Input
                      autoFocus
                      inputSize="sm"
                      className="h-6 w-32"
                      value={draft}
                      aria-label="Terminal name"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          setSessions((prev) =>
                            prev.map((item) =>
                              item.id === session.id
                                ? { ...item, title: draft.trim() || item.title }
                                : item,
                            ),
                          );
                          setRenamingId(null);
                        }
                        if (event.key === 'Escape') setRenamingId(null);
                      }}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="size-5"
                      aria-label="Save name"
                      onClick={() => {
                        setSessions((prev) =>
                          prev.map((item) =>
                            item.id === session.id
                              ? { ...item, title: draft.trim() || item.title }
                              : item,
                          ),
                        );
                        setRenamingId(null);
                      }}
                    >
                      <Check className="size-3" />
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveId(session.id)}
                      onDoubleClick={() => {
                        setDraft(session.title);
                        setRenamingId(session.id);
                      }}
                      className="rounded-sm text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {session.title}
                    </button>
                    {session.status === 'reconnecting' ? (
                      <Badge variant="warning" size="sm">
                        Reconnecting…
                      </Badge>
                    ) : session.status === 'exited' ? (
                      <Badge variant="neutral" size="sm" className="karo-numeric">
                        exit {session.exitCode ?? 0}
                      </Badge>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="size-5 opacity-0 group-hover/term:opacity-100 focus-visible:opacity-100"
                      aria-label={`Rename ${session.title}`}
                      onClick={() => {
                        setDraft(session.title);
                        setRenamingId(session.id);
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="size-5 opacity-0 group-hover/term:opacity-100 focus-visible:opacity-100"
                      aria-label={`Close ${session.title}`}
                      onClick={() => closeSession(session.id)}
                    >
                      <X className="size-3" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-[12px]"
                disabled={!running}
                onClick={() => setCliDialogOpen(true)}
              >
                <PackagePlus className="size-3.5" />
                CLI agents
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Install Claude Code, Codex, Gemini CLI and friends into this sandbox
            </TooltipContent>
          </Tooltip>

          <Select value={shell} onValueChange={(value) => setShell(value as ShellKind)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Shell">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableShells.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={!option.available}
                >
                  {option.label}
                  {!option.available ? (
                    <span className="ml-1.5 text-[11px] text-subtle">— {option.reason}</span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="New terminal"
                loading={creating}
                disabled={!running}
                onClick={() => void createSession()}
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {running ? 'Open another shell' : 'Start the sandbox to open a shell'}
            </TooltipContent>
          </Tooltip>

          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Clear terminal"
            onClick={() => {
              const node = document.querySelector<HTMLElement>('[data-terminal-active="true"]');
              node?.dispatchEvent(new CustomEvent('karo-terminal-clear', { bubbles: true }));
            }}
          >
            <Eraser className="size-3.5" />
          </Button>
        </div>
      </div>

      {!running ? (
        <div className="p-3">
          <SandboxBanner />
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={SquareTerminal}
              title="No terminal open"
              description={
                running
                  ? 'Open a shell to run commands directly on the sandbox. Everything you run here is metered as compute.'
                  : 'Start the sandbox and Karo will open a shell for you.'
              }
              action={
                <Button
                  size="sm"
                  loading={creating}
                  disabled={!running}
                  onClick={() => void createSession()}
                >
                  Open a terminal
                </Button>
              }
            />
          </div>
        ) : (
          sessions.map((session) => {
            const queued = pendingInject?.sessionId === session.id ? pendingInject : null;
            return (
              <TerminalView
                key={session.id}
                session={session}
                active={session.id === activeId}
                onStatus={onStatus}
                onExit={onExit}
                injected={queued ?? (session.id === activeId ? terminalRequest : null)}
              />
            );
          })
        )}
      </div>

      <CliAgentsDialog
        open={cliDialogOpen}
        onOpenChange={setCliDialogOpen}
        sandboxId={sandbox?.id ?? null}
        sandboxRunning={running}
        onSendToTerminal={sendToTerminal}
      />
    </div>
  );
}
