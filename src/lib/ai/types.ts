/**
 * Model provider abstraction.
 *
 * Karo talks to exactly one shape of model API internally. Adapters translate
 * that shape to whatever the upstream expects. Today there are two:
 *
 *   · `OpenAiCompatibleProvider` — every hosted provider, driven by a descriptor.
 *   · `MockProvider`     — deterministic local simulation for demo mode.
 *
 * Adding a third (a direct Anthropic or Gemini adapter, a self-hosted vLLM) is
 * a new file in `providers/`, not a change anywhere above this layer.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatContentPart =
  { type: 'text'; text: string } | { type: 'image'; mimeType: string; dataBase64: string };

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ChatContentPart[] }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
};

export type CompletionRequest = {
  modelSlug: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Abort the upstream request when the client disconnects or /stop is used. */
  signal?: AbortSignal;
  /** Per-request key override for BYOK. */
  apiKey?: string;
  baseUrl?: string;
  /** Opaque correlation id forwarded to the provider for support tickets. */
  requestId?: string;
};

export type CompletionChunk =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  /** Emitted once per tool call as soon as its name is known. */
  | { type: 'tool_call_start'; id: string; name: string }
  /** Incremental JSON for the tool arguments. */
  | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: string }
  | { type: 'usage'; usage: ProviderUsage }
  | { type: 'done'; finishReason: FinishReason };

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

export type ProviderModelInfo = {
  slug: string;
  displayName: string;
  family: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsCaching: boolean;
  /** Micro-USD per 1,000,000 tokens. */
  inputMicroUsdPerMtok: number;
  outputMicroUsdPerMtok: number;
  cachedInputMicroUsdPerMtok: number;
  cacheWriteMicroUsdPerMtok: number;
};

export interface ModelProvider {
  readonly key: string;
  readonly displayName: string;
  /** False when the provider has no credentials configured. */
  isConfigured(): boolean;
  /** Streams a completion. Must always end with a `done` chunk. */
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
  /** Verifies a key without spending meaningful tokens. */
  verifyCredentials(apiKey: string, baseUrl?: string): Promise<VerifyResult>;
  /** Refreshes the model catalogue. Returns `null` when unsupported. */
  listModels(): Promise<ProviderModelInfo[] | null>;
}

export type VerifyResult =
  { ok: true; detail: string; modelCount?: number } | { ok: false; detail: string };

export class ProviderError extends Error {
  readonly code:
    | 'unauthorized'
    | 'rate_limited'
    | 'unavailable'
    | 'bad_request'
    | 'context_too_long'
    | 'cancelled'
    | 'internal';
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: ProviderError['code'],
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.status = options.status ?? 502;
    this.retryable = options.retryable ?? (code === 'rate_limited' || code === 'unavailable');
  }
}

/** Maps an HTTP status from an OpenAI-compatible API onto a ProviderError. */
export function providerErrorFromStatus(status: number, body: string): ProviderError {
  const detail = body.slice(0, 400);
  if (status === 401 || status === 403) {
    return new ProviderError('unauthorized', `Provider rejected the API key. ${detail}`, {
      status,
    });
  }
  if (status === 429) {
    return new ProviderError('rate_limited', `Provider rate limit reached. ${detail}`, {
      status,
      retryable: true,
    });
  }
  if (status === 400 && /context|token|too long|maximum/i.test(body)) {
    return new ProviderError(
      'context_too_long',
      `Conversation exceeds the model context window.`,
      {
        status,
      },
    );
  }
  if (status === 400 || status === 422) {
    return new ProviderError('bad_request', `Provider rejected the request. ${detail}`, {
      status,
    });
  }
  if (status >= 500) {
    return new ProviderError('unavailable', `Provider returned ${status}. ${detail}`, {
      status,
      retryable: true,
    });
  }
  return new ProviderError('internal', `Unexpected provider response ${status}. ${detail}`, {
    status,
  });
}
