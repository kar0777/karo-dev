import 'server-only';

import { createParser, type EventSourceMessage } from 'eventsource-parser';

import { createLogger } from '@/lib/logger';
import { safeFetch } from '@/lib/ssrf';
import {
  type ChatContentPart,
  type CompletionChunk,
  type CompletionRequest,
  type FinishReason,
  type ModelProvider,
  ProviderError,
  providerErrorFromStatus,
  type ProviderModelInfo,
  type ProviderUsage,
  type VerifyResult,
} from '../types';
import { descriptorIsConfigured, type ProviderDescriptor } from './descriptors';
import { familyFromSlug, humanizeSlug } from './openai-compatible';

const log = createLogger('ai:anthropic-messages');

/**
 * Adapter for providers speaking the **Anthropic Messages** wire protocol.
 *
 * Two things make this a real adapter rather than an OpenAI-compatibility
 * footnote. First, Anthropic's own endpoint is not OpenAI-shaped: content is
 * block-based, tools are `tool_use`/`tool_result` blocks instead of
 * `tool_calls`, `system` is a top-level field, and usage reports cached input
 * in separate additive buckets rather than a subset of `prompt_tokens`.
 * Second, resellers fronting Claude — HyperCLI in particular — expose the same
 * Messages shape and their docs recommend it over their OpenAI surface because
 * tool calling is better on it.
 *
 * Endpoints (both take the base URL without a path):
 *   · `anthropic` — `https://api.anthropic.com`  → `POST /v1/messages`
 *   · `hypercli`  — `https://api.hypercli.com`   → `POST /v1/messages`
 *
 * Auth is `x-api-key` plus `anthropic-version: 2023-06-01`. The `/v1/models`
 * verification and listing calls additionally send a Bearer header, because
 * resellers route that endpoint through their OpenAI-style gate while Anthropic
 * itself ignores it.
 */
export class AnthropicMessagesProvider implements ModelProvider {
  readonly key: string;
  readonly displayName: string;

  private readonly descriptor: ProviderDescriptor;
  private readonly baseUrlOverride?: string;
  private readonly apiKeyOverride?: string;

  constructor(
    descriptor: ProviderDescriptor,
    options: { baseUrl?: string; apiKey?: string } = {},
  ) {
    this.descriptor = descriptor;
    this.key = descriptor.key;
    this.displayName = descriptor.displayName;
    this.baseUrlOverride = options.baseUrl;
    this.apiKeyOverride = options.apiKey;
  }

  /** Read lazily — adapters are memoised for the process lifetime. */
  private get baseUrl(): string {
    const raw =
      this.baseUrlOverride ??
      process.env[this.descriptor.baseUrlEnv] ??
      this.descriptor.defaultBaseUrl;
    return raw.replace(/\/+$/, '');
  }

  private get apiKey(): string | undefined {
    if (this.apiKeyOverride) return this.apiKeyOverride;
    if (!this.descriptor.apiKeyEnv) return undefined;
    return process.env[this.descriptor.apiKeyEnv] || undefined;
  }

  isConfigured(): boolean {
    if (this.apiKeyOverride) return true;
    return descriptorIsConfigured(this.descriptor, process.env);
  }

  /** Same trust split as the OpenAI adapter: user URLs get the SSRF guard. */
  private post(
    url: string,
    options: {
      userSupplied: boolean;
      headers: Record<string, string>;
      body: string;
      signal?: AbortSignal;
    },
  ): Promise<Response> {
    if (options.userSupplied) {
      return safeFetch(url, {
        method: 'POST',
        headers: options.headers,
        body: options.body,
        signal: options.signal ?? null,
        timeoutMs: 15 * 60_000,
        maxBytes: 64 * 1024 * 1024,
      });
    }
    return fetch(url, {
      method: 'POST',
      headers: options.headers,
      body: options.body,
      signal: options.signal,
      redirect: 'error',
    });
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const baseUrl = (request.baseUrl ?? this.baseUrl).replace(/\/+$/, '');
    const apiKey = request.apiKey ?? this.apiKey;

    if (!apiKey && this.descriptor.apiKeyEnv) {
      throw new ProviderError(
        'unauthorized',
        `No ${this.descriptor.apiKeyEnv} is configured for ${this.displayName}.`,
        { status: 401 },
      );
    }

    const response = await this.post(`${baseUrl}/v1/messages`, {
      userSupplied: request.baseUrl !== undefined,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'anthropic-version': ANTHROPIC_VERSION,
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...(request.requestId ? { 'X-Request-Id': request.requestId } : {}),
      },
      body: JSON.stringify(toAnthropicRequest(request)),
      signal: request.signal,
    }).catch((error: unknown) => {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ) {
        throw new ProviderError('cancelled', 'Request cancelled.', { status: 499 });
      }
      throw new ProviderError('unavailable', 'Could not reach the model provider.', {
        retryable: true,
        cause: error,
      });
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      log.warn('Provider returned an error', { provider: this.key, status: response.status });
      throw providerErrorFromStatus(response.status, text);
    }

    yield* parseAnthropicStream(response.body, request.signal);
  }

  async verifyCredentials(apiKey: string, baseUrl?: string): Promise<VerifyResult> {
    const url = `${(baseUrl ?? this.baseUrl).replace(/\/+$/, '')}/v1/models`;
    try {
      const headers = this.modelHeaders(apiKey);
      const response = baseUrl
        ? await safeFetch(url, { headers, timeoutMs: 15_000 })
        : await fetch(url, {
            headers,
            signal: AbortSignal.timeout(15_000),
            redirect: 'error',
          });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, detail: 'The provider rejected this key.' };
      }
      if (!response.ok) {
        return { ok: false, detail: `The provider responded with HTTP ${response.status}.` };
      }
      const payload = (await response.json()) as { data?: unknown[] };
      const modelCount = Array.isArray(payload.data) ? payload.data.length : undefined;
      return {
        ok: true,
        detail: modelCount
          ? `Connected. ${modelCount} models available.`
          : 'Connected successfully.',
        modelCount,
      };
    } catch (error) {
      return {
        ok: false,
        detail:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'The provider did not respond within 15 seconds.'
            : 'Could not reach the provider endpoint.',
      };
    }
  }

  async listModels(): Promise<ProviderModelInfo[] | null> {
    if (!this.isConfigured()) return null;
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.modelHeaders(this.apiKey),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        data?: Array<{ id?: string; display_name?: string }>;
      };
      if (!Array.isArray(payload.data)) return null;

      return payload.data
        .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
        .map((m) => ({
          slug: m.id,
          displayName: m.display_name || humanizeSlug(m.id),
          family: familyFromSlug(m.id),
          contextWindow: 0,
          maxOutputTokens: 0,
          supportsTools: true,
          supportsVision: false,
          supportsCaching: false,
          inputMicroUsdPerMtok: 0,
          outputMicroUsdPerMtok: 0,
          cachedInputMicroUsdPerMtok: 0,
          cacheWriteMicroUsdPerMtok: 0,
        }));
    } catch (error) {
      log.warn('Model listing failed', { provider: this.key, error: String(error) });
      return null;
    }
  }

  /**
   * The catalogue endpoint is shared with the resellers' OpenAI-style gate, so
   * it gets both auth headers; Anthropic itself ignores the Bearer one.
   */
  private modelHeaders(apiKey: string | undefined): Record<string, string> {
    return {
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': apiKey ?? 'not-required',
      Authorization: `Bearer ${apiKey ?? 'not-required'}`,
    };
  }
}

export const ANTHROPIC_VERSION = '2023-06-01';

/* ------------------------------------------------------------------ *
 *  Anthropic Messages wire format
 * ------------------------------------------------------------------ */

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: Array<{ type: 'text'; text: string }>;
    };

type AnthropicTurn = { role: 'user' | 'assistant'; content: AnthropicBlock[] };

/**
 * Converts Karo's internal message list into a Messages request body.
 *
 * Three conversions carry the semantics:
 *   · `system` messages become the top-level `system` string — the wire format
 *     has no system role.
 *   · Karo's `tool` results become `tool_result` blocks inside a **user** turn,
 *     which is where Anthropic requires them.
 *   · Consecutive same-role turns are merged. The agent loop emits a user
 *     question followed by tool results as separate entries; Anthropic rejects
 *     non-alternating roles.
 */
export function toAnthropicRequest(request: CompletionRequest): Record<string, unknown> {
  const system: string[] = [];
  const turns: AnthropicTurn[] = [];

  for (const message of request.messages) {
    switch (message.role) {
      case 'system':
        system.push(message.content);
        break;

      case 'user': {
        const blocks =
          typeof message.content === 'string'
            ? [textBlock(message.content)]
            : message.content.map(contentPartToBlock);
        turns.push({ role: 'user', content: blocks });
        break;
      }

      case 'assistant': {
        const blocks: AnthropicBlock[] = [];
        if (message.content) blocks.push(textBlock(message.content));
        for (const call of message.toolCalls ?? []) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: parseJsonObject(call.arguments),
          });
        }
        turns.push({ role: 'assistant', content: blocks });
        break;
      }

      case 'tool':
        turns.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.toolCallId,
              content: [{ type: 'text', text: message.content }],
            },
          ],
        });
        break;
    }
  }

  const merged = turns.reduce<AnthropicTurn[]>((acc, turn) => {
    const last = acc.at(-1);
    if (last && last.role === turn.role) last.content.push(...turn.content);
    else acc.push(turn);
    return acc;
  }, []);

  const body: Record<string, unknown> = {
    model: request.modelSlug,
    // `max_tokens` is required by the wire format, unlike Chat Completions.
    max_tokens: request.maxOutputTokens ?? 8192,
    messages: merged.map((turn) => ({
      role: turn.role,
      content: turn.content.length ? turn.content : [textBlock(' ')],
    })),
    stream: true,
  };
  if (system.length) body.system = system.join('\n\n');
  // The Messages API bounds temperature at 1; the OpenAI surface runs to 2.
  if (request.temperature !== undefined) {
    body.temperature = Math.min(Math.max(request.temperature, 0), 1);
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
    body.tool_choice = { type: 'auto' };
  }
  return body;
}

function textBlock(text: string): AnthropicBlock {
  return { type: 'text', text };
}

function contentPartToBlock(part: ChatContentPart): AnthropicBlock {
  if (part.type === 'text') return textBlock(part.text);
  return {
    type: 'image',
    source: { type: 'base64', media_type: part.mimeType, data: part.dataBase64 },
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

type AnthropicStreamEvent = {
  type?: string;
  message?: {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
    };
  };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  error?: { type?: string; message?: string };
};

/**
 * Parses an Anthropic SSE stream into Karo chunks.
 *
 * Anthropic's own usage buckets are already additive — `input_tokens` excludes
 * cache reads and writes, which arrive as their own fields — so unlike the
 * OpenAI path there is no subtraction, and every cache token is billed exactly
 * once at its own rate.
 */
export async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<CompletionChunk> {
  const queue: CompletionChunk[] = [];
  let finished = false;
  let finishReason: FinishReason = 'stop';
  let streamError: { type: string; message: string } | null = null;

  let startUsage: NonNullable<AnthropicStreamEvent['message']>['usage'] | undefined;
  let outputTokens = 0;
  let currentTool: { id: string; name: string; args: string } | null = null;

  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      let payload: AnthropicStreamEvent;
      try {
        payload = JSON.parse(event.data) as AnthropicStreamEvent;
      } catch {
        return;
      }

      switch (payload.type) {
        case 'message_start':
          startUsage = payload.message?.usage;
          if (payload.message?.usage?.output_tokens) {
            outputTokens = payload.message.usage.output_tokens;
          }
          break;

        case 'content_block_start':
          if (payload.content_block?.type === 'tool_use' && payload.content_block.id) {
            currentTool = {
              id: payload.content_block.id,
              name: payload.content_block.name ?? '',
              args: '',
            };
            queue.push({
              type: 'tool_call_start',
              id: currentTool.id,
              name: currentTool.name,
            });
          }
          break;

        case 'content_block_delta': {
          const delta = payload.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            queue.push({ type: 'text', text: delta.text });
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            queue.push({ type: 'thinking', text: delta.thinking });
          } else if (delta?.type === 'input_json_delta' && delta.partial_json && currentTool) {
            currentTool.args += delta.partial_json;
            queue.push({
              type: 'tool_call_delta',
              id: currentTool.id,
              argumentsDelta: delta.partial_json,
            });
          }
          break;
        }

        case 'content_block_stop':
          if (currentTool) {
            queue.push({
              type: 'tool_call_end',
              id: currentTool.id,
              name: currentTool.name,
              arguments: currentTool.args,
            });
            currentTool = null;
          }
          break;

        case 'message_delta':
          if (payload.delta?.stop_reason) {
            finishReason = normalizeStopReason(payload.delta.stop_reason);
          }
          if (payload.usage?.output_tokens !== undefined) {
            outputTokens = payload.usage.output_tokens;
          }
          break;

        case 'message_stop':
          finished = true;
          break;

        case 'error':
          streamError = {
            type: payload.error?.type ?? 'api_error',
            message: payload.error?.message ?? 'Unknown provider error',
          };
          finished = true;
          break;

        default:
          break; // `ping` and anything future providers add.
      }
    },
  });

  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    while (!finished) {
      if (signal?.aborted) {
        finishReason = 'error';
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      while (queue.length) yield queue.shift()!;
    }
    while (queue.length) yield queue.shift()!;
  } finally {
    reader.releaseLock();
  }

  // The parser closure mutates this; TS's control flow cannot see that and
  // narrows the read to `null`, so the post-loop read re-widens via assertion.
  const failure = streamError as { type: string; message: string } | null;
  if (failure) {
    const retryable = /overloaded|rate|capacity/i.test(failure.type);
    throw new ProviderError(
      retryable ? 'rate_limited' : 'unavailable',
      `Anthropic stream error (${failure.type}): ${failure.message}`,
      { retryable },
    );
  }

  const input = Math.max(0, startUsage?.input_tokens ?? 0);
  const usage: ProviderUsage = {
    inputTokens: input,
    outputTokens: Math.max(0, outputTokens),
    cachedInputTokens: Math.max(0, startUsage?.cache_read_input_tokens ?? 0),
    cacheWriteTokens: Math.max(0, startUsage?.cache_creation_input_tokens ?? 0),
  };
  yield { type: 'usage', usage };
  yield { type: 'done', finishReason };
}

function normalizeStopReason(raw: string): FinishReason {
  switch (raw) {
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    default: // `end_turn`, `stop_sequence`, `pause_turn`
      return 'stop';
  }
}
