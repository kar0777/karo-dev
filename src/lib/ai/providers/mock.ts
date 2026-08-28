import {
  type ChatMessage,
  type CompletionChunk,
  type CompletionRequest,
  type ModelProvider,
  type ProviderModelInfo,
  type VerifyResult,
} from '../types';

/**
 * The demo-mode model.
 *
 * This is not a toy. It drives the entire product experience when no API key is
 * configured: it plans, calls the same builtin tools the real agent calls,
 * streams token-by-token at a believable cadence, and reports usage so metering,
 * quota and billing all exercise their real code paths.
 *
 * It is deterministic given the same conversation, so Playwright can assert on
 * its output.
 */
export class MockProvider implements ModelProvider {
  readonly key = 'mock';
  readonly displayName = 'Karo Demo Model';

  isConfigured(): boolean {
    return true;
  }

  async verifyCredentials(): Promise<VerifyResult> {
    return { ok: true, detail: 'Demo provider is always available.' };
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    return [
      {
        slug: 'karo-demo-1',
        displayName: 'Karo Demo Model',
        family: 'demo',
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
        supportsTools: true,
        supportsVision: true,
        supportsCaching: true,
        inputMicroUsdPerMtok: 0,
        outputMicroUsdPerMtok: 0,
        cachedInputMicroUsdPerMtok: 0,
        cacheWriteMicroUsdPerMtok: 0,
      },
    ];
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const lastUser = lastUserText(request.messages);
    const toolResults = collectToolResults(request.messages);
    const hasTools = (request.tools?.length ?? 0) > 0;
    const turn = countAssistantTurns(request.messages);

    const script = buildScript({
      prompt: lastUser,
      hasTools,
      turn,
      toolResults,
      availableTools: new Set(request.tools?.map((t) => t.name) ?? []),
    });

    let outputChars = 0;

    for (const step of script) {
      if (request.signal?.aborted) {
        yield { type: 'done', finishReason: 'error' };
        return;
      }

      if (step.kind === 'thinking') {
        for (const piece of tokenize(step.text)) {
          if (request.signal?.aborted) break;
          await pace(8);
          yield { type: 'thinking', text: piece };
        }
        continue;
      }

      if (step.kind === 'text') {
        for (const piece of tokenize(step.text)) {
          if (request.signal?.aborted) break;
          await pace(11);
          outputChars += piece.length;
          yield { type: 'text', text: piece };
        }
        continue;
      }

      // tool call
      const args = JSON.stringify(step.args);
      yield { type: 'tool_call_start', id: step.id, name: step.name };
      for (const piece of chunkString(args, 24)) {
        await pace(6);
        yield { type: 'tool_call_delta', id: step.id, argumentsDelta: piece };
      }
      yield { type: 'tool_call_end', id: step.id, name: step.name, arguments: args };
    }

    const promptChars = request.messages.reduce((sum, m) => sum + messageLength(m), 0);
    const inputTokens = Math.max(24, Math.round(promptChars / 3.8));
    const outputTokens = Math.max(12, Math.round(outputChars / 3.8));
    // Pretend the system prompt and earlier turns were served from cache after
    // the first exchange, so the cached-token accounting path gets exercised.
    const cachedInputTokens = turn > 0 ? Math.round(inputTokens * 0.55) : 0;

    yield {
      type: 'usage',
      usage: {
        inputTokens: inputTokens - cachedInputTokens,
        outputTokens,
        cachedInputTokens,
        cacheWriteTokens: turn === 0 ? Math.round(inputTokens * 0.4) : 0,
      },
    };

    const usedTool = script.some((s) => s.kind === 'tool');
    yield { type: 'done', finishReason: usedTool ? 'tool_calls' : 'stop' };
  }
}

/* ------------------------------------------------------------------ *
 *  Script generation
 * ------------------------------------------------------------------ */

type ScriptStep =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; args: Record<string, unknown> };

type ScriptInput = {
  prompt: string;
  hasTools: boolean;
  turn: number;
  toolResults: string[];
  availableTools: Set<string>;
};

function buildScript(input: ScriptInput): ScriptStep[] {
  const { prompt, hasTools, turn, availableTools } = input;
  const intent = classify(prompt);

  // Second pass: the tools already ran, so summarise and stop.
  if (turn > 0 && input.toolResults.length > 0) {
    return [
      {
        kind: 'text',
        text: summaryFor(intent, input.toolResults),
      },
    ];
  }

  if (!hasTools || intent === 'question') {
    return [
      { kind: 'thinking', text: thinkingFor(intent, prompt) },
      { kind: 'text', text: answerFor(intent, prompt) },
    ];
  }

  const steps: ScriptStep[] = [
    { kind: 'thinking', text: thinkingFor(intent, prompt) },
    { kind: 'text', text: openerFor(intent) },
  ];

  let counter = 0;
  const nextId = () => `demo_call_${Date.now().toString(36)}_${counter++}`;

  const plan = toolPlanFor(intent);
  for (const call of plan) {
    if (!availableTools.has(call.name)) continue;
    steps.push({ kind: 'tool', id: nextId(), name: call.name, args: call.args });
  }

  if (steps.filter((s) => s.kind === 'tool').length === 0) {
    steps.push({ kind: 'text', text: answerFor(intent, prompt) });
  }

  return steps;
}

type Intent = 'website' | 'bot' | 'api' | 'fix' | 'test' | 'explore' | 'question';

function classify(prompt: string): Intent {
  const p = prompt.toLowerCase();
  if (/\b(site|website|landing|page|frontend|next\.?js|react)\b/.test(p)) return 'website';
  if (/\b(telegram|discord|bot)\b/.test(p)) return 'bot';
  if (/\b(api|endpoint|server|rest|fastapi|express)\b/.test(p)) return 'api';
  if (/\b(fix|bug|error|crash|broken|failing|debug)\b/.test(p)) return 'fix';
  if (/\b(test|spec|coverage|vitest|pytest|playwright)\b/.test(p)) return 'test';
  if (/\b(what|why|how|explain|difference|should i|which)\b/.test(p)) return 'question';
  if (/\b(look|read|show|find|search|structure|explore)\b/.test(p)) return 'explore';
  return 'website';
}

function thinkingFor(intent: Intent, prompt: string): string {
  const head = prompt.length > 90 ? `${prompt.slice(0, 90)}…` : prompt;
  const map: Record<Intent, string> = {
    website:
      `Request: "${head}". I'll check what's already in the workspace before scaffolding anything, ` +
      `so I don't overwrite existing work. Then create the page, then verify it builds.`,
    bot:
      `Request: "${head}". A bot needs a token in the environment — I'll scaffold the handler ` +
      `and read the token from env rather than hard-coding it.`,
    api:
      `Request: "${head}". I'll start from the project layout, add the route, and run the test ` +
      `suite to confirm nothing regressed.`,
    fix:
      `Request: "${head}". Reproduce first: run the failing command, read the actual error, ` +
      `then change the smallest thing that fixes it.`,
    test:
      `Request: "${head}". I'll look at the existing test setup so the new tests match the ` +
      `project's conventions instead of introducing a second style.`,
    explore: `Request: "${head}". Read the tree first, then the files that look load-bearing.`,
    question: `Request: "${head}". This is a question about approach — no changes needed.`,
  };
  return map[intent];
}

function openerFor(intent: Intent): string {
  const map: Record<Intent, string> = {
    website: `I'll scaffold the page and verify it builds. Starting with what's already here:\n\n`,
    bot: `Setting up the bot handler. First, a look at the current project:\n\n`,
    api: `I'll add the endpoint and run the tests afterwards. Checking the layout:\n\n`,
    fix: `Let me reproduce the failure before changing anything:\n\n`,
    test: `I'll match the existing test conventions. Reading what's there:\n\n`,
    explore: `Reading the workspace:\n\n`,
    question: '',
  };
  return map[intent];
}

function toolPlanFor(intent: Intent): Array<{ name: string; args: Record<string, unknown> }> {
  switch (intent) {
    case 'website':
      return [
        { name: 'list_files', args: { path: '.' } },
        {
          name: 'write_file',
          args: {
            path: 'app/page.tsx',
            content: DEMO_PAGE_SOURCE,
          },
        },
        { name: 'run_command', args: { command: 'npm run build', cwd: '.' } },
      ];
    case 'bot':
      return [
        { name: 'list_files', args: { path: '.' } },
        { name: 'write_file', args: { path: 'bot.py', content: DEMO_BOT_SOURCE } },
        { name: 'run_command', args: { command: 'python -m py_compile bot.py' } },
      ];
    case 'api':
      return [
        { name: 'list_files', args: { path: '.' } },
        {
          name: 'write_file',
          args: { path: 'src/routes/health.ts', content: DEMO_API_SOURCE },
        },
        { name: 'run_command', args: { command: 'npm test' } },
      ];
    case 'fix':
      return [
        { name: 'run_command', args: { command: 'npm test' } },
        { name: 'search_files', args: { query: 'TypeError', path: 'src' } },
      ];
    case 'test':
      return [
        { name: 'list_files', args: { path: 'tests' } },
        { name: 'run_command', args: { command: 'npx vitest run' } },
      ];
    case 'explore':
      return [
        { name: 'list_files', args: { path: '.' } },
        { name: 'read_file', args: { path: 'README.md' } },
      ];
    case 'question':
      return [];
  }
}

function answerFor(intent: Intent, prompt: string): string {
  if (intent === 'question') {
    return (
      `Short answer: it depends on how much of the work needs to persist between runs.\n\n` +
      `**If the task is one-shot** — a script, a migration, a data transform — keep it in the ` +
      `sandbox and let it exit. You only pay for the seconds it runs.\n\n` +
      `**If you need a dev server or a database** — keep the sandbox awake. Karo auto-sleeps it ` +
      `after the idle window on your plan, and wakes it on your next command in a few seconds.\n\n` +
      `You asked about: _${prompt.slice(0, 120)}_. Tell me which of those two shapes it is and ` +
      `I'll set it up.\n\n` +
      `> This is Karo's demo model. Set a provider key such as WANDB_API_KEY, or add your ` +
      `own key in ` +
      `**Settings → API keys** to run a real model.`
    );
  }
  return (
    `Here's what I'd do:\n\n` +
    `1. Read the current workspace so I don't clobber existing files.\n` +
    `2. Make the change in the smallest number of files.\n` +
    `3. Run the project's own build/test command to verify it.\n\n` +
    `> Demo mode: tool execution is simulated. Add an API key in **Settings → API keys** for ` +
    `real runs.`
  );
}

function summaryFor(intent: Intent, results: string[]): string {
  const failed = results.some((r) => /error|failed|exit code [1-9]/i.test(r));
  if (failed) {
    return (
      `That didn't pass cleanly. The output points at a missing dependency rather than a code ` +
      `problem — installing it and re-running should clear it.\n\n` +
      `Want me to install it and try again?`
    );
  }
  const map: Record<Intent, string> = {
    website: `Done. The page is created and the build passes.\n\nOpen the **Preview** tab to see it running. Next useful steps: wire up real content, or add a second route.`,
    bot: `Done. The bot handler compiles.\n\nAdd \`TELEGRAM_BOT_TOKEN\` under **Settings → Environment** and I'll start it for you.`,
    api: `Done. The endpoint is in place and the test suite is green.\n\nThe dev server is available in the **Preview** tab.`,
    fix: `Found it. The failure comes from the module being imported before it's initialised.\n\nWant me to apply the fix?`,
    test: `Tests are passing. Coverage on the new code is complete; the older modules are still uncovered if you want me to extend it.`,
    explore: `That's the shape of the project. Tell me what you want to change and I'll go straight to the relevant files.`,
    question: `Let me know if you'd like me to implement any of that.`,
  };
  return `${map[intent]}\n\n> Demo mode — results are simulated.`;
}

/* ------------------------------------------------------------------ *
 *  Streaming helpers
 * ------------------------------------------------------------------ */

/** Splits text into word-ish pieces so streaming looks like a real model. */
function tokenize(text: string): string[] {
  return text.match(/\s*\S+|\s+/g) ?? [text];
}

function chunkString(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/**
 * Deliberate pacing. Tests set `KARO_MOCK_INSTANT=1` to remove it so Playwright
 * runs are not gated on animation timing.
 */
function pace(ms: number): Promise<void> {
  if (process.env.KARO_MOCK_INSTANT === '1' || process.env.NODE_ENV === 'test') {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    return m.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join(' ');
  }
  return '';
}

function collectToolResults(messages: ChatMessage[]): string[] {
  return messages
    .filter((m) => m.role === 'tool')
    .map((m) => (m as { content: string }).content);
}

function countAssistantTurns(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === 'assistant').length;
}

function messageLength(message: ChatMessage): number {
  if (message.role === 'user' && typeof message.content !== 'string') {
    return message.content.reduce(
      (sum, part) => sum + (part.type === 'text' ? part.text.length : 800),
      0,
    );
  }
  return typeof (message as { content?: unknown }).content === 'string'
    ? ((message as { content: string }).content.length ?? 0)
    : 0;
}

/* ------------------------------------------------------------------ *
 *  Demo file contents
 * ------------------------------------------------------------------ */

const DEMO_PAGE_SOURCE = `export default function Page() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Aurora</h1>
      <p className="text-neutral-500">
        A small landing page, scaffolded by the Karo agent.
      </p>
      <a
        href="#get-started"
        className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm text-white"
      >
        Get started
      </a>
    </main>
  );
}
`;

const DEMO_BOT_SOURCE = `import os
import asyncio
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]


async def start(update: Update, _: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text("Ready. Send /help to see what I can do.")


def main() -> None:
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.run_polling()


if __name__ == "__main__":
    main()
`;

const DEMO_API_SOURCE = `import { Router } from 'express';

export const health = Router();

health.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
`;
