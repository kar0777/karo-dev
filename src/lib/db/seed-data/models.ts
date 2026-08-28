import { models, providers } from '@/lib/db/schema';
import type { TokenPrices } from '@/lib/pricing/weighted-tokens';

/* ==================================================================== *
 *  Model catalogue — seed values
 *  ------------------------------------------------------------------
 *  Karo ships two credentialed providers out of the box. Both speak the
 *  same OpenAI-compatible protocol, so which one serves a request is a
 *  matter of which key is present — see
 *  `src/lib/ai/providers/descriptors.ts`.
 *
 *  1. **W&B Inference** (`wandb`) — the default, and the source of the
 *     25 open-weight models below. Verified against the live API on
 *     2026-07-26 rather than inferred from docs:
 *
 *       · `GET /v1/models` returns 30 ids; the 25 seeded here are the
 *         ones W&B lists as generally available. The five it marks
 *         deprecated (Phi-4-mini, Kimi-K2.5, Qwen3.5-27B and both
 *         Qwen3-235B variants) are deliberately absent — seeding a model
 *         on its way out promises something Karo cannot keep.
 *       · Streaming and tool calling confirmed on every model seeded.
 *         Reasoning models (Qwen3.x, MiniMax, Nemotron, GLM) stream their
 *         thinking in `delta.reasoning`, which the adapter maps to a
 *         `thinking` chunk.
 *       · `stream_options:{include_usage:true}` returns real token counts
 *         on the final SSE frame, so metering records usage rather than
 *         estimating it.
 *       · Context windows and modality come from
 *         https://docs.wandb.ai/inference/models/ and prices from
 *         https://wandb.ai/site/pricing/inference — both first-party.
 *
 *     Two caveats an operator must know:
 *
 *       · **No cache discount is published.** W&B lists input and output
 *         only, and its usage payload does report `cached_tokens`. Cached
 *         input is therefore priced at the *input* rate rather than being
 *         given an invented discount, so Karo charges exactly what the
 *         provider charges. If W&B publishes cache pricing later, lower
 *         `cachedInputMicroUsdPerMtok` and the weighted-token multipliers
 *         follow automatically.
 *       · **Max output tokens are not published.** The values below were
 *         chosen after confirming the API accepts them (32K, and 128K on
 *         GLM-5.2) and are sized so a reasoning model has room to think
 *         *and* still emit its tool call — too small a budget makes runs
 *         die at `finish_reason: length` before any tool is called.
 *
 *  2. **Omniakey** (`omniakey`) — a reseller of the closed frontier
 *     models, kept for teams that specifically need Claude, GPT, Gemini
 *     or Grok. Note it is no longer the default: for most work the open
 *     models above are between 3x and 20x cheaper per token.
 *
 *  Verified against https://omniakey.com/models and
 *  https://docs.omniakey.com/en/introduction at seed-authoring time:
 *
 *   · Omniakey exposes an **OpenAI-compatible** Chat Completions API at
 *     `https://api.omniakey.com/v1` (`POST /chat/completions`), with
 *     `Authorization: Bearer <key>`. Claude, GPT, Gemini and Grok model
 *     ids are all reachable through that one base URL.
 *   · Input/output prices below are the published $/1M-token figures,
 *     converted to micro-USD per 1,000,000 tokens ($3.00/Mtok =
 *     3_000_000).
 *
 *  Two caveats an operator must know:
 *
 *   1. **Model id spelling.** The catalogue page and the docs are not
 *      perfectly consistent about `4-8` vs `4.8` in version suffixes.
 *      The ids below follow the catalogue listing. If a request comes
 *      back with `model_not_found`, run Admin → Models → "Sync from
 *      Omniakey", which replaces these with the ids the API itself
 *      reports.
 *   2. **Cache pricing is not published.** Omniakey lists input and
 *      output only. Cached-read is seeded at 0.1x input and cache-write
 *      at 1.25x input — the conventional ratios — and is flagged
 *      `source: 'seed-estimate'` so it is obvious in Admin → Models
 *      which numbers are measured and which are assumed. These ratios
 *      feed the weighted-token multipliers, so correcting them changes
 *      what customers are charged.
 * ==================================================================== */

export type ProviderSeed = Omit<
  typeof providers.$inferInsert,
  'id' | 'createdAt' | 'updatedAt'
>;

export type ModelSeed = Omit<
  typeof models.$inferInsert,
  'id' | 'providerId' | 'createdAt' | 'updatedAt'
> & {
  /** Natural key of the owning row in `PROVIDER_SEEDS`. */
  providerKey: string;
};

export type ModelPriceSeed = TokenPrices & { source: string };

export const OMNIAKEY_DEFAULT_BASE_URL = 'https://api.omniakey.com/v1';
export const OMNIAKEY_CATALOG_URL = 'https://omniakey.com/models';

export const WANDB_DEFAULT_BASE_URL = 'https://api.inference.wandb.ai/v1';
export const WANDB_CATALOG_URL = 'https://docs.wandb.ai/inference/models/';

export const PROVIDER_SEEDS: readonly ProviderSeed[] = [
  {
    key: 'wandb',
    name: 'W&B Inference',
    kind: 'model',
    baseUrl: WANDB_DEFAULT_BASE_URL,
    catalogUrl: WANDB_CATALOG_URL,
    isEnabled: true,
    isDefault: true,
    computeMultiplier: 1,
    healthStatus: 'disconnected',
    metadata: {
      docs: 'https://docs.wandb.ai/inference',
      pricing: 'https://wandb.ai/site/pricing/inference',
      protocol: 'openai-compatible',
      credential: 'WANDB_API_KEY',
      note: 'Open-weight models billed per token. Streaming, tool calling and usage reporting verified against the live API.',
    },
  },
  {
    key: 'omniakey',
    name: 'Omniakey',
    kind: 'model',
    baseUrl: OMNIAKEY_DEFAULT_BASE_URL,
    catalogUrl: OMNIAKEY_CATALOG_URL,
    isEnabled: true,
    isDefault: false,
    computeMultiplier: 1,
    healthStatus: 'disconnected',
    metadata: {
      docs: OMNIAKEY_CATALOG_URL,
      protocol: 'openai-compatible',
      note: 'Single aggregator key fronting several upstream model vendors.',
    },
  },
  {
    key: 'mock',
    name: 'Karo Demo Model',
    kind: 'model',
    baseUrl: null,
    catalogUrl: null,
    isEnabled: true,
    isDefault: false,
    computeMultiplier: 1,
    healthStatus: 'connected',
    metadata: {
      protocol: 'in-process',
      note: 'Deterministic scripted responses used when KARO_DEMO_MODE is on. Priced at zero.',
    },
  },
];

export const MODEL_SEEDS: readonly ModelSeed[] = [
  /* ---- W&B Inference (default provider) -------------------------------- *
   * Ordered cheapest-capable first within each tier so the model picker reads
   * top-down as "start here, escalate if it stalls".
   * ---------------------------------------------------------------------- */
  {
    providerKey: 'wandb',
    slug: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
    displayName: 'Qwen3 Coder 480B',
    family: 'qwen',
    description:
      'The default. A 480B mixture-of-experts model trained specifically for code and tool use, with a 262K context. Output at $1.50/Mtok is an order of magnitude under a closed frontier model, and it holds multi-file edits together without hand-holding.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: true,
    sortOrder: 10,
  },
  {
    providerKey: 'wandb',
    slug: 'openai/gpt-oss-120b',
    displayName: 'GPT-OSS 120B',
    family: 'gpt-oss',
    description:
      'The value pick of the whole catalogue: $0.03 in / $0.17 out per Mtok, roughly 20x cheaper on input than a discounted Claude Sonnet, and it still calls tools reliably. Start here and escalate only when a task stalls.',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 20,
  },
  {
    providerKey: 'wandb',
    slug: 'openai/gpt-oss-20b',
    displayName: 'GPT-OSS 20B',
    family: 'gpt-oss',
    description:
      'The cheapest model that still handles the agent loop. Good for mechanical edits, renames and commit messages; it will lose the thread on architecture work.',
    contextWindow: 131_072,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 30,
  },
  {
    providerKey: 'wandb',
    slug: 'deepseek-ai/DeepSeek-V4-Flash',
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    description:
      'A 1M-token context for $0.14/Mtok. The right choice when the task is to read a large codebase rather than write dense code. Buying this model directly from DeepSeek is cheaper still — see Admin, Providers.',
    contextWindow: 1_049_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 40,
  },
  {
    providerKey: 'wandb',
    slug: 'deepseek-ai/DeepSeek-V4-Pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    description:
      'Frontier reasoning with a 1M context. Note that DeepSeek sells the same model direct at roughly a quarter of this price; this row exists so a single W&B key can reach it without a second account.',
    contextWindow: 1_049_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 50,
  },
  {
    providerKey: 'wandb',
    slug: 'zai-org/GLM-5.2',
    displayName: 'GLM-5.2',
    family: 'glm',
    description:
      'Among the strongest open models at long agentic runs, and cheaper here than buying it from Z.ai direct. Reach for it when a task needs many tool calls in sequence.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 60,
  },
  {
    providerKey: 'wandb',
    slug: 'moonshotai/Kimi-K2.7-Code',
    displayName: 'Kimi K2.7 Code',
    family: 'kimi',
    description:
      'A trillion-parameter mixture-of-experts tuned for code, and one of the few models here that also reads images — useful for turning a screenshot of a design into markup.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 70,
  },
  {
    providerKey: 'wandb',
    slug: 'nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B',
    displayName: 'Nemotron 3 Ultra 550B',
    family: 'nemotron',
    description:
      'NVIDIA’s largest open reasoning model. Strong at planning; verify its tool arguments on unfamiliar schemas.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 80,
  },
  {
    providerKey: 'wandb',
    slug: 'MiniMaxAI/MiniMax-M3',
    displayName: 'MiniMax M3',
    family: 'minimax',
    description:
      'The best balance of price, context and vision in the catalogue: 262K context and image input for under $1/Mtok out.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 90,
  },
  {
    providerKey: 'wandb',
    slug: 'zai-org/GLM-5.1',
    displayName: 'GLM-5.1',
    family: 'glm',
    description:
      'The previous GLM generation. Kept for reproducibility when a prompt was tuned against it; GLM-5.2 is both better and cheaper.',
    contextWindow: 203_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 100,
  },
  {
    providerKey: 'wandb',
    slug: 'moonshotai/Kimi-K2.6',
    displayName: 'Kimi K2.6',
    family: 'kimi',
    description:
      'The generation before K2.7 Code, marginally cheaper and still vision-capable. A reasonable fallback when K2.7 is rate limited.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 110,
  },
  {
    providerKey: 'wandb',
    slug: 'Qwen/Qwen3.6-35B-A3B',
    displayName: 'Qwen3.6 35B A3B',
    family: 'qwen',
    description:
      'A sparse 35B reasoning model: only 3B parameters are active per token, so it is cheap and fast, and it thinks before acting. Its reasoning is streamed separately from its reply.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 120,
  },
  {
    providerKey: 'wandb',
    slug: 'Qwen/Qwen3.6-27B',
    displayName: 'Qwen3.6 27B',
    family: 'qwen',
    description:
      'The dense sibling of Qwen3.6 35B A3B. Steadier on hard single-shot reasoning, noticeably more expensive per output token.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 130,
  },
  {
    providerKey: 'wandb',
    slug: 'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8',
    displayName: 'Nemotron 3 Super 120B',
    family: 'nemotron',
    description:
      'An FP8-quantised 120B model at commodity prices. A solid everyday driver if you prefer NVIDIA’s tuning to Qwen’s.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 140,
  },
  {
    providerKey: 'wandb',
    slug: 'MiniMaxAI/MiniMax-M2.5',
    displayName: 'MiniMax M2.5',
    family: 'minimax',
    description:
      'The previous MiniMax generation. M3 is cheaper, longer-context and reads images, so prefer it unless you have a reason to pin this one.',
    contextWindow: 197_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 150,
  },
  {
    providerKey: 'wandb',
    slug: 'deepseek-ai/DeepSeek-V3.1',
    displayName: 'DeepSeek V3.1',
    family: 'deepseek',
    description:
      'The V3 generation, kept for prompts tuned against it. V4 Flash is cheaper, six times the context, and better.',
    contextWindow: 161_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 160,
  },
  {
    providerKey: 'wandb',
    slug: 'Qwen/Qwen3.5-35B-A3B',
    displayName: 'Qwen3.5 35B A3B',
    family: 'qwen',
    description:
      'Same price and shape as the 3.6 release it precedes. Use 3.6 unless you are reproducing an older evaluation.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 170,
  },
  {
    providerKey: 'wandb',
    slug: 'google/gemma-4-31B-it',
    displayName: 'Gemma 4 31B',
    family: 'gemma',
    description:
      'Google’s open model: cheap, multimodal and quick to answer. It calls tools without preamble, which makes it pleasant for short edits.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 180,
  },
  {
    providerKey: 'wandb',
    slug: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
    displayName: 'Qwen3 30B A3B',
    family: 'qwen',
    description:
      'A 262K context for a tenth of a cent per million input tokens. Good for bulk mechanical work across many files.',
    contextWindow: 262_144,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 190,
  },
  {
    providerKey: 'wandb',
    slug: 'meta-llama/Llama-3.3-70B-Instruct',
    displayName: 'Llama 3.3 70B',
    family: 'llama',
    description:
      'Flat pricing in and out, which makes cost trivial to predict for output-heavy jobs like writing tests or documentation.',
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 200,
  },
  {
    providerKey: 'wandb',
    slug: 'meta-llama/Llama-3.1-70B-Instruct',
    displayName: 'Llama 3.1 70B',
    family: 'llama',
    description:
      'The older 70B Llama, priced slightly above 3.3 with no advantage. Present for pinned workloads only.',
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 210,
  },
  {
    providerKey: 'wandb',
    slug: 'meta-llama/Llama-3.1-8B-Instruct',
    displayName: 'Llama 3.1 8B',
    family: 'llama',
    description:
      'A small, fast model for classification and one-line edits. It is not strong enough to drive a long agent run on its own.',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 220,
  },
  {
    providerKey: 'wandb',
    slug: 'ibm-granite/granite-4.1-8b',
    displayName: 'Granite 4.1 8B',
    family: 'granite',
    description:
      'IBM’s small enterprise model, licensed permissively and priced at almost nothing. Useful for high-volume, low-stakes steps.',
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 230,
  },
  {
    providerKey: 'wandb',
    slug: 'JetBrains/Mellum2-12B-A2.5B-Instruct',
    displayName: 'Mellum2 12B',
    family: 'mellum',
    description:
      'JetBrains’ code-completion model. Narrow by design — excellent at filling in code, weak at open-ended reasoning.',
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 240,
  },
  {
    providerKey: 'wandb',
    slug: 'OpenPipe/Qwen3-14B-Instruct',
    displayName: 'Qwen3 14B',
    family: 'qwen',
    description:
      'The smallest context here at 32K, so it will not hold a large workspace. Cheap enough for tight, well-scoped tasks.',
    contextWindow: 32_768,
    maxOutputTokens: 8_192,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 250,
  },

  /* ---- Anthropic ------------------------------------------------------ */
  {
    providerKey: 'omniakey',
    slug: 'claude-fable-5',
    displayName: 'Claude Fable 5',
    family: 'anthropic',
    description:
      'The most capable model in the catalogue, and the most expensive. Reach for it on long-horizon refactors and architecture work, where a wrong plan costs more than the tokens.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'pro',
    isEnabled: true,
    isDefault: false,
    sortOrder: 10,
  },
  {
    providerKey: 'omniakey',
    slug: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    family: 'anthropic',
    description:
      'Frontier agentic coding at a fifth of Fable pricing. The right default for multi-file work that has to finish without hand-holding. Available from the Lite plan up.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 20,
  },
  {
    providerKey: 'omniakey',
    slug: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    family: 'anthropic',
    description:
      'Previous frontier generation at the same price as Opus 5. Useful as a pinned target for prompts tuned against it, and as a fallback when Opus 5 is rate limited.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 30,
  },
  {
    providerKey: 'omniakey',
    slug: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7',
    family: 'anthropic',
    description:
      'Kept for reproducibility. Long-running projects sometimes need the exact model their evaluations were built against.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 40,
  },
  {
    providerKey: 'omniakey',
    slug: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    family: 'anthropic',
    description:
      'Oldest Opus generation still served. Disable it in Admin, Models once nothing in your fleet pins it.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'lite',
    isEnabled: true,
    isDefault: false,
    sortOrder: 50,
  },
  {
    providerKey: 'omniakey',
    slug: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    family: 'anthropic',
    description:
      'The everyday default: near-frontier quality on code and tool use at 40% less per token, with a 1M context window. Start here and escalate only when a task stalls.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    // No longer the catalogue default — Qwen3 Coder 480B on W&B is the everyday
    // driver now. Left enabled so an Omniakey key still reaches it.
    isDefault: false,
    sortOrder: 60,
  },
  {
    providerKey: 'omniakey',
    slug: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    family: 'anthropic',
    description:
      'Previous balanced generation at identical pricing. Pin it when a prompt regressed on Sonnet 5.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 70,
  },
  {
    providerKey: 'omniakey',
    slug: 'claude-haiku-4.5',
    displayName: 'Claude Haiku 4.5',
    family: 'anthropic',
    description:
      'Fast and cheap. Ideal for file summaries, commit messages, lint-fix loops, and any subtask where latency matters more than depth.',
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 80,
  },

  /* ---- OpenAI --------------------------------------------------------- */
  {
    providerKey: 'omniakey',
    slug: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    family: 'openai',
    description:
      'The strongest GPT tier here, and cheaper per token than Sonnet. A good second opinion when one model keeps producing the same wrong fix.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 110,
  },
  {
    providerKey: 'omniakey',
    slug: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    family: 'openai',
    description:
      'Half the price of Sol with most of the capability. A sensible default if you are cost-sensitive and mostly editing rather than designing.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 120,
  },
  {
    providerKey: 'omniakey',
    slug: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    family: 'openai',
    description:
      'Very cheap, with a full 1M context. Built for bulk work: classification, summarisation, mechanical migrations across hundreds of files.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 130,
  },
  {
    providerKey: 'omniakey',
    slug: 'gpt-5.5',
    displayName: 'GPT-5.5',
    family: 'openai',
    description: 'Previous flagship generation, priced identically to Sol.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 140,
  },
  {
    providerKey: 'omniakey',
    slug: 'gpt-5.4',
    displayName: 'GPT-5.4',
    family: 'openai',
    description: 'Older mid tier, kept for prompt reproducibility.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 150,
  },
  {
    providerKey: 'omniakey',
    slug: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini',
    family: 'openai',
    description:
      'The cheapest model in the catalogue. Good for high-volume, low-stakes calls such as generating commit messages or naming things.',
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 160,
  },

  /* ---- Google --------------------------------------------------------- */
  {
    providerKey: 'omniakey',
    slug: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro Preview',
    family: 'google',
    description:
      'Preview model with strong multimodal reasoning. Preview endpoints can change without notice, so do not pin production automation to it.',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'pro',
    isEnabled: true,
    isDefault: false,
    sortOrder: 210,
  },
  {
    providerKey: 'omniakey',
    slug: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash Preview',
    family: 'google',
    description:
      'Fast preview tier with vision. Useful when a task involves screenshots or diagrams.',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 220,
  },
  {
    providerKey: 'omniakey',
    slug: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    family: 'google',
    description:
      'Stable Gemini flagship. Note the unusually wide gap between input and output pricing: an 8x output multiplier, so verbose answers cost disproportionately more.',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 230,
  },
  {
    providerKey: 'omniakey',
    slug: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    family: 'google',
    description: 'Stable fast tier with vision and a 1M context window.',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 240,
  },

  /* ---- xAI ------------------------------------------------------------ */
  {
    providerKey: 'omniakey',
    slug: 'grok-4.5',
    displayName: 'Grok 4.5',
    family: 'xai',
    description:
      'The highest input price in the catalogue, with a 500K context. Worth trying when a task benefits from its distinct training mix, but check the cost estimate first.',
    contextWindow: 500_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsVision: true,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'pro',
    isEnabled: true,
    isDefault: false,
    sortOrder: 310,
  },

  /* ---- DeepSeek ------------------------------------------------------- */
  {
    providerKey: 'omniakey',
    slug: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    description:
      'Unusually flat pricing: output costs only 2x input, against the 5-6x that is typical. That makes it the cheapest option for generation-heavy work such as writing large files from scratch.',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 410,
  },

  /* ---- Z.ai ----------------------------------------------------------- */
  {
    providerKey: 'omniakey',
    slug: 'glm-5.2',
    displayName: 'GLM-5.2',
    family: 'zai',
    description:
      'Strong on structured output and tool calling, with a moderate 3.14x output multiplier.',
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: true,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 510,
  },

  /* ---- Demo ----------------------------------------------------------- *
   * Priced at zero so demo mode charges nothing, while still exercising the
   * *estimated* multiplier path in `deriveMultipliers()`: with no input price
   * there is no ratio to take, so the documented fallback weights are used
   * and the UI labels the figure "estimated".
   * --------------------------------------------------------------------- */
  {
    providerKey: 'mock',
    slug: 'karo-demo-1',
    displayName: 'Karo Demo Model',
    family: 'demo',
    description:
      'Scripted local model used when Karo runs without provider credentials. Streams realistic plans and tool calls, costs nothing, and never leaves the server.',
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsTools: true,
    supportsVision: false,
    supportsCaching: false,
    supportsStreaming: true,
    minPlanTier: 'payg',
    isEnabled: true,
    isDefault: false,
    sortOrder: 900,
  },
];

/**
 * Current price sheet, keyed by model slug.
 *
 * Input and output are the published Omniakey figures. Cached-read and
 * cache-write are NOT published, so they are derived at the conventional
 * 0.1x and 1.25x of input and marked `seed-estimate` in the UI. Those two
 * ratios feed the weighted-token multipliers directly, so correcting them
 * changes what customers are charged.
 */
export const MODEL_PRICE_SEEDS: Record<string, ModelPriceSeed> = {
  /* ---- W&B Inference — https://wandb.ai/site/pricing/inference -------- */
  'Qwen/Qwen3-Coder-480B-A35B-Instruct': {
    inputMicroUsdPerMtok: 1_000_000,
    outputMicroUsdPerMtok: 1_500_000,
    cachedInputMicroUsdPerMtok: 1_000_000,
    cacheWriteMicroUsdPerMtok: 1_000_000,
    source: 'wandb-pricing-2026-07',
  },
  'openai/gpt-oss-120b': {
    inputMicroUsdPerMtok: 30_000,
    outputMicroUsdPerMtok: 170_000,
    cachedInputMicroUsdPerMtok: 30_000,
    cacheWriteMicroUsdPerMtok: 30_000,
    source: 'wandb-pricing-2026-07',
  },
  'openai/gpt-oss-20b': {
    inputMicroUsdPerMtok: 30_000,
    outputMicroUsdPerMtok: 130_000,
    cachedInputMicroUsdPerMtok: 30_000,
    cacheWriteMicroUsdPerMtok: 30_000,
    source: 'wandb-pricing-2026-07',
  },
  'deepseek-ai/DeepSeek-V4-Flash': {
    inputMicroUsdPerMtok: 140_000,
    outputMicroUsdPerMtok: 280_000,
    cachedInputMicroUsdPerMtok: 140_000,
    cacheWriteMicroUsdPerMtok: 140_000,
    source: 'wandb-pricing-2026-07',
  },
  'deepseek-ai/DeepSeek-V4-Pro': {
    inputMicroUsdPerMtok: 1_740_000,
    outputMicroUsdPerMtok: 3_460_000,
    cachedInputMicroUsdPerMtok: 1_740_000,
    cacheWriteMicroUsdPerMtok: 1_740_000,
    source: 'wandb-pricing-2026-07',
  },
  'zai-org/GLM-5.2': {
    inputMicroUsdPerMtok: 760_000,
    outputMicroUsdPerMtok: 2_420_000,
    cachedInputMicroUsdPerMtok: 760_000,
    cacheWriteMicroUsdPerMtok: 760_000,
    source: 'wandb-pricing-2026-07',
  },
  'moonshotai/Kimi-K2.7-Code': {
    inputMicroUsdPerMtok: 710_000,
    outputMicroUsdPerMtok: 3_500_000,
    cachedInputMicroUsdPerMtok: 710_000,
    cacheWriteMicroUsdPerMtok: 710_000,
    source: 'wandb-pricing-2026-07',
  },
  'nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B': {
    inputMicroUsdPerMtok: 750_000,
    outputMicroUsdPerMtok: 2_750_000,
    cachedInputMicroUsdPerMtok: 750_000,
    cacheWriteMicroUsdPerMtok: 750_000,
    source: 'wandb-pricing-2026-07',
  },
  'MiniMaxAI/MiniMax-M3': {
    inputMicroUsdPerMtok: 230_000,
    outputMicroUsdPerMtok: 960_000,
    cachedInputMicroUsdPerMtok: 230_000,
    cacheWriteMicroUsdPerMtok: 230_000,
    source: 'wandb-pricing-2026-07',
  },
  'zai-org/GLM-5.1': {
    inputMicroUsdPerMtok: 1_400_000,
    outputMicroUsdPerMtok: 4_400_000,
    cachedInputMicroUsdPerMtok: 1_400_000,
    cacheWriteMicroUsdPerMtok: 1_400_000,
    source: 'wandb-pricing-2026-07',
  },
  'moonshotai/Kimi-K2.6': {
    inputMicroUsdPerMtok: 650_000,
    outputMicroUsdPerMtok: 3_410_000,
    cachedInputMicroUsdPerMtok: 650_000,
    cacheWriteMicroUsdPerMtok: 650_000,
    source: 'wandb-pricing-2026-07',
  },
  'Qwen/Qwen3.6-35B-A3B': {
    inputMicroUsdPerMtok: 250_000,
    outputMicroUsdPerMtok: 1_250_000,
    cachedInputMicroUsdPerMtok: 250_000,
    cacheWriteMicroUsdPerMtok: 250_000,
    source: 'wandb-pricing-2026-07',
  },
  'Qwen/Qwen3.6-27B': {
    inputMicroUsdPerMtok: 600_000,
    outputMicroUsdPerMtok: 3_600_000,
    cachedInputMicroUsdPerMtok: 600_000,
    cacheWriteMicroUsdPerMtok: 600_000,
    source: 'wandb-pricing-2026-07',
  },
  'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8': {
    inputMicroUsdPerMtok: 200_000,
    outputMicroUsdPerMtok: 800_000,
    cachedInputMicroUsdPerMtok: 200_000,
    cacheWriteMicroUsdPerMtok: 200_000,
    source: 'wandb-pricing-2026-07',
  },
  'MiniMaxAI/MiniMax-M2.5': {
    inputMicroUsdPerMtok: 300_000,
    outputMicroUsdPerMtok: 1_200_000,
    cachedInputMicroUsdPerMtok: 300_000,
    cacheWriteMicroUsdPerMtok: 300_000,
    source: 'wandb-pricing-2026-07',
  },
  'deepseek-ai/DeepSeek-V3.1': {
    inputMicroUsdPerMtok: 550_000,
    outputMicroUsdPerMtok: 1_650_000,
    cachedInputMicroUsdPerMtok: 550_000,
    cacheWriteMicroUsdPerMtok: 550_000,
    source: 'wandb-pricing-2026-07',
  },
  'Qwen/Qwen3.5-35B-A3B': {
    inputMicroUsdPerMtok: 250_000,
    outputMicroUsdPerMtok: 1_250_000,
    cachedInputMicroUsdPerMtok: 250_000,
    cacheWriteMicroUsdPerMtok: 250_000,
    source: 'wandb-pricing-2026-07',
  },
  'google/gemma-4-31B-it': {
    inputMicroUsdPerMtok: 100_000,
    outputMicroUsdPerMtok: 340_000,
    cachedInputMicroUsdPerMtok: 100_000,
    cacheWriteMicroUsdPerMtok: 100_000,
    source: 'wandb-pricing-2026-07',
  },
  'Qwen/Qwen3-30B-A3B-Instruct-2507': {
    inputMicroUsdPerMtok: 100_000,
    outputMicroUsdPerMtok: 300_000,
    cachedInputMicroUsdPerMtok: 100_000,
    cacheWriteMicroUsdPerMtok: 100_000,
    source: 'wandb-pricing-2026-07',
  },
  'meta-llama/Llama-3.3-70B-Instruct': {
    inputMicroUsdPerMtok: 710_000,
    outputMicroUsdPerMtok: 710_000,
    cachedInputMicroUsdPerMtok: 710_000,
    cacheWriteMicroUsdPerMtok: 710_000,
    source: 'wandb-pricing-2026-07',
  },
  'meta-llama/Llama-3.1-70B-Instruct': {
    inputMicroUsdPerMtok: 800_000,
    outputMicroUsdPerMtok: 800_000,
    cachedInputMicroUsdPerMtok: 800_000,
    cacheWriteMicroUsdPerMtok: 800_000,
    source: 'wandb-pricing-2026-07',
  },
  'meta-llama/Llama-3.1-8B-Instruct': {
    inputMicroUsdPerMtok: 220_000,
    outputMicroUsdPerMtok: 220_000,
    cachedInputMicroUsdPerMtok: 220_000,
    cacheWriteMicroUsdPerMtok: 220_000,
    source: 'wandb-pricing-2026-07',
  },
  'ibm-granite/granite-4.1-8b': {
    inputMicroUsdPerMtok: 50_000,
    outputMicroUsdPerMtok: 100_000,
    cachedInputMicroUsdPerMtok: 50_000,
    cacheWriteMicroUsdPerMtok: 50_000,
    source: 'wandb-pricing-2026-07',
  },
  'JetBrains/Mellum2-12B-A2.5B-Instruct': {
    inputMicroUsdPerMtok: 50_000,
    outputMicroUsdPerMtok: 100_000,
    cachedInputMicroUsdPerMtok: 50_000,
    cacheWriteMicroUsdPerMtok: 50_000,
    source: 'wandb-pricing-2026-07',
  },
  'OpenPipe/Qwen3-14B-Instruct': {
    inputMicroUsdPerMtok: 50_000,
    outputMicroUsdPerMtok: 220_000,
    cachedInputMicroUsdPerMtok: 50_000,
    cacheWriteMicroUsdPerMtok: 50_000,
    source: 'wandb-pricing-2026-07',
  },

  'claude-fable-5': {
    inputMicroUsdPerMtok: 2_000_000,
    outputMicroUsdPerMtok: 10_000_000,
    cachedInputMicroUsdPerMtok: 200_000,
    cacheWriteMicroUsdPerMtok: 2_500_000,
    source: 'omniakey-catalog',
  },
  'claude-opus-5': {
    inputMicroUsdPerMtok: 1_000_000,
    outputMicroUsdPerMtok: 5_000_000,
    cachedInputMicroUsdPerMtok: 100_000,
    cacheWriteMicroUsdPerMtok: 1_250_000,
    source: 'omniakey-catalog',
  },
  'claude-opus-4-8': {
    inputMicroUsdPerMtok: 1_000_000,
    outputMicroUsdPerMtok: 5_000_000,
    cachedInputMicroUsdPerMtok: 100_000,
    cacheWriteMicroUsdPerMtok: 1_250_000,
    source: 'omniakey-catalog',
  },
  'claude-opus-4-7': {
    inputMicroUsdPerMtok: 1_000_000,
    outputMicroUsdPerMtok: 5_000_000,
    cachedInputMicroUsdPerMtok: 100_000,
    cacheWriteMicroUsdPerMtok: 1_250_000,
    source: 'omniakey-catalog',
  },
  'claude-opus-4-6': {
    inputMicroUsdPerMtok: 1_000_000,
    outputMicroUsdPerMtok: 5_000_000,
    cachedInputMicroUsdPerMtok: 100_000,
    cacheWriteMicroUsdPerMtok: 1_250_000,
    source: 'omniakey-catalog',
  },
  'claude-sonnet-5': {
    inputMicroUsdPerMtok: 600_000,
    outputMicroUsdPerMtok: 3_000_000,
    cachedInputMicroUsdPerMtok: 60_000,
    cacheWriteMicroUsdPerMtok: 750_000,
    source: 'omniakey-catalog',
  },
  'claude-sonnet-4-6': {
    inputMicroUsdPerMtok: 600_000,
    outputMicroUsdPerMtok: 3_000_000,
    cachedInputMicroUsdPerMtok: 60_000,
    cacheWriteMicroUsdPerMtok: 750_000,
    source: 'omniakey-catalog',
  },
  'claude-haiku-4.5': {
    inputMicroUsdPerMtok: 200_000,
    outputMicroUsdPerMtok: 1_000_000,
    cachedInputMicroUsdPerMtok: 20_000,
    cacheWriteMicroUsdPerMtok: 250_000,
    source: 'omniakey-catalog',
  },
  'gpt-5.6-sol': {
    inputMicroUsdPerMtok: 350_000,
    outputMicroUsdPerMtok: 2_100_000,
    cachedInputMicroUsdPerMtok: 35_000,
    cacheWriteMicroUsdPerMtok: 437_500,
    source: 'omniakey-catalog',
  },
  'gpt-5.6-terra': {
    inputMicroUsdPerMtok: 175_000,
    outputMicroUsdPerMtok: 1_050_000,
    cachedInputMicroUsdPerMtok: 17_500,
    cacheWriteMicroUsdPerMtok: 218_750,
    source: 'omniakey-catalog',
  },
  'gpt-5.6-luna': {
    inputMicroUsdPerMtok: 70_000,
    outputMicroUsdPerMtok: 420_000,
    cachedInputMicroUsdPerMtok: 7_000,
    cacheWriteMicroUsdPerMtok: 87_500,
    source: 'omniakey-catalog',
  },
  'gpt-5.5': {
    inputMicroUsdPerMtok: 350_000,
    outputMicroUsdPerMtok: 2_100_000,
    cachedInputMicroUsdPerMtok: 35_000,
    cacheWriteMicroUsdPerMtok: 437_500,
    source: 'omniakey-catalog',
  },
  'gpt-5.4': {
    inputMicroUsdPerMtok: 175_000,
    outputMicroUsdPerMtok: 1_050_000,
    cachedInputMicroUsdPerMtok: 17_500,
    cacheWriteMicroUsdPerMtok: 218_750,
    source: 'omniakey-catalog',
  },
  'gpt-5.4-mini': {
    inputMicroUsdPerMtok: 52_500,
    outputMicroUsdPerMtok: 315_000,
    cachedInputMicroUsdPerMtok: 5_250,
    cacheWriteMicroUsdPerMtok: 65_625,
    source: 'omniakey-catalog',
  },
  'gemini-3.1-pro-preview': {
    inputMicroUsdPerMtok: 1_600_000,
    outputMicroUsdPerMtok: 9_600_000,
    cachedInputMicroUsdPerMtok: 160_000,
    cacheWriteMicroUsdPerMtok: 2_000_000,
    source: 'omniakey-catalog',
  },
  'gemini-3-flash-preview': {
    inputMicroUsdPerMtok: 400_000,
    outputMicroUsdPerMtok: 2_400_000,
    cachedInputMicroUsdPerMtok: 40_000,
    cacheWriteMicroUsdPerMtok: 500_000,
    source: 'omniakey-catalog',
  },
  'gemini-2.5-pro': {
    inputMicroUsdPerMtok: 1_000_000,
    outputMicroUsdPerMtok: 8_000_000,
    cachedInputMicroUsdPerMtok: 100_000,
    cacheWriteMicroUsdPerMtok: 1_250_000,
    source: 'omniakey-catalog',
  },
  'gemini-2.5-flash': {
    inputMicroUsdPerMtok: 240_000,
    outputMicroUsdPerMtok: 2_000_000,
    cachedInputMicroUsdPerMtok: 24_000,
    cacheWriteMicroUsdPerMtok: 300_000,
    source: 'omniakey-catalog',
  },
  'grok-4.5': {
    inputMicroUsdPerMtok: 3_200_000,
    outputMicroUsdPerMtok: 9_600_000,
    cachedInputMicroUsdPerMtok: 320_000,
    cacheWriteMicroUsdPerMtok: 4_000_000,
    source: 'omniakey-catalog',
  },
  'deepseek-v4-pro': {
    inputMicroUsdPerMtok: 348_000,
    outputMicroUsdPerMtok: 696_000,
    cachedInputMicroUsdPerMtok: 34_800,
    cacheWriteMicroUsdPerMtok: 435_000,
    source: 'omniakey-catalog',
  },
  'glm-5.2': {
    inputMicroUsdPerMtok: 1_120_000,
    outputMicroUsdPerMtok: 3_520_000,
    cachedInputMicroUsdPerMtok: 112_000,
    cacheWriteMicroUsdPerMtok: 1_400_000,
    source: 'omniakey-catalog',
  },
  'karo-demo-1': {
    inputMicroUsdPerMtok: 0,
    outputMicroUsdPerMtok: 0,
    cachedInputMicroUsdPerMtok: 0,
    cacheWriteMicroUsdPerMtok: 0,
    source: 'demo',
  },
};

/** Slug of the model new projects default to when nothing else is chosen. */
/**
 * The catalogue default. Must match the single `isDefault: true` model above.
 *
 * At request time `resolveModel` additionally prefers a model whose provider
 * actually holds credentials, so this is the preference rather than a guarantee.
 */
export const DEFAULT_MODEL_SLUG = 'Qwen/Qwen3-Coder-480B-A35B-Instruct';
/** Slug of the in-process model used whenever `env.DEMO_MODE` is true. */
export const DEMO_MODEL_SLUG = 'karo-demo-1';
