import 'server-only';

import { createParser, type EventSourceMessage } from 'eventsource-parser';

import { createLogger } from '@/lib/logger';
import { safeFetch } from '@/lib/ssrf';
import {
  type ChatMessage,
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

const log = createLogger('ai:openai-compatible');

/**
 * One adapter for every OpenAI-compatible Chat Completions endpoint.
 *
 * W&B Inference, OpenRouter, DeepSeek, Groq, Cerebras, Z.ai, Moonshot, Omniakey
 * and a local Ollama all speak the same protocol, so they share this class and
 * differ only by their `ProviderDescriptor`. The same code path also serves BYOK
 * against an endpoint Karo has never heard of — the caller just passes
 * `apiKey`/`baseUrl` on the request.
 *
 * Credentials are read from the server environment and are **never** sent to the
 * browser. Karo exposes no pass-through proxy.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
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

  /**
   * Read lazily rather than in the constructor: adapters are memoised for the
   * process lifetime, and tests mutate `process.env` between cases.
   */
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

  /**
   * Outbound request, with the SSRF guard applied where — and only where — the
   * destination could have been chosen by a user.
   *
   * The distinction matters because the two cases have opposite requirements:
   *
   *  · **User-supplied** (`request.baseUrl` from a BYOK key, or the base URL in
   *    the "verify this key" form) is attacker-controlled. It was validated once
   *    at write time, but a plain `fetch` follows redirects, so an allowed host
   *    could 302 the control plane into RFC1918 space or at the cloud metadata
   *    endpoint. `safeFetch` re-validates every hop, which is the fix.
   *  · **Operator-supplied** (a base URL from the environment) is trusted by
   *    definition — and must stay reachable on a private address, since
   *    `OLLAMA_BASE_URL` legitimately points at `127.0.0.1`, which the guard
   *    blocks. Running it through `safeFetch` would break local models. It still
   *    gets `redirect: 'error'`: a real Chat Completions endpoint never
   *    redirects a POST, so following one is all risk and no benefit.
   */
  private async post(
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
        // A completion legitimately streams for minutes and can be large, so the
        // transport caps have to be generous. They are a runaway-response
        // backstop here, not a policy.
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

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const key = this.apiKey;
    return {
      'Content-Type': 'application/json',
      // Keyless local servers still expect the header to exist; Ollama ignores
      // the value, but omitting it entirely trips some OpenAI client shims.
      Authorization: `Bearer ${key ?? 'not-required'}`,
      ...this.descriptor.extraHeaders,
      ...extra,
    };
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

    const body: Record<string, unknown> = {
      model: request.modelSlug,
      messages: toOpenAiMessages(request.messages),
      stream: true,
      // Ask for usage on the final SSE frame. Supported by every provider Karo
      // ships; harmless on ones that ignore it. Without it, metering would have
      // to estimate token counts instead of recording them.
      stream_options: { include_usage: true },
    };

    // Kimi K2.x/K3 fix temperature internally and document that it must not be
    // passed; sending it is rejected rather than ignored.
    if (request.temperature !== undefined && !this.descriptor.quirks?.omitTemperature) {
      body.temperature = request.temperature;
    }

    if (request.maxOutputTokens !== undefined) {
      // Moonshot deprecated `max_tokens` in favour of `max_completion_tokens`.
      if (this.descriptor.quirks?.useMaxCompletionTokens) {
        body.max_completion_tokens = request.maxOutputTokens;
      } else {
        body.max_tokens = request.maxOutputTokens;
      }
    }

    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
      // 'auto' rather than 'required': some cheap coding models (Kimi k2.7-code,
      // k2.6) implement only auto|none and reject 'required'. Ollama implements
      // none of it, so the field is omitted there entirely.
      if (!this.descriptor.quirks?.omitToolChoice) body.tool_choice = 'auto';
    }

    let response: Response;
    try {
      response = await this.post(`${baseUrl}/chat/completions`, {
        userSupplied: request.baseUrl !== undefined,
        headers: this.headers({
          Accept: 'text/event-stream',
          ...(request.apiKey ? { Authorization: `Bearer ${request.apiKey}` } : {}),
          ...(request.requestId ? { 'X-Request-Id': request.requestId } : {}),
        }),
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      if (isAbort(error))
        throw new ProviderError('cancelled', 'Request cancelled.', { status: 499 });
      throw new ProviderError('unavailable', 'Could not reach the model provider.', {
        retryable: true,
        cause: error,
      });
    }

    if (!response.ok || !response.body) {
      const text = await safeText(response);
      log.warn('Provider returned an error', {
        provider: this.key,
        status: response.status,
      });
      throw providerErrorFromStatus(response.status, text);
    }

    yield* parseOpenAiStream(response.body, request.signal);
  }

  async verifyCredentials(apiKey: string, baseUrl?: string): Promise<VerifyResult> {
    const url = `${(baseUrl ?? this.baseUrl).replace(/\/+$/, '')}/models`;
    try {
      // `baseUrl` here comes from the user's "add an API key" form, so it is
      // attacker-controlled and goes through the redirect-revalidating guard.
      // Without a baseUrl this is the operator's own endpoint, which may be a
      // private address (Ollama) and so must not be guarded.
      const response = baseUrl
        ? await safeFetch(url, {
            headers: this.headers({ Authorization: `Bearer ${apiKey}` }),
            timeoutMs: 15_000,
          })
        : await fetch(url, {
            headers: this.headers({ Authorization: `Bearer ${apiKey}` }),
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

  /**
   * `GET /models` returns ids but no prices on every provider Karo ships, so
   * this reports reachable ids only. Prices come from the catalogue sync in
   * `app/api/admin/models/sync/route.ts`, which preserves admin price pins.
   */
  async listModels(): Promise<ProviderModelInfo[] | null> {
    if (!this.isConfigured()) return null;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(20_000),
        // Operator-configured URL, so not guarded — but a catalogue endpoint has
        // no reason to redirect either.
        redirect: 'error',
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        data?: Array<{ id?: string; context_length?: number; context_window?: number }>;
      };
      if (!Array.isArray(payload.data)) return null;

      return payload.data
        .filter((m): m is { id: string } => typeof m.id === 'string')
        .map((m) => ({
          slug: m.id,
          displayName: humanizeSlug(m.id),
          family: familyFromSlug(m.id),
          // OpenRouter reports `context_length`; most others report nothing. A
          // zero tells the sync route to keep whatever the catalogue already
          // has rather than overwrite a good value with a guess.
          contextWindow:
            (m as { context_length?: number }).context_length ??
            (m as { context_window?: number }).context_window ??
            0,
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
}

/* ------------------------------------------------------------------ *
 *  OpenAI-compatible wire format
 * ------------------------------------------------------------------ */

type OpenAiMessage = {
  role: string;
  content: unknown;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

export function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  return messages.map((message): OpenAiMessage => {
    switch (message.role) {
      case 'system':
        return { role: 'system', content: message.content };

      case 'user': {
        if (typeof message.content === 'string') {
          return { role: 'user', content: message.content };
        }
        return {
          role: 'user',
          content: message.content.map((part) =>
            part.type === 'text'
              ? { type: 'text', text: part.text }
              : {
                  type: 'image_url',
                  image_url: { url: `data:${part.mimeType};base64,${part.dataBase64}` },
                },
          ),
        };
      }

      case 'assistant':
        return {
          role: 'assistant',
          content: message.content || null,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function' as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        };

      case 'tool':
        return {
          role: 'tool',
          tool_call_id: message.toolCallId,
          name: message.name,
          content: message.content,
        };
    }
  });
}

type StreamDelta = {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

/** Every usage shape Karo has verified in the wild. */
export type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** OpenAI, W&B, Groq, Z.ai: the cached subset of `prompt_tokens`. */
  prompt_tokens_details?: { cached_tokens?: number } | null;
  /** DeepSeek reports the split directly instead of nesting it. */
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  /** Anthropic-style passthrough on some resellers. */
  cache_creation_input_tokens?: number;
};

/**
 * Normalises a provider usage object into Karo's four token buckets.
 *
 * The subtraction here is the whole point. Karo prices `inputTokens` and
 * `cachedInputTokens` as **separate additive buckets** — see
 * `calculateUpstreamCostMicroUsd` — but OpenAI-compatible providers report
 * `prompt_tokens` as the *total* prompt, with `cached_tokens` a subset of it.
 * Passing the total straight through therefore bills the cached tokens twice:
 * once at full input price and again at the cache rate, and inflates the
 * customer's weighted-token quota by the same amount. The mock provider already
 * subtracts (`inputTokens: inputTokens - cachedInputTokens`), so this restores
 * the invariant the rest of the system was written against.
 */
export function normalizeUsage(raw: RawUsage): ProviderUsage {
  const prompt = Math.max(0, raw.prompt_tokens ?? 0);

  const nested = raw.prompt_tokens_details?.cached_tokens ?? 0;
  const deepseekHit = raw.prompt_cache_hit_tokens ?? 0;
  // A cache count larger than the prompt itself means the provider is not
  // reporting a subset; clamp rather than produce a negative input count.
  const cached = Math.min(prompt, Math.max(0, nested, deepseekHit));

  // DeepSeek states the non-cached remainder explicitly, which beats inferring.
  const miss = raw.prompt_cache_miss_tokens;
  const inputTokens =
    typeof miss === 'number' && miss >= 0 ? miss : Math.max(0, prompt - cached);

  return {
    inputTokens,
    outputTokens: Math.max(0, raw.completion_tokens ?? 0),
    cachedInputTokens: cached,
    cacheWriteTokens: Math.max(0, raw.cache_creation_input_tokens ?? 0),
  };
}

/**
 * Parses an OpenAI-compatible SSE stream into Karo chunks.
 *
 * Tool calls arrive as indexed fragments — the id and name land on the first
 * fragment, arguments accumulate across later ones — so we buffer per index and
 * emit `tool_call_end` once the stream finishes.
 *
 * Reasoning models (Qwen3.x, MiniMax, Nemotron, GLM) put their thinking in
 * `delta.reasoning` or `delta.reasoning_content`; both map to a `thinking`
 * chunk so the UI can show it without it polluting the assistant message.
 */
export async function* parseOpenAiStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<CompletionChunk> {
  const queue: CompletionChunk[] = [];
  let finished = false;
  let finishReason: FinishReason = 'stop';
  let usage: ProviderUsage | null = null;

  const pending = new Map<number, { id: string; name: string; args: string }>();

  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      if (event.data === '[DONE]') {
        finished = true;
        return;
      }

      let payload: {
        choices?: Array<{ delta?: StreamDelta; finish_reason?: string | null }>;
        usage?: RawUsage | null;
      };
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.usage) usage = normalizeUsage(payload.usage);

      const choice = payload.choices?.[0];
      if (!choice) return;

      const delta = choice.delta;
      if (delta?.content) queue.push({ type: 'text', text: delta.content });

      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (reasoning) queue.push({ type: 'thinking', text: reasoning });

      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        let entry = pending.get(index);
        if (!entry) {
          entry = { id: call.id ?? `call_${index}`, name: call.function?.name ?? '', args: '' };
          pending.set(index, entry);
          if (entry.name) {
            queue.push({ type: 'tool_call_start', id: entry.id, name: entry.name });
          }
        }
        if (call.id && entry.id !== call.id) entry.id = call.id;
        if (call.function?.name && !entry.name) {
          entry.name = call.function.name;
          queue.push({ type: 'tool_call_start', id: entry.id, name: entry.name });
        }
        if (call.function?.arguments) {
          entry.args += call.function.arguments;
          queue.push({
            type: 'tool_call_delta',
            id: entry.id,
            argumentsDelta: call.function.arguments,
          });
        }
      }

      if (choice.finish_reason) {
        finishReason = normalizeFinishReason(choice.finish_reason);
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

  for (const entry of pending.values()) {
    yield { type: 'tool_call_end', id: entry.id, name: entry.name, arguments: entry.args };
  }

  if (usage) yield { type: 'usage', usage };
  yield { type: 'done', finishReason };
}

function normalizeFinishReason(raw: string): FinishReason {
  switch (raw) {
    case 'stop':
    case 'end_turn':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export function humanizeSlug(slug: string): string {
  // Provider ids are commonly namespaced (`zai-org/GLM-5.2`); the namespace is
  // noise in a model picker that already groups by provider.
  const withoutNamespace = slug.includes('/') ? slug.slice(slug.lastIndexOf('/') + 1) : slug;
  return withoutNamespace
    .split(/[-_]/)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

export function familyFromSlug(slug: string): string {
  const s = slug.toLowerCase();
  if (s.includes('claude')) return 'anthropic';
  if (s.includes('gpt-oss')) return 'gpt-oss';
  if (s.includes('gpt')) return 'gpt';
  if (s.includes('gemini')) return 'gemini';
  if (s.includes('gemma')) return 'gemma';
  if (s.includes('grok')) return 'grok';
  if (s.includes('deepseek')) return 'deepseek';
  if (s.includes('glm')) return 'glm';
  if (s.includes('kimi')) return 'kimi';
  if (s.includes('qwen')) return 'qwen';
  if (s.includes('llama')) return 'llama';
  if (s.includes('minimax')) return 'minimax';
  if (s.includes('nemotron')) return 'nemotron';
  if (s.includes('granite')) return 'granite';
  if (s.includes('mellum')) return 'mellum';
  if (s.includes('phi')) return 'phi';
  return 'other';
}
