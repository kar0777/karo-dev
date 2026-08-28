import { describe, expect, it } from 'vitest';

import { MockProvider } from '@/lib/ai/providers/mock';
import type { ChatMessage, CompletionChunk, ToolDefinition } from '@/lib/ai/types';

const provider = new MockProvider();

const TOOLS: ToolDefinition[] = [
  { name: 'list_files', description: '', parameters: {} },
  { name: 'write_file', description: '', parameters: {} },
  { name: 'run_command', description: '', parameters: {} },
  { name: 'read_file', description: '', parameters: {} },
  { name: 'search_files', description: '', parameters: {} },
];

async function collect(
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  signal?: AbortSignal,
): Promise<CompletionChunk[]> {
  const chunks: CompletionChunk[] = [];
  for await (const chunk of provider.stream({
    modelSlug: 'karo-demo-1',
    messages,
    tools,
    signal,
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

function textOf(chunks: CompletionChunk[]): string {
  return chunks
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

function toolCalls(chunks: CompletionChunk[]) {
  return chunks.filter(
    (c): c is { type: 'tool_call_end'; id: string; name: string; arguments: string } =>
      c.type === 'tool_call_end',
  );
}

describe('provider contract', () => {
  it('is always configured — demo mode must never fail to start', () => {
    expect(provider.isConfigured()).toBe(true);
    expect(provider.key).toBe('mock');
  });

  it('verifies without a key', async () => {
    await expect(provider.verifyCredentials()).resolves.toMatchObject({ ok: true });
  });

  it('advertises a zero-priced model, so demo mode charges nothing', async () => {
    const models = await provider.listModels();
    expect(models).toHaveLength(1);
    expect(models[0]!.slug).toBe('karo-demo-1');
    expect(models[0]!.inputMicroUsdPerMtok).toBe(0);
  });
});

describe('streaming', () => {
  it('always terminates with a done chunk', async () => {
    const chunks = await collect([{ role: 'user', content: 'Explain how sandboxes work' }]);
    expect(chunks.at(-1)?.type).toBe('done');
  });

  it('emits usage before done, so metering always has numbers', async () => {
    const chunks = await collect([{ role: 'user', content: 'hello' }]);
    const usageIndex = chunks.findIndex((c) => c.type === 'usage');
    const doneIndex = chunks.findIndex((c) => c.type === 'done');
    expect(usageIndex).toBeGreaterThan(-1);
    expect(usageIndex).toBeLessThan(doneIndex);
  });

  it('reports non-zero token counts', async () => {
    const chunks = await collect([
      { role: 'user', content: 'Build me a landing page for a coffee shop' },
    ]);
    const usage = chunks.find((c) => c.type === 'usage');
    expect(usage).toBeDefined();
    if (usage?.type !== 'usage') throw new Error('unreachable');
    expect(usage.usage.inputTokens).toBeGreaterThan(0);
    expect(usage.usage.outputTokens).toBeGreaterThan(0);
  });

  it('reports cached input tokens on a follow-up turn, exercising that price path', async () => {
    const chunks = await collect([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ]);
    const usage = chunks.find((c) => c.type === 'usage');
    if (usage?.type !== 'usage') throw new Error('unreachable');
    expect(usage.usage.cachedInputTokens).toBeGreaterThan(0);
  });

  it('streams text in multiple pieces rather than one blob', async () => {
    const chunks = await collect([{ role: 'user', content: 'What is a weighted token?' }]);
    const textChunks = chunks.filter((c) => c.type === 'text');
    expect(textChunks.length).toBeGreaterThan(5);
  });

  it('emits reasoning before the answer', async () => {
    const chunks = await collect([{ role: 'user', content: 'Fix the failing test' }], TOOLS);
    const firstThinking = chunks.findIndex((c) => c.type === 'thinking');
    const firstText = chunks.findIndex((c) => c.type === 'text');
    expect(firstThinking).toBeGreaterThan(-1);
    expect(firstThinking).toBeLessThan(firstText);
  });
});

describe('tool use', () => {
  it('calls no tools when none are offered', async () => {
    const chunks = await collect([{ role: 'user', content: 'Build a website' }]);
    expect(toolCalls(chunks)).toHaveLength(0);
    const done = chunks.at(-1);
    expect(done?.type === 'done' && done.finishReason).toBe('stop');
  });

  it('calls tools when they are offered, and says so in the finish reason', async () => {
    const chunks = await collect([{ role: 'user', content: 'Build a landing page' }], TOOLS);
    const calls = toolCalls(chunks);
    expect(calls.length).toBeGreaterThan(0);
    const done = chunks.at(-1);
    expect(done?.type === 'done' && done.finishReason).toBe('tool_calls');
  });

  it('emits start, deltas and end for each call, in that order', async () => {
    const chunks = await collect([{ role: 'user', content: 'Build a landing page' }], TOOLS);
    const start = chunks.findIndex((c) => c.type === 'tool_call_start');
    const delta = chunks.findIndex((c) => c.type === 'tool_call_delta');
    const end = chunks.findIndex((c) => c.type === 'tool_call_end');
    expect(start).toBeGreaterThan(-1);
    expect(delta).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(delta);
  });

  it('produces arguments that parse as JSON', async () => {
    const chunks = await collect([{ role: 'user', content: 'Build a landing page' }], TOOLS);
    for (const call of toolCalls(chunks)) {
      expect(() => JSON.parse(call.arguments)).not.toThrow();
    }
  });

  it('reassembles the streamed deltas into exactly the final arguments', async () => {
    const chunks = await collect([{ role: 'user', content: 'Build a landing page' }], TOOLS);
    const byId = new Map<string, string>();
    for (const chunk of chunks) {
      if (chunk.type === 'tool_call_delta') {
        byId.set(chunk.id, (byId.get(chunk.id) ?? '') + chunk.argumentsDelta);
      }
    }
    for (const call of toolCalls(chunks)) {
      expect(byId.get(call.id)).toBe(call.arguments);
    }
  });

  it('only calls tools that were actually offered', async () => {
    const limited: ToolDefinition[] = [{ name: 'list_files', description: '', parameters: {} }];
    const chunks = await collect([{ role: 'user', content: 'Build a landing page' }], limited);
    for (const call of toolCalls(chunks)) {
      expect(limited.map((t) => t.name)).toContain(call.name);
    }
  });

  it('summarises instead of calling more tools once results have come back', async () => {
    const chunks = await collect(
      [
        { role: 'user', content: 'Build a landing page' },
        { role: 'assistant', content: 'Working on it' },
        { role: 'tool', toolCallId: 'c1', name: 'run_command', content: 'Build succeeded' },
      ],
      TOOLS,
    );
    expect(toolCalls(chunks)).toHaveLength(0);
    expect(textOf(chunks).length).toBeGreaterThan(20);
  });

  it('notices a failed tool result and offers a next step', async () => {
    const chunks = await collect(
      [
        { role: 'user', content: 'Run the tests' },
        { role: 'assistant', content: 'Running' },
        { role: 'tool', toolCallId: 'c1', name: 'run_command', content: 'Error: exit code 1' },
      ],
      TOOLS,
    );
    const text = textOf(chunks).toLowerCase();
    expect(text).toContain('again');
  });
});

describe('honesty about being a simulation', () => {
  it('labels its output as demo mode', async () => {
    const chunks = await collect([{ role: 'user', content: 'Which model should I use?' }]);
    expect(textOf(chunks).toLowerCase()).toContain('demo');
  });
});

describe('cancellation', () => {
  it('stops early and reports an error finish reason when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const chunks = await collect(
      [{ role: 'user', content: 'Build a landing page' }],
      TOOLS,
      controller.signal,
    );
    const done = chunks.at(-1);
    expect(done?.type).toBe('done');
    expect(done?.type === 'done' && done.finishReason).toBe('error');
  });
});

describe('determinism', () => {
  it('produces the same text for the same conversation, so E2E can assert on it', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Explain compute units' }];
    const first = textOf(await collect(messages));
    const second = textOf(await collect(messages));
    expect(first).toBe(second);
  });

  it('routes different intents to different responses', async () => {
    const website = textOf(await collect([{ role: 'user', content: 'Build me a website' }]));
    const question = textOf(
      await collect([{ role: 'user', content: 'What is the difference between plans?' }]),
    );
    expect(website).not.toBe(question);
  });
});
