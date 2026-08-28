import { z } from 'zod';

import { descriptorIsConfigured, PROVIDER_DESCRIPTORS } from '@/lib/ai/providers/descriptors';

/**
 * Environment configuration.
 *
 * Design goals
 * ------------
 *  1. `npm run build` and `npm run dev` must succeed with a completely empty
 *     environment. Karo then runs in **demo mode** on mock providers.
 *  2. Real credentials switch integrations on automatically; you never have to
 *     flip two flags to enable one thing.
 *  3. Nothing secret is ever re-exported to the client. Only `clientEnv` is
 *     safe to import from a Client Component.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
    });

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return def;
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : def;
    });

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  APP_URL: z.string().default('http://localhost:3000'),
  APP_NAME: z.string().default('Karo'),

  // ---- Data -------------------------------------------------------------
  DATABASE_URL: z.string().default('postgresql://karo:karo@localhost:5432/karo'),
  DATABASE_SSL: bool(false),
  DATABASE_MAX_CONNECTIONS: int(10),

  REDIS_URL: z.string().optional(),

  // ---- Secrets ----------------------------------------------------------
  //
  // There used to be an `AUTH_SECRET` here, described as the session cookie
  // signing key and refused-to-start-without in production. Nothing read it.
  // Sessions and BYOS worker tokens are long random strings persisted only as
  // SHA-256 digests, so no signing key is involved in either — a scheme that is
  // fine, but not the one the variable claimed. Requiring an operator to mint a
  // credential, telling them to keep it in a secret manager and implying that
  // rotating it ends every session, when it does nothing at all, is worse than
  // having no such control. `BYOS_TOKEN_SECRET` was the same, derived from it
  // and equally unread. Both are gone; setting them now is simply ignored.
  /** base64 32-byte key for AES-256-GCM encryption of user API keys. */
  ENCRYPTION_KEY: z.string().optional(),

  // ---- Mode -------------------------------------------------------------
  /** Force demo mode even when credentials exist. */
  KARO_DEMO_MODE: bool(false),
  /** Allow signing into the seeded demo account from the login screen. */
  KARO_ALLOW_DEMO_LOGIN: bool(true),

  // ---- Model providers --------------------------------------------------
  /**
   * Which provider serves model traffic.
   *
   * `auto` (the default) picks the configured provider with the best
   * value-for-money ranking — see `autoPriority` in
   * `src/lib/ai/providers/descriptors.ts`. Name a key (`wandb`, `deepseek`,
   * `zai`, `openrouter`, `groq`, `cerebras`, `moonshot`, `omniakey`, `ollama`)
   * to pin one, or `mock` to force the simulator.
   *
   * The per-provider credentials themselves (`WANDB_API_KEY`, `ZAI_API_KEY`, …)
   * are deliberately **not** listed in this schema. The descriptor registry is
   * their single source of truth, so adding a provider stays a one-entry data
   * change instead of an edit in two files that can silently disagree.
   * `.env.example` documents every variable.
   */
  AI_PROVIDER: z.string().default('auto'),

  /**
   * Omniakey exposes an OpenAI-compatible Chat Completions API. Claude, GPT,
   * Gemini and Grok model ids are all reachable through this one base URL.
   * See https://docs.omniakey.com/en/introduction
   */
  OMNIAKEY_BASE_URL: z.string().default('https://api.omniakey.com/v1'),
  /** Public catalogue page used to refresh model ids and prices. */
  OMNIAKEY_MODELS_URL: z.string().default('https://omniakey.com/models'),
  // `OMNIAKEY_API_KEY` was declared here too, three lines under the comment
  // saying provider credentials deliberately are not — a leftover from when
  // Omniakey was the only provider. The descriptor registry already reads it,
  // exactly as it reads the other twelve, so the entry did nothing but make one
  // provider look special. `OMNIAKEY_SYNC_INTERVAL_MINUTES` went with it: the
  // catalogue's staleness window is an admin setting, and nothing read this.

  // ---- Sandbox providers ------------------------------------------------
  /** `auto` picks the best available provider at runtime. */
  SANDBOX_PROVIDER: z
    .enum(['auto', 'mock', 'local-docker', 'daytona', 'remote-docker'])
    .default('auto'),
  DOCKER_SOCKET: z.string().optional(),
  DOCKER_HOST: z.string().optional(),
  SANDBOX_IMAGE: z.string().default('karo/sandbox-base:1'),
  SANDBOX_NETWORK: z.string().default('karo-sandbox'),

  DAYTONA_API_URL: z.string().optional(),
  DAYTONA_API_KEY: z.string().optional(),
  DAYTONA_TARGET: z.string().optional(),

  // ---- Bring Your Own Server -------------------------------------------
  /**
   * Mirror to fetch the worker agent from, if you keep one. Empty — the default
   * — serves it from this deployment's own `/api/worker/install`. It used to
   * default to `https://get.karo.dev/worker.sh`, a domain that does not exist,
   * so the install command the UI printed could never succeed.
   */
  BYOS_INSTALL_SCRIPT_URL: z.string().default(''),

  // ---- Billing ----------------------------------------------------------
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // ---- OAuth sign-in (both free tiers) ----------------------------------
  /**
   * GitHub: Settings → Developer settings → OAuth Apps. Google: Google Cloud
   * Console → OAuth consent screen + OAuth client ID (Web application).
   * Register the redirect `${APP_URL}/api/auth/oauth/<provider>/callback` in
   * each. A provider with both halves set shows its button on the login and
   * register screens; identities are matched by provider account id, then by
   * verified email (linking onto an existing password account).
   */
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ---- Email ------------------------------------------------------------
  /**
   * `console` writes verification links to the server log (dev default).
   * `smtp` delivers over `SMTP_URL` and is required for a real deployment —
   * sign-up cannot complete without a link reaching the customer's inbox.
   */
  EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('Karo <no-reply@karo.local>'),
  SMTP_URL: z.string().optional(),

  // ---- Safety rails -----------------------------------------------------
  RATE_LIMIT_DISABLED: bool(false),
  /** Comma-separated hosts the SSRF guard will additionally allow. */
  OUTBOUND_ALLOWED_HOSTS: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  SEED_DEMO_PASSWORD: z.string().default('karo-demo-2025'),
  SEED_ADMIN_EMAIL: z.string().default('admin@karo.local'),
  SEED_ADMIN_PASSWORD: z.string().default('karo-admin-2025'),
});

export type ServerEnv = Omit<z.infer<typeof serverSchema>, 'AI_PROVIDER'> & {
  /** Resolved: is the whole product running on mocks? */
  DEMO_MODE: boolean;
  /**
   * The resolved provider key — never `auto`. `mock` means the simulator, which
   * is what an unconfigured install gets.
   */
  AI_PROVIDER: string;
  /** Human label for the resolved provider, for the UI and health endpoint. */
  AI_PROVIDER_NAME: string;
  /** Every provider with platform credentials, best value first. */
  AI_PROVIDERS_CONFIGURED: string[];
  BILLING_PROVIDER: 'stripe' | 'mock';
  RESOLVED_SANDBOX_PROVIDER: 'mock' | 'local-docker' | 'daytona' | 'remote-docker';
  ENCRYPTION_KEY: string;
};

let cached: ServerEnv | null = null;
const warned = new Set<string>();

function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);

  console.warn(`[karo:env] ${message}`);
}

/**
 * `next build` evaluates every module to collect page data, which means this
 * loader runs with `NODE_ENV=production` on a machine that legitimately has no
 * production secrets — a CI image, a Docker build stage, a developer running
 * `npm run build` locally. Failing there would force secrets into the build
 * environment, which is exactly what we do not want. So the hard production
 * checks are skipped during the build phase and enforced at request time.
 */
function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_PHASE === 'phase-export'
  );
}

function loadServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production' && !isBuildPhase();

  let encryptionKey = e.ENCRYPTION_KEY;
  if (!encryptionKey) {
    if (isProd) {
      throw new Error(
        'ENCRYPTION_KEY is required in production. Generate one with: openssl rand -base64 32',
      );
    }
    warnOnce(
      'enc',
      'ENCRYPTION_KEY is unset — user API keys will be encrypted with a development fallback key.',
    );
    encryptionKey = Buffer.from(`karo-dev-encryption-key-32-bytes`.padEnd(32, '.')).toString(
      'base64',
    );
  }

  // ---- Email ------------------------------------------------------------
  //
  // Mail is not an optional integration the way Stripe or Daytona are. A user
  // who is not the operator cannot finish signing up or recover an account
  // without a link arriving in their inbox, so a production process that cannot
  // send mail is not degraded — it is broken for every customer. Both failure
  // shapes are caught here, at boot, instead of at the first sign-up.
  if (e.EMAIL_TRANSPORT === 'smtp' && !e.SMTP_URL?.trim()) {
    if (isProd) {
      throw new Error(
        'EMAIL_TRANSPORT=smtp requires SMTP_URL, for example smtps://user:pass@smtp.example.com:465.',
      );
    }
    warnOnce(
      'smtp',
      'EMAIL_TRANSPORT=smtp but SMTP_URL is unset — sending will fail. Unset EMAIL_TRANSPORT to use the console transport.',
    );
  }
  if (isProd && e.EMAIL_TRANSPORT === 'console') {
    warnOnce(
      'email:console',
      'EMAIL_TRANSPORT=console in production — verification and password-reset links will be written to the server log instead of delivered. Set EMAIL_TRANSPORT=smtp and SMTP_URL.',
    );
  }

  // Which providers actually hold credentials right now, best value first.
  const configuredProviders = e.KARO_DEMO_MODE
    ? []
    : [...PROVIDER_DESCRIPTORS]
        .sort((a, b) => a.autoPriority - b.autoPriority)
        .filter((d) => descriptorIsConfigured(d, process.env))
        .map((d) => d.key);

  let aiProvider: string;
  if (e.KARO_DEMO_MODE || e.AI_PROVIDER === 'mock') {
    aiProvider = 'mock';
  } else if (e.AI_PROVIDER !== 'auto') {
    // An explicit pin is honoured even when that provider has no credentials —
    // failing loudly beats silently serving a different provider's models. The
    // request-time resolver still degrades to the simulator, and the demo badge
    // explains why.
    aiProvider = e.AI_PROVIDER;
    if (!configuredProviders.includes(aiProvider)) {
      const descriptor = PROVIDER_DESCRIPTORS.find((d) => d.key === aiProvider);
      warnOnce(
        `ai:${aiProvider}`,
        descriptor
          ? `AI_PROVIDER=${aiProvider} is pinned but ${descriptor.apiKeyEnv ?? descriptor.baseUrlEnv} is unset — model traffic will fall back to the simulator.`
          : `AI_PROVIDER=${aiProvider} is not a known provider key — model traffic will fall back to the simulator.`,
      );
    }
  } else {
    aiProvider = configuredProviders[0] ?? 'mock';
  }

  const aiProviderName =
    aiProvider === 'mock'
      ? 'Karo simulator'
      : (PROVIDER_DESCRIPTORS.find((d) => d.key === aiProvider)?.displayName ?? aiProvider);

  const billingProvider: 'stripe' | 'mock' =
    !e.KARO_DEMO_MODE && e.STRIPE_SECRET_KEY ? 'stripe' : 'mock';

  let sandboxProvider: ServerEnv['RESOLVED_SANDBOX_PROVIDER'];
  if (e.KARO_DEMO_MODE) {
    sandboxProvider = 'mock';
  } else if (e.SANDBOX_PROVIDER !== 'auto') {
    sandboxProvider = e.SANDBOX_PROVIDER;
  } else if (e.DAYTONA_API_KEY && e.DAYTONA_API_URL) {
    sandboxProvider = 'daytona';
  } else if (e.DOCKER_SOCKET || e.DOCKER_HOST) {
    sandboxProvider = 'local-docker';
  } else {
    sandboxProvider = 'mock';
  }

  const demoMode = e.KARO_DEMO_MODE || (aiProvider === 'mock' && billingProvider === 'mock');

  cached = {
    ...e,
    ENCRYPTION_KEY: encryptionKey,
    AI_PROVIDER: aiProvider,
    AI_PROVIDER_NAME: aiProviderName,
    AI_PROVIDERS_CONFIGURED: configuredProviders,
    BILLING_PROVIDER: billingProvider,
    RESOLVED_SANDBOX_PROVIDER: sandboxProvider,
    DEMO_MODE: demoMode,
  };

  return cached;
}

/**
 * Server-only environment. Importing this from a Client Component is a build
 * error because it reads `process.env` at call time on the server.
 */
export const env: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    return loadServerEnv()[prop as keyof ServerEnv];
  },
  has(_target, prop: string) {
    return prop in loadServerEnv();
  },
  ownKeys() {
    return Reflect.ownKeys(loadServerEnv());
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

/** Force-validate the environment (used by scripts and health checks). */
export function assertEnv(): ServerEnv {
  return loadServerEnv();
}

/** Reset the cache — tests only. */
export function __resetEnvCache() {
  cached = null;
  warned.clear();
}

/**
 * Values that are safe to send to the browser. Everything here is either
 * public by nature or a boolean feature flag.
 */
export type PublicConfig = {
  appName: string;
  appUrl: string;
  demoMode: boolean;
  allowDemoLogin: boolean;
  /** Resolved provider key — `mock` when nothing is configured. */
  aiProvider: string;
  aiProviderName: string;
  billingProvider: 'stripe' | 'mock';
  sandboxProvider: ServerEnv['RESOLVED_SANDBOX_PROVIDER'];
};

export function publicConfig(): PublicConfig {
  const e = loadServerEnv();
  return {
    appName: e.APP_NAME,
    appUrl: e.APP_URL,
    demoMode: e.DEMO_MODE,
    allowDemoLogin: e.KARO_ALLOW_DEMO_LOGIN,
    aiProvider: e.AI_PROVIDER,
    aiProviderName: e.AI_PROVIDER_NAME,
    billingProvider: e.BILLING_PROVIDER,
    sandboxProvider: e.RESOLVED_SANDBOX_PROVIDER,
  };
}
