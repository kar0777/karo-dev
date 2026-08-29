'use client';

import {
  Check,
  ChevronRight,
  Code2,
  CornerDownLeft,
  File,
  Folder,
  Globe,
  MessageSquare,
  Pause,
  Play,
  Terminal,
  Wrench,
} from 'lucide-react';
import * as React from 'react';

import { StatusDot } from '@/components/ui/dot';
import { applyMargin } from '@/lib/pricing/calculator';
import {
  calculateUpstreamCostMicroUsd,
  calculateWeightedTokens,
  type TokenPrices,
} from '@/lib/pricing/weighted-tokens';
import { cn, formatMicroUsd, formatNumber } from '@/lib/utils';

/* ------------------------------------------------------------------ *
 *  Miniature Karo workspace
 *
 *  A scripted loop of one real interaction: the user asks for rate
 *  limiting on the login route, the agent replies, runs the test suite
 *  in its sandbox, and produces a diff for review.
 *
 *  The whole animation is a *pure function of elapsed time*
 *  (`computeFrame`). One interval advances a single number; every pane
 *  derives from it. That makes the reduced-motion case trivial — render
 *  `computeFrame(FINAL_MS)` once and never start the timer — and means
 *  pausing cannot leave the panes in inconsistent states.
 * ------------------------------------------------------------------ */

type Tab = 'chat' | 'code' | 'terminal' | 'preview';

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Code2 }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'preview', label: 'Preview', icon: Globe },
];

const PROMPT = 'Add rate limiting to the login route';

const REPLY_A =
  "I'll add a fixed-window limiter keyed by IP and email, wire it into the login handler, and prove it with a burst test before anything is written.";

const REPLY_B =
  'Done — the sixth attempt inside 60 seconds now returns 429 with a Retry-After header. The diff is in the Code tab; nothing touches your project until you approve it.';

const TOKENS_A = REPLY_A.match(/\S+\s*/g) ?? [];
const TOKENS_B = REPLY_B.match(/\S+\s*/g) ?? [];

type TerminalLine = { kind: 'cmd' | 'out' | 'ok' | 'dim'; text: string };

const TERMINAL_LINES: readonly TerminalLine[] = [
  { kind: 'cmd', text: 'npm test -- rate-limit' },
  { kind: 'dim', text: '' },
  { kind: 'dim', text: '> karo@0.1.0 test' },
  { kind: 'dim', text: '> vitest run rate-limit' },
  { kind: 'dim', text: '' },
  { kind: 'ok', text: ' ✓ tests/unit/rate-limit.test.ts (7 tests) 214ms' },
  { kind: 'out', text: '   ✓ allows five attempts inside the window' },
  { kind: 'out', text: '   ✓ blocks the sixth attempt with 429' },
  { kind: 'out', text: '   ✓ sets Retry-After from the window remainder' },
  { kind: 'dim', text: '' },
  { kind: 'ok', text: ' Test Files  1 passed (1)' },
  { kind: 'ok', text: '      Tests  7 passed (7)' },
  { kind: 'dim', text: '   Duration  1.42s' },
];

type DiffLine = { kind: 'meta' | 'ctx' | 'add' | 'del'; text: string };

const DIFF_LINES: readonly DiffLine[] = [
  { kind: 'meta', text: '@@ -1,12 +1,15 @@' },
  { kind: 'ctx', text: "import { defineHandler } from '@/lib/api/handler';" },
  { kind: 'add', text: "import { RATE_LIMITS } from '@/lib/rate-limit';" },
  { kind: 'ctx', text: "import { loginSchema } from './schema';" },
  { kind: 'ctx', text: '' },
  { kind: 'ctx', text: 'export const POST = defineHandler(' },
  { kind: 'ctx', text: '  {' },
  { kind: 'ctx', text: "    auth: 'none'," },
  { kind: 'del', text: '    rateLimit: false,' },
  { kind: 'add', text: "    rateLimit: RATE_LIMITS['auth.login']," },
  { kind: 'ctx', text: '    body: loginSchema,' },
  { kind: 'ctx', text: '  },' },
  { kind: 'ctx', text: '  async ({ body, req }) => signIn(body, req),' },
  { kind: 'ctx', text: ');' },
];

type TreeNode = {
  depth: number;
  name: string;
  dir?: boolean;
  state?: 'active' | 'modified' | 'added';
};

const FILE_TREE: readonly TreeNode[] = [
  { depth: 0, name: 'src', dir: true },
  { depth: 1, name: 'app/api/auth/login', dir: true },
  { depth: 2, name: 'route.ts', state: 'active' },
  { depth: 1, name: 'lib', dir: true },
  { depth: 2, name: 'rate-limit.ts', state: 'modified' },
  { depth: 2, name: 'api/handler.ts' },
  { depth: 0, name: 'tests/unit', dir: true },
  { depth: 1, name: 'rate-limit.test.ts', state: 'added' },
  { depth: 0, name: 'package.json' },
];

/** Token counts the run finishes on. The rail ramps up to these. */
const FINAL_TOKENS = { input: 14_820, output: 1_240, cached: 9_400 } as const;

/**
 * Fallback price sheet, used only when the landing page could not read the
 * catalogue.
 *
 * These are the seeded Qwen3-Coder-480B numbers ($1.00 in / $1.50 out per Mtok),
 * matching `DEFAULT_MODEL_SLUG` — the model a new user actually gets. It is not
 * derived from the seed constant on purpose: this is a Client Component, and
 * importing the seed module would pull the Drizzle schema into the browser
 * bundle. Keep it in step with `MODEL_PRICE_SEEDS[DEFAULT_MODEL_SLUG]` by hand.
 */
const FALLBACK_PRICES: TokenPrices = {
  inputMicroUsdPerMtok: 1_000_000,
  outputMicroUsdPerMtok: 1_500_000,
  cachedInputMicroUsdPerMtok: 1_000_000,
  cacheWriteMicroUsdPerMtok: 1_000_000,
};

/* ---- Timeline (ms) ------------------------------------------------- */
const T = {
  typeStart: 400,
  typeEnd: 2_500,
  send: 2_700,
  replyAStart: 3_200,
  replyAEnd: 5_600,
  toolShow: 5_800,
  toolExpand: 6_200,
  terminalTab: 6_600,
  terminalStart: 6_800,
  terminalEnd: 9_600,
  toolDone: 9_800,
  codeTab: 10_200,
  diffStart: 10_400,
  diffEnd: 12_200,
  chatTab: 13_000,
  replyBStart: 13_200,
  replyBEnd: 15_200,
  loop: 18_000,
} as const;

const TICK_MS = 60;
const FINAL_MS = 16_500;

function ramp(t: number, from: number, to: number): number {
  if (t <= from) return 0;
  if (t >= to) return 1;
  return (t - from) / (to - from);
}

type Frame = {
  tab: Tab;
  composer: string;
  caret: boolean;
  sent: boolean;
  thinking: boolean;
  replyA: string;
  replyB: string;
  toolVisible: boolean;
  toolExpanded: boolean;
  toolDone: boolean;
  terminalLines: number;
  diffLines: number;
  progress: number;
  tokens: { input: number; output: number; cached: number };
  seconds: number;
};

function computeFrame(t: number): Frame {
  const sent = t >= T.send;
  const typed = Math.round(ramp(t, T.typeStart, T.typeEnd) * PROMPT.length);

  const scriptTab: Tab =
    t >= T.chatTab
      ? 'chat'
      : t >= T.codeTab
        ? 'code'
        : t >= T.terminalTab
          ? 'terminal'
          : 'chat';

  const run = ramp(t, T.replyAStart, T.toolDone);

  return {
    tab: scriptTab,
    composer: sent ? '' : PROMPT.slice(0, typed),
    caret: !sent,
    sent,
    thinking: sent && t < T.replyAStart,
    replyA: TOKENS_A.slice(
      0,
      Math.round(ramp(t, T.replyAStart, T.replyAEnd) * TOKENS_A.length),
    ).join(''),
    replyB: TOKENS_B.slice(
      0,
      Math.round(ramp(t, T.replyBStart, T.replyBEnd) * TOKENS_B.length),
    ).join(''),
    toolVisible: t >= T.toolShow,
    toolExpanded: t >= T.toolExpand,
    toolDone: t >= T.toolDone,
    terminalLines: Math.round(ramp(t, T.terminalStart, T.terminalEnd) * TERMINAL_LINES.length),
    diffLines: Math.round(ramp(t, T.diffStart, T.diffEnd) * DIFF_LINES.length),
    progress: Math.min(1, t / T.loop),
    tokens: {
      input: Math.round(FINAL_TOKENS.input * run),
      output: Math.round(FINAL_TOKENS.output * ramp(t, T.replyAStart, T.replyBEnd)),
      cached: Math.round(FINAL_TOKENS.cached * run),
    },
    seconds: Math.max(0, (t - T.send) / 1000),
  };
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

/** SSR renders the animated first frame; reduced-motion clients swap to the final one. */
function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

export type WorkspaceDemoProps = {
  /** Name of the model shown in the telemetry rail. */
  modelName?: string;
  /** Live catalogue price sheet, so the cost readout is not invented. */
  prices?: TokenPrices;
  className?: string;
};

export function WorkspaceDemo({
  modelName = 'Qwen3 Coder 480B',
  prices,
  className,
}: WorkspaceDemoProps) {
  const reduced = usePrefersReducedMotion();
  const [elapsed, setElapsed] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [manualTab, setManualTab] = React.useState<Tab | null>(null);
  const clock = React.useRef(0);

  React.useEffect(() => {
    if (paused || reduced) return;
    const id = window.setInterval(() => {
      const next = clock.current + TICK_MS;
      if (next >= T.loop) {
        clock.current = 0;
        // A tab the visitor picked applies to the current pass only.
        setManualTab(null);
      } else {
        clock.current = next;
      }
      setElapsed(clock.current);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [paused, reduced]);

  const frame = React.useMemo(
    () => computeFrame(reduced ? FINAL_MS : elapsed),
    [reduced, elapsed],
  );
  const tab = manualTab ?? frame.tab;
  const sheet = prices ?? FALLBACK_PRICES;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-line bg-surface shadow-lg',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <StatusDot status="live" size="sm" label="Sandbox running" />
        <span className="truncate text-[12px] font-medium text-fg">karo-auth-api</span>
        <span className="hidden truncate font-mono text-[11px] text-subtle sm:inline">
          sb-3f9a · 0.25 vCPU · 512 MB
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-subtle sm:inline">
            {reduced ? 'static' : paused ? 'paused' : 'demo loop'}
          </span>
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            disabled={reduced}
            aria-label={paused ? 'Play the workspace demo' : 'Pause the workspace demo'}
            className="inline-flex size-6 items-center justify-center rounded-sm text-subtle transition-colors duration-150 ease-[var(--k-ease)] hover:bg-surface-3 hover:text-fg disabled:opacity-40"
          >
            {paused || reduced ? (
              <Play className="size-3" aria-hidden="true" />
            ) : (
              <Pause className="size-3" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div className="grid min-h-[26rem] grid-cols-1 sm:grid-cols-[9.5rem_minmax(0,1fr)] lg:grid-cols-[10rem_minmax(0,1fr)_13rem]">
        <FileRail />

        <div className="flex min-w-0 flex-col border-line sm:border-l">
          <div
            role="tablist"
            aria-label="Workspace panes"
            className="flex items-center gap-0.5 border-b border-line bg-bg-inset px-1.5"
          >
            {TABS.map((entry) => {
              const Icon = entry.icon;
              const active = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setManualTab(entry.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[12px] font-medium transition-colors duration-150 ease-[var(--k-ease)]',
                    active
                      ? 'border-primary text-fg'
                      : 'border-transparent text-subtle hover:text-fg',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {entry.label}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1">
            {tab === 'chat' ? <ChatPane frame={frame} /> : null}
            {tab === 'terminal' ? <TerminalPane frame={frame} /> : null}
            {tab === 'code' ? <CodePane frame={frame} /> : null}
            {tab === 'preview' ? <PreviewPane /> : null}
          </div>
        </div>

        <TelemetryRail frame={frame} prices={sheet} modelName={modelName} />
      </div>

      <div className="h-0.5 w-full bg-surface-2" aria-hidden="true">
        <div
          className="h-full bg-primary/60 transition-[width] duration-100 ease-linear"
          style={{ width: `${(reduced ? 1 : frame.progress) * 100}%` }}
        />
      </div>
    </div>
  );
}

function FileRail() {
  return (
    <div className="hidden flex-col gap-0.5 bg-bg-inset p-2 sm:flex">
      <p className="px-1 pb-1 text-[10px] font-semibold tracking-[0.12em] text-subtle uppercase">
        Files
      </p>
      {FILE_TREE.map((node) => (
        <div
          key={`${node.depth}-${node.name}`}
          style={{ paddingLeft: `${node.depth * 10 + 4}px` }}
          className={cn(
            'flex items-center gap-1.5 rounded-sm py-1 pr-1 font-mono text-[11px]',
            node.state === 'active' ? 'bg-surface-2 text-fg' : 'text-muted',
          )}
        >
          {node.dir ? (
            <Folder className="size-3 shrink-0 text-subtle" aria-hidden="true" />
          ) : (
            <File className="size-3 shrink-0 text-subtle" aria-hidden="true" />
          )}
          <span className="truncate">{node.name}</span>
          {node.state === 'modified' ? (
            <span className="ml-auto shrink-0 text-ember">M</span>
          ) : null}
          {node.state === 'added' ? (
            <span className="ml-auto shrink-0 text-primary">A</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ChatPane({ frame }: { frame: Frame }) {
  return (
    <div className="flex h-full min-h-[22rem] flex-col">
      <div className="flex-1 space-y-3 overflow-hidden p-3">
        {frame.sent ? (
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-lg rounded-br-sm bg-primary-soft px-3 py-2 text-[12.5px] text-primary-soft-fg">
              {PROMPT}
            </p>
          </div>
        ) : null}

        {frame.thinking ? (
          <p className="flex items-center gap-1.5 text-[12px] text-subtle">
            <span
              className="size-1.5 animate-pulse-dot rounded-full bg-primary"
              aria-hidden="true"
            />
            Reading src/app/api/auth/login/route.ts…
          </p>
        ) : null}

        {frame.replyA ? (
          <p className="max-w-[92%] text-[12.5px] leading-relaxed text-fg">
            {frame.replyA}
            {frame.replyA.length < REPLY_A.length ? (
              <span
                className="ml-px inline-block h-3.5 w-1.5 translate-y-0.5 animate-caret bg-primary"
                aria-hidden="true"
              />
            ) : null}
          </p>
        ) : null}

        {frame.toolVisible ? (
          <div className="rounded-md border border-line bg-bg-inset">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5">
              <ChevronRight
                className={cn(
                  'size-3 text-subtle transition-transform duration-200 ease-[var(--k-ease)]',
                  frame.toolExpanded && 'rotate-90',
                )}
                aria-hidden="true"
              />
              <Wrench className="size-3 text-ember" aria-hidden="true" />
              <span className="font-mono text-[11px] text-fg">run_command</span>
              <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-subtle">
                {frame.toolDone ? (
                  <>
                    <Check className="size-3 text-primary" aria-hidden="true" />
                    exit 0 · 1.42s
                  </>
                ) : (
                  <>
                    <span
                      className="size-1.5 animate-pulse-dot rounded-full bg-ember"
                      aria-hidden="true"
                    />
                    running
                  </>
                )}
              </span>
            </div>
            {frame.toolExpanded ? (
              <div className="border-t border-line px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-muted">
                <div>
                  <span className="text-subtle">command</span> npm test -- rate-limit
                </div>
                <div>
                  <span className="text-subtle">cwd</span> /workspace
                </div>
                <div>
                  <span className="text-subtle">policy</span>{' '}
                  <span className="text-primary">allow</span> · non-destructive
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {frame.replyB ? (
          <p className="max-w-[92%] text-[12.5px] leading-relaxed text-fg">{frame.replyB}</p>
        ) : null}
      </div>

      <div className="border-t border-line p-2">
        <div className="flex items-center gap-2 rounded-md border border-line bg-bg-inset px-2.5 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">
            {frame.composer || (
              <span className="text-subtle">Ask Karo to build something…</span>
            )}
            {frame.caret && frame.composer ? (
              <span
                className="ml-px inline-block h-3.5 w-1.5 translate-y-0.5 animate-caret bg-primary"
                aria-hidden="true"
              />
            ) : null}
          </span>
          <span className="hidden items-center gap-1 rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-subtle sm:inline-flex">
            build
          </span>
          <CornerDownLeft className="size-3.5 shrink-0 text-subtle" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

const TERMINAL_TONE: Record<TerminalLine['kind'], string> = {
  cmd: 'text-term-fg',
  out: 'text-term-fg/80',
  ok: 'text-primary',
  dim: 'text-term-fg/45',
};

function TerminalPane({ frame }: { frame: Frame }) {
  const visible = TERMINAL_LINES.slice(0, frame.terminalLines);
  const running = frame.terminalLines < TERMINAL_LINES.length;

  return (
    <div className="karo-terminal h-full min-h-[22rem] bg-term-bg p-3 font-mono text-[11.5px] leading-[1.65]">
      {visible.map((line, index) => (
        <div key={index} className={cn('whitespace-pre', TERMINAL_TONE[line.kind])}>
          {line.kind === 'cmd' ? (
            <>
              <span className="text-primary">karo@sandbox</span>
              <span className="text-term-fg/45">:/workspace$ </span>
              {line.text}
            </>
          ) : (
            line.text || ' '
          )}
        </div>
      ))}
      <div className="flex items-center gap-1 text-term-fg/60">
        {running ? null : (
          <>
            <span className="text-primary">karo@sandbox</span>
            <span className="text-term-fg/45">:/workspace$</span>
          </>
        )}
        <span
          className="inline-block h-3.5 w-2 animate-caret bg-term-fg/70"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

const DIFF_TONE: Record<DiffLine['kind'], string> = {
  meta: 'text-subtle',
  ctx: 'text-muted',
  add: 'bg-success-soft text-success-soft-fg',
  del: 'bg-danger-soft text-danger-soft-fg',
};

const DIFF_SIGIL: Record<DiffLine['kind'], string> = {
  meta: ' ',
  ctx: ' ',
  add: '+',
  del: '-',
};

function CodePane({ frame }: { frame: Frame }) {
  const visible = DIFF_LINES.slice(0, frame.diffLines);

  return (
    <div className="flex h-full min-h-[22rem] flex-col bg-bg-inset">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="truncate font-mono text-[11px] text-muted">
          src/app/api/auth/login/route.ts
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-subtle">
          <span className="text-success">+2</span> <span className="text-danger">-1</span> ·
          pending review
        </span>
      </div>

      <div className="flex-1 overflow-x-auto p-2 font-mono text-[11.5px] leading-[1.7]">
        {visible.length === 0 ? (
          <p className="p-3 text-[12px] text-subtle">
            Waiting for the agent to propose a change…
          </p>
        ) : null}
        {visible.map((line, index) => (
          <div key={index} className={cn('whitespace-pre px-2', DIFF_TONE[line.kind])}>
            <span className="mr-2 inline-block w-2 text-subtle">{DIFF_SIGIL[line.kind]}</span>
            {line.text || ' '}
          </div>
        ))}
      </div>

      {frame.diffLines >= DIFF_LINES.length ? (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <span className="text-[11px] text-muted">Nothing is written until you approve.</span>
          <span className="ml-auto rounded-sm bg-primary px-2 py-1 text-[11px] font-medium text-primary-fg">
            Apply
          </span>
          <span className="rounded-sm border border-line px-2 py-1 text-[11px] text-muted">
            Reject
          </span>
        </div>
      ) : null}
    </div>
  );
}

function PreviewPane() {
  return (
    <div className="flex h-full min-h-[22rem] flex-col bg-bg-inset">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="flex-1 truncate rounded-sm border border-line bg-surface px-2 py-1 font-mono text-[10.5px] text-muted">
          https://p-3f9a.preview.karo.dev/login
        </span>
        <StatusDot status="live" size="sm" label="Preview reachable" />
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[16rem] rounded-lg border border-line bg-surface p-4 shadow-sm">
          <p className="text-[13px] font-semibold text-fg">Sign in</p>
          <div className="mt-3 space-y-2">
            <div className="h-7 rounded-sm border border-line bg-bg-inset" />
            <div className="h-7 rounded-sm border border-line bg-bg-inset" />
            <div className="h-7 rounded-sm bg-primary" />
          </div>
          <p className="mt-3 rounded-sm border border-line bg-danger-soft px-2 py-1.5 font-mono text-[10px] text-danger-soft-fg">
            429 Too Many Requests · Retry-After: 41
          </p>
        </div>
      </div>
    </div>
  );
}

function TelemetryRail({
  frame,
  prices,
  modelName,
}: {
  frame: Frame;
  prices: TokenPrices;
  modelName: string;
}) {
  const counts = {
    inputTokens: frame.tokens.input,
    outputTokens: frame.tokens.output,
    cachedInputTokens: frame.tokens.cached,
  };
  const weighted = calculateWeightedTokens(counts, prices).weightedTokens;
  // Pay-as-you-go settlement: upstream cost plus the platform margin.
  const charged = applyMargin(calculateUpstreamCostMicroUsd(counts, prices), 2_000);
  const computeHours = (frame.seconds / 3600).toFixed(4);

  return (
    <aside className="hidden flex-col gap-3 border-l border-line bg-bg-inset p-3 lg:flex">
      <div>
        <p className="text-[10px] font-semibold tracking-[0.12em] text-subtle uppercase">Run</p>
        <p className="mt-1 text-[12px] font-medium text-fg">{modelName}</p>
        <p className="font-mono text-[10.5px] text-subtle">build mode · 1 tool call</p>
      </div>

      <dl className="flex flex-col gap-1.5">
        <RailRow label="Input" value={formatNumber(frame.tokens.input)} />
        <RailRow label="Output" value={formatNumber(frame.tokens.output)} />
        <RailRow label="Cached" value={formatNumber(frame.tokens.cached)} />
        <RailRow label="Weighted" value={formatNumber(weighted)} tone="primary" />
      </dl>

      <div className="rounded-md border border-line bg-surface p-2.5">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-subtle uppercase">
          Charged
        </p>
        <p className="karo-numeric mt-0.5 text-lg leading-none font-semibold text-ember">
          {formatMicroUsd(charged, { precise: true })}
        </p>
        <p className="mt-1 text-[10.5px] leading-snug text-subtle">
          Upstream cost plus 35% margin, settled per request.
        </p>
      </div>

      <dl className="flex flex-col gap-1.5">
        <RailRow label="Compute" value={`${computeHours} h`} />
        <RailRow label="Machine" value="×1.0" />
        <RailRow label="Elapsed" value={`${frame.seconds.toFixed(1)}s`} />
      </dl>

      <p className="mt-auto text-[10.5px] leading-snug text-subtle">
        Every number here is what the real workspace shows while a run is in flight.
      </p>
    </aside>
  );
}

function RailRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'primary';
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] text-subtle">{label}</dt>
      <dd
        className={cn(
          'karo-numeric text-[11.5px] font-medium',
          tone === 'primary' ? 'text-primary' : 'text-fg',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
