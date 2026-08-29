import { describe, expect, it } from 'vitest';

import {
  parseAnthropicStream,
  toAnthropicRequest,
} from '@/lib/ai/providers/anthropic-messages';
import type { CompletionChunk } from '@/lib/ai/types';
import type { ChatMessage, CompletionRequest } from '@/lib/ai/types';

/**
 * The Messages wire protocol differs from Chat Completions in exactly the
 * places that would silently corrupt an agent run if got wrong: the system
 * prompt is a top-level field, tool results ride in user turns, roles must
 * alternate, and usage buckets are additive rather than a subset of a total.
 */

function request(
  messages: ChatMessage[],
  extra: Partial<CompletionRequest> = {},
): CompletionRequest {
  return {
    modelSlug: 'kimi-k3-anthropic',
    messages,
    ...extra,
  };
}

function sse(events: Array<{ event?: string; data: string }>): ReadableStream<Uint8Array> {
  const text = events
    .map((e) => `event: ${e.event ?? 'message'}\ndata: ${e.data}\n\n`)
    .join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<CompletionChunk[]> {
  const chunks: CompletionChunk[] = [];
  for await (const chunk of parseAnthropicStream(body)) chunks.push(chunk);
  return chunks;
}

describe('toAnthropicRequest', () => {
  it('moves system messages to the top-level system field', () => {
    const body = toAnthropicRequest(
      request([
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Hi' },
      ]),
    );

    expect(body.system).toBe('You are terse.');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }]);
  });

  it('converts tool results into tool_result blocks inside a user turn and merges roles', () => {
    const body = toAnthropicRequest(
      request([
        { role: 'user', content: 'List the files' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'list_files', arguments: '{"path":"."}' }],
        },
        { role: 'tool', toolCallId: 'call_1', name: 'list_files', content: 'a.ts\nb.ts' },
      ]),
    );

    const messages = body.messages as Array<{ role: string; content: unknown[] }>;
    expect(messages).toHaveLength(3);
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: [{ type: 'text', text: 'a.ts\nb.ts' }],
        },
      ],
    });
    expect(messages[1]?.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'list_files', input: { path: '.' } },
    ]);
  });

  it('bounds temperature at 1 and always sends a required max_tokens', () => {
    const body = toAnthropicRequest(
      request([{ role: 'user', content: 'Hi' }], { temperature: 1.7 }),
    );
    expect(body.temperature).toBe(1);
    expect(body.max_tokens).toBe(8192);
  });

  it('maps tools onto input_schema with auto tool_choice', () => {
    const body = toAnthropicRequest(
      request([{ role: 'user', content: 'Hi' }], {
        tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
      }),
    );

    expect(body.tools).toEqual([
      { name: 't', description: 'd', input_schema: { type: 'object' } },
    ]);
    expect(body.tool_choice).toEqual({ type: 'auto' });
  });
});

describe('parseAnthropicStream', () => {
  it('emits text, a complete tool call, usage buckets and a finish reason', async () => {
    const chunks = await collect(
      sse([
        {
          event: 'message_start',
          data: JSON.stringify({
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 100,
                cache_read_input_tokens: 40,
                cache_creation_input_tokens: 10,
                output_tokens: 1,
              },
            },
          }),
        },
        {
          event: 'content_block_start',
          data: JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'He' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'y' },
          }),
        },
        {
          event: 'content_block_stop',
          data: JSON.stringify({ type: 'content_block_stop', index: 0 }),
        },
        {
          event: 'content_block_start',
          data: JSON.stringify({
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'input_json_delta', partial_json: '{"path"' },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            delta: { type: 'input_json_delta', partial_json: ':"a.ts"}' },
          }),
        },
        {
          event: 'content_block_stop',
          data: JSON.stringify({ type: 'content_block_stop', index: 1 }),
        },
        {
          event: 'message_delta',
          data: JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'tool_use' },
            usage: { output_tokens: 23 },
          }),
        },
        { event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) },
      ]),
    );

    const ends = chunks.filter((c) => c.type === 'tool_call_end');
    expect(ends).toEqual([
      { type: 'tool_call_end', id: 'toolu_1', name: 'read_file', arguments: '{"path":"a.ts"}' },
    ]);
    expect(chunks.filter((c) => c.type === 'text')).toEqual([
      { type: 'text', text: 'He' },
      { type: 'text', text: 'y' },
    ]);

    const usage = chunks.find((c) => c.type === 'usage');
    // Anthropic's buckets are already additive: input excludes the cached and
    // cache-written tokens, each of which arrives as its own count.
    expect(usage).toEqual({
      type: 'usage',
      usage: {
        inputTokens: 100,
        outputTokens: 23,
        cachedInputTokens: 40,
        cacheWriteTokens: 10,
      },
    });

    expect(chunks.at(-1)).toEqual({ type: 'done', finishReason: 'tool_calls' });
  });

  it('turns a stream error event into a ProviderError', async () => {
    await expect(
      collect(
        sse([
          {
            event: 'error',
            data: JSON.stringify({
              type: 'error',
              error: { type: 'overloaded_error', message: 'Overloaded' },
            }),
          },
        ]),
      ),
    ).rejects.toThrow(/Overloaded/);
  });

  it('maps max_tokens to the length finish reason', async () => {
    const chunks = await collect(
      sse([
        {
          event: 'message_start',
          data: '{"type":"message_start","message":{"usage":{"input_tokens":5}}}',
        },
        {
          event: 'message_delta',
          data: '{"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":9}}',
        },
        { event: 'message_stop', data: '{"type":"message_stop"}' },
      ]),
    );

    expect(chunks.at(-1)).toEqual({ type: 'done', finishReason: 'length' });
  });
});
