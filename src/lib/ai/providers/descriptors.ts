/**
 * Registry of model providers.
 *
 * Most providers Karo talks to speak the OpenAI Chat Completions wire protocol
 * — `POST {baseUrl}/chat/completions` with `Authorization: Bearer <key>`, SSE
 * streaming and OpenAI-shaped `tools` — so they are **data, not code**: one
 * entry here is enough, and `OpenAiCompatibleProvider` handles the rest.
 * Descriptors with `protocol: 'anthropic-messages'` are served by
 * `AnthropicMessagesProvider` instead and need no further code.
 *
 * This module is deliberately free of `server-only` and reads no environment,
 * so Server Components and the seed script can both import the metadata. The
 * env lookup that turns a descriptor into working credentials lives in
 * `src/lib/ai/index.ts`.
 *
 * ── On `autoPriority` ──────────────────────────────────────────────────────
 * With `AI_PROVIDER=auto` (the default) Karo picks the configured provider with
 * the lowest number. The order is a judgement call about **value**, not raw
 * per-token price, because the cheapest token is worthless if the model cannot
 * hold a tool call together. It is ordered: verified-cheap-and-capable first,
 * aggregators next, premium resellers last, and local servers only when the
 * operator opts in explicitly.
 */

export type ProviderDescriptor = {
  /** Stable machine key. Matches `providers.key` in the database. */
  key: string;
  displayName: string;
  /**
   * Wire protocol the upstream speaks. Defaults to the OpenAI Chat
   * Completions shape; `anthropic-messages` switches to Anthropic's
   * `/v1/messages` protocol (x-api-key, content blocks, tool_use/tool_result).
   */
  protocol?: 'openai-chat' | 'anthropic-messages';
  /**
   * Environment variable supplying the API key. `null` marks a keyless
   * provider (a local server), which is treated as configured only when its
   * base-URL variable is set explicitly — otherwise every dev machine without
   * Ollama installed would think it had a working provider.
   */
  apiKeyEnv: string | null;
  /** Environment variable overriding `defaultBaseUrl`. */
  baseUrlEnv: string;
  defaultBaseUrl: string;
  /** Headers this provider requires in addition to `Authorization`. */
  extraHeaders?: Readonly<Record<string, string>>;
  /**
   * Documented departures from the OpenAI request schema. Each one here was
   * verified against the provider's own reference — they are the difference
   * between "OpenAI-compatible" on the tin and a request that actually works.
   */
  quirks?: {
    /**
     * Provider fixes temperature internally and rejects an explicit value.
     * Moonshot's parameter reference: "do not pass `temperature` explicitly
     * when calling these models".
     */
    omitTemperature?: boolean;
    /** Provider deprecated `max_tokens` in favour of `max_completion_tokens`. */
    useMaxCompletionTokens?: boolean;
    /**
     * Provider does not implement `tool_choice`. Ollama's OpenAI-compatibility
     * docs list `tools` as supported but mark `tool_choice` unsupported, so a
     * tool call can be offered but never forced or forbidden.
     */
    omitToolChoice?: boolean;
  };
  /** Preference order for `AI_PROVIDER=auto`; lower wins. */
  autoPriority: number;
  signupUrl: string | null;
  docsUrl: string;
  /** Public page listing model ids and prices, shown in Admin → Providers. */
  catalogUrl: string | null;
  /** One line answering "why would I pick this one?". Rendered in Admin. */
  summary: string;
};

/**
 * W&B Inference — the default.
 *
 * Verified against the live API on 2026-07-26 (not inferred from docs):
 *   · `GET  /v1/models`          → 200, 30 open-weight models.
 *   · `POST /v1/chat/completions` with `stream:true` → SSE deltas.
 *   · Tool calling confirmed on every model Karo enables, including the
 *     reasoning ones, whose thinking arrives in `delta.reasoning`.
 *   · `stream_options:{include_usage:true}` returns usage on the final frame
 *     with `prompt_tokens_details.cached_tokens` — which is what Karo's
 *     metering reads, so token accounting is exact rather than estimated.
 *   · No `OpenAI-Project` header is required.
 *
 * It leads `autoPriority` because it is the rare combination of genuinely cheap
 * (gpt-oss-120b at $0.03/$0.17 per Mtok), capable at agentic coding
 * (Qwen3-Coder-480B, GLM-5.2, Kimi-K2.7-Code), and billed per token with a
 * spending cap rather than a subscription.
 */
export const WANDB_DEFAULT_BASE_URL = 'https://api.inference.wandb.ai/v1';

export const PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = [
  {
    key: 'wandb',
    displayName: 'W&B Inference',
    apiKeyEnv: 'WANDB_API_KEY',
    baseUrlEnv: 'WANDB_BASE_URL',
    defaultBaseUrl: WANDB_DEFAULT_BASE_URL,
    autoPriority: 10,
    signupUrl: 'https://wandb.ai/site/pricing/inference',
    docsUrl: 'https://docs.wandb.ai/inference',
    catalogUrl: 'https://docs.wandb.ai/inference/models/',
    summary:
      'Open-weight models billed per token, from $0.03/Mtok. Tool calling and usage reporting verified on every enabled model. The default.',
  },
  {
    key: 'openrouter',
    displayName: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrlEnv: 'OPENROUTER_BASE_URL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    // OpenRouter attributes traffic to an app via these headers. They are
    // optional for access but they are what makes usage legible in its
    // dashboard, so Karo always sends them.
    extraHeaders: {
      'HTTP-Referer': 'https://karo.dev',
      'X-Title': 'Karo',
    },
    autoPriority: 25,
    signupUrl: 'https://openrouter.ai/settings/keys',
    docsUrl: 'https://openrouter.ai/docs/quickstart',
    catalogUrl: 'https://openrouter.ai/models',
    summary:
      'One key fronting hundreds of models across every major vendor, with a free tier. Best choice when you want to switch models without switching accounts.',
  },
  {
    key: 'deepseek',
    displayName: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    // The current reference documents the bare host with no `/v1` segment.
    defaultBaseUrl: 'https://api.deepseek.com',
    autoPriority: 20,
    signupUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/',
    catalogUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    summary:
      'The cheapest frontier tier anywhere: V4-Pro at $0.435/$0.87 per Mtok, undercutting the same model resold elsewhere by ~4x. Automatic context caching drops repeat input ~50x.',
  },
  {
    key: 'zai',
    displayName: 'Z.ai (Zhipu GLM)',
    apiKeyEnv: 'ZAI_API_KEY',
    baseUrlEnv: 'ZAI_BASE_URL',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    autoPriority: 30,
    signupUrl: 'https://z.ai/manage-apikey/apikey-list',
    docsUrl: 'https://docs.z.ai/guides/llm/glm-4.7',
    catalogUrl: 'https://docs.z.ai/guides/overview/pricing',
    summary:
      'Ships glm-4.7-flash at $0/$0 — a genuinely free model with a 200K context and working tool calls. The cheapest way to run Karo against a real provider.',
  },
  {
    key: 'moonshot',
    displayName: 'Moonshot AI (Kimi)',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    baseUrlEnv: 'MOONSHOT_BASE_URL',
    // The docs site moved to platform.kimi.ai but the API host did not; every
    // first-party example still posts to api.moonshot.ai.
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    quirks: { omitTemperature: true, useMaxCompletionTokens: true },
    autoPriority: 65,
    signupUrl: 'https://platform.kimi.ai/',
    docsUrl: 'https://platform.kimi.ai/docs',
    catalogUrl: 'https://platform.kimi.ai/docs/pricing/chat',
    summary:
      'The Kimi family, strong at long-horizon agentic coding. Note the flagship unlocks only after a paid top-up.',
  },
  {
    key: 'groq',
    displayName: 'Groq',
    apiKeyEnv: 'GROQ_API_KEY',
    baseUrlEnv: 'GROQ_BASE_URL',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    autoPriority: 40,
    signupUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs/openai',
    catalogUrl: 'https://console.groq.com/docs/models',
    summary:
      'The fastest tokens per second of any hosted provider, with a free tier. Best when agent latency matters more than breadth of catalogue.',
  },
  {
    key: 'cerebras',
    displayName: 'Cerebras',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    baseUrlEnv: 'CEREBRAS_BASE_URL',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    autoPriority: 45,
    signupUrl: 'https://cloud.cerebras.ai/',
    docsUrl: 'https://inference-docs.cerebras.ai/',
    catalogUrl: 'https://inference-docs.cerebras.ai/models/overview',
    summary:
      'Wafer-scale inference with a free tier. Very fast on a deliberately narrow set of open models.',
  },
  {
    key: 'siliconflow',
    displayName: 'SiliconFlow',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    baseUrlEnv: 'SILICONFLOW_BASE_URL',
    defaultBaseUrl: 'https://api.siliconflow.com/v1',
    autoPriority: 52,
    signupUrl: 'https://siliconflow.com/',
    docsUrl: 'https://docs.siliconflow.com/',
    catalogUrl: 'https://siliconflow.com/pricing',
    summary:
      'A large catalogue of open models at some of the lowest per-token prices anywhere, plus $1 of signup credit.',
  },
  {
    key: 'together',
    displayName: 'Together AI',
    apiKeyEnv: 'TOGETHER_API_KEY',
    baseUrlEnv: 'TOGETHER_BASE_URL',
    defaultBaseUrl: 'https://api.together.ai/v1',
    autoPriority: 54,
    signupUrl: 'https://api.together.ai/settings/api-keys',
    docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
    catalogUrl: 'https://docs.together.ai/docs/serverless-models',
    summary:
      'Open models with an explicitly published "model string for API" column, so model ids are unambiguous. Prices sit mid-pack.',
  },
  {
    key: 'gemini',
    displayName: 'Google Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    baseUrlEnv: 'GEMINI_BASE_URL',
    // Google's OpenAI-compatibility layer, not the native generateContent API.
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    autoPriority: 56,
    signupUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    catalogUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    summary:
      'Long-context Gemini models through an OpenAI-compatible layer. Do NOT use the free tier for customer traffic: Google’s terms let it train on unpaid-tier content and have humans review it. The paid tier does not.',
  },
  {
    key: 'mistral',
    displayName: 'Mistral AI',
    apiKeyEnv: 'MISTRAL_API_KEY',
    baseUrlEnv: 'MISTRAL_BASE_URL',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    autoPriority: 58,
    signupUrl: 'https://console.mistral.ai/api-keys',
    docsUrl: 'https://docs.mistral.ai/api/',
    catalogUrl: 'https://mistral.ai/pricing',
    summary:
      'EU-hosted, which is the reason to choose it: the cheapest frontier options here run on PRC infrastructure. codestral is its code model.',
  },
  {
    key: 'omniakey',
    displayName: 'Omniakey',
    apiKeyEnv: 'OMNIAKEY_API_KEY',
    baseUrlEnv: 'OMNIAKEY_BASE_URL',
    defaultBaseUrl: 'https://api.omniakey.com/v1',
    autoPriority: 60,
    signupUrl: 'https://omniakey.com/',
    docsUrl: 'https://docs.omniakey.com/en/introduction',
    catalogUrl: 'https://omniakey.com/models',
    summary:
      'A reseller discounting Claude, GPT, Gemini and Grok. Pick it when you specifically need a closed frontier model rather than the cheapest capable one.',
  },
  {
    key: 'anthropic',
    displayName: 'Anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    defaultBaseUrl: 'https://api.anthropic.com',
    protocol: 'anthropic-messages',
    autoPriority: 62,
    signupUrl: 'https://console.anthropic.com/settings/keys',
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
    catalogUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    summary:
      'The Claude family first-hand at published prices, on the native Messages protocol with first-class tool calling and exact cache accounting. The resellers discount the same models when provenance matters less than cost.',
  },
  {
    key: 'hypercli',
    displayName: 'HyperCLI',
    apiKeyEnv: 'HYPERCLI_API_KEY',
    baseUrlEnv: 'HYPERCLI_BASE_URL',
    defaultBaseUrl: 'https://api.hypercli.com',
    protocol: 'anthropic-messages',
    autoPriority: 64,
    signupUrl: 'https://agents.hypercli.com',
    docsUrl: 'https://docs.hypercli.com/agents/integrations',
    catalogUrl: 'https://docs.hypercli.com/agents/integrations',
    summary:
      'Kimi K3 on flat-rate plans (a daily token allowance, 25M-100M tokens/day, instead of per-token billing), served on the Anthropic Messages route its docs recommend for tool calling. The daily quota lives on the HyperCLI account, so Karo still meters usage at reference prices for your own margin math.',
  },
  {
    key: 'ollama',
    displayName: 'Ollama (local)',
    apiKeyEnv: null,
    baseUrlEnv: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    quirks: { omitToolChoice: true },
    autoPriority: 90,
    signupUrl: null,
    docsUrl: 'https://docs.ollama.com/openai',
    catalogUrl: 'https://ollama.com/library',
    summary:
      'Models on your own machine, so the bill is always zero. Two things to fix first: Ollama defaults to a 4096-token context, which is smaller than Karo’s system prompt plus tool schemas, so raise OLLAMA_CONTEXT_LENGTH; and it does not implement tool_choice, which Karo therefore omits for this provider.',
  },
];

const BY_KEY = new Map(PROVIDER_DESCRIPTORS.map((d) => [d.key, d]));

export function findDescriptor(key: string): ProviderDescriptor | undefined {
  return BY_KEY.get(key);
}

/**
 * Whether a descriptor has usable credentials in the given environment.
 *
 * Kept pure and in this module on purpose: both the adapter (`isConfigured`) and
 * the env loader (`AI_PROVIDER=auto`) need the answer, and if they disagreed —
 * one saying a provider is live while the other routes around it — runs would
 * land on the simulator with no explanation.
 */
export function descriptorIsConfigured(
  descriptor: ProviderDescriptor,
  source: Record<string, string | undefined> = process.env,
): boolean {
  // Keyless means a local server. Requiring the base URL to be set explicitly
  // keeps every machine that merely *could* run Ollama from claiming it does.
  if (!descriptor.apiKeyEnv) return Boolean(source[descriptor.baseUrlEnv]);
  return Boolean(source[descriptor.apiKeyEnv]);
}

/** Provider keys that resolve to a real upstream, cheapest-value first. */
export const AUTO_PROVIDER_ORDER: readonly string[] = [...PROVIDER_DESCRIPTORS]
  .sort((a, b) => a.autoPriority - b.autoPriority)
  .map((d) => d.key);

/**
 * `mock` is not in the descriptor list because it has no endpoint and no
 * credential — it is an in-process simulator. Callers that need to name it in a
 * union use this constant so the string is not duplicated.
 */
export const MOCK_PROVIDER_KEY = 'mock';
