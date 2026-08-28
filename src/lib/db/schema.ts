import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* ==================================================================== *
 *  Karo database schema
 *
 *  Conventions
 *  -----------
 *  · Primary keys are prefixed strings (`prj_...`) produced by `newId()`.
 *  · **All money is integer micro-USD** (1e-6 USD). Per-token upstream costs
 *    are far below a cent, so cents would silently round margin to zero.
 *    Column names ending in `MicroUsd` are always integers in that unit.
 *  · Timestamps are `timestamptz`; the app never stores naive local time.
 *  · A *team* is the billing entity. Every user gets a personal team at
 *    signup, so quota, subscription and PAYG logic has exactly one shape.
 * ==================================================================== */

const id = (name = 'id') => text(name).primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);

/* ------------------------------------------------------------------ *
 *  Enums
 * ------------------------------------------------------------------ */

export const platformRoleEnum = pgEnum('platform_role', ['user', 'admin']);
export const teamRoleEnum = pgEnum('team_role', ['owner', 'admin', 'developer', 'viewer']);
export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
]);

export const runtimeTargetEnum = pgEnum('runtime_target', [
  'karo_cloud',
  'own_server',
  'external_sandbox',
  'local',
]);

export const sandboxStatusEnum = pgEnum('sandbox_status', [
  'creating',
  'starting',
  'running',
  'sleeping',
  'stopping',
  'stopped',
  'failed',
  'destroyed',
]);

export const shellEnum = pgEnum('shell_kind', ['bash', 'sh', 'powershell', 'cmd']);

export const agentModeEnum = pgEnum('agent_mode', ['ask', 'plan', 'build', 'auto']);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system', 'tool']);

export const messageStatusEnum = pgEnum('message_status', [
  'pending',
  'streaming',
  'complete',
  'stopped',
  'failed',
]);

export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
  'cancelled',
]);

export const toolCallStatusEnum = pgEnum('tool_call_status', [
  'pending',
  'awaiting_approval',
  'running',
  'succeeded',
  'failed',
  'rejected',
]);

export const planTierEnum = pgEnum('plan_tier', ['payg', 'lite', 'pro', 'scale', 'ultra']);

export const byosCommandStatusEnum = pgEnum('byos_command_status', [
  'queued',
  'claimed',
  'completed',
  'failed',
  'expired',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused',
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'open',
  'paid',
  'void',
  'uncollectible',
]);

export const topupStatusEnum = pgEnum('topup_status', [
  'pending',
  'succeeded',
  'failed',
  'refunded',
]);

export const usageKindEnum = pgEnum('usage_kind', ['model', 'compute', 'storage', 'egress']);

export const mcpTransportEnum = pgEnum('mcp_transport', ['stdio', 'http', 'sse']);

export const scopeEnum = pgEnum('resource_scope', ['account', 'project']);

export const connectionStatusEnum = pgEnum('connection_status', [
  'disconnected',
  'connecting',
  'connected',
  'error',
]);

export const notificationLevelEnum = pgEnum('notification_level', [
  'info',
  'success',
  'warning',
  'error',
]);

export const auditSeverityEnum = pgEnum('audit_severity', [
  'info',
  'notice',
  'warning',
  'critical',
]);

export const incidentStatusEnum = pgEnum('incident_status', [
  'open',
  'investigating',
  'monitoring',
  'resolved',
]);

export const incidentSeverityEnum = pgEnum('incident_severity', [
  'sev1',
  'sev2',
  'sev3',
  'sev4',
]);

export const workerStatusEnum = pgEnum('worker_status', [
  'pending',
  'online',
  'offline',
  'revoked',
]);

export const emailTokenKindEnum = pgEnum('email_token_kind', [
  'verify_email',
  'reset_password',
]);

export const pluginCategoryEnum = pgEnum('plugin_category', [
  'development',
  'databases',
  'deployment',
  'browser',
  'automation',
  'testing',
  'ai',
  'communication',
]);

export const fileChangeKindEnum = pgEnum('file_change_kind', [
  'created',
  'modified',
  'deleted',
  'renamed',
]);

/* ------------------------------------------------------------------ *
 *  Identity
 * ------------------------------------------------------------------ */

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    name: text('name').notNull().default(''),
    avatarUrl: text('avatar_url'),
    passwordHash: text('password_hash'),
    platformRole: platformRoleEnum('platform_role').notNull().default('user'),
    isDemo: boolean('is_demo').notNull().default(false),
    isSuspended: boolean('is_suspended').notNull().default(false),
    locale: text('locale').notNull().default('en'),
    theme: text('theme').notNull().default('dark'),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    onboardingState: jsonb('onboarding_state').$type<Record<string, unknown>>(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    defaultTeamId: text('default_team_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    index('users_created_at_idx').on(t.createdAt),
    index('users_platform_role_idx').on(t.platformRole),
  ],
);

/** OAuth / external identity links. Architecture is in place; no live IdP yet. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    scope: text('scope'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('accounts_provider_unique').on(t.provider, t.providerAccountId),
    index('accounts_user_idx').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the session token. The raw token only ever lives in a cookie. */
    tokenHash: text('token_hash').notNull(),
    /** Rotating CSRF token bound to this session. */
    csrfToken: text('csrf_token').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: emailTokenKindEnum('kind').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('email_tokens_hash_unique').on(t.tokenHash),
    index('email_tokens_user_kind_idx').on(t.userId, t.kind),
  ],
);

/* ------------------------------------------------------------------ *
 *  Teams
 * ------------------------------------------------------------------ */

export const teams = pgTable(
  'teams',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** A personal team is created implicitly at signup and cannot be deleted. */
    isPersonal: boolean('is_personal').notNull().default(true),
    avatarColor: text('avatar_color').notNull().default('primary'),
    stripeCustomerId: text('stripe_customer_id'),
    /** Hard stop on monthly spend, micro-USD. 0 = no cap. */
    spendCapMicroUsd: money('spend_cap_micro_usd'),
    /** Fraction of quota at which an alert fires (0.8 = 80%). */
    usageAlertThreshold: real('usage_alert_threshold').notNull().default(0.8),
    autoTopupEnabled: boolean('auto_topup_enabled').notNull().default(false),
    autoTopupThresholdMicroUsd: money('auto_topup_threshold_micro_usd'),
    autoTopupAmountMicroUsd: money('auto_topup_amount_micro_usd'),
    /**
     * Guard rails for automatic top-ups. Without the timestamp a team whose card
     * keeps succeeding but whose balance keeps failing the threshold would be
     * charged in a tight loop; without the counter a dead card would be retried
     * forever. Both are written by the top-up path, never by the user.
     */
    autoTopupLastChargedAt: timestamp('auto_topup_last_charged_at', { withTimezone: true }),
    autoTopupFailureCount: integer('auto_topup_failure_count').notNull().default(0),
    autoTopupLastError: text('auto_topup_last_error'),
    settings: jsonb('settings').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('teams_slug_unique').on(t.slug),
    index('teams_owner_idx').on(t.ownerId),
    index('teams_stripe_customer_idx').on(t.stripeCustomerId),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRoleEnum('role').notNull().default('developer'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('team_members_unique').on(t.teamId, t.userId),
    index('team_members_user_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: teamRoleEnum('role').notNull().default('developer'),
    invitedById: text('invited_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invitations_token_unique').on(t.tokenHash),
    index('invitations_team_idx').on(t.teamId),
    index('invitations_email_idx').on(sql`lower(${t.email})`),
  ],
);

/* ------------------------------------------------------------------ *
 *  Model catalogue & pricing
 * ------------------------------------------------------------------ */

export const providers = pgTable(
  'providers',
  {
    id: id(),
    /** Stable machine key: `wandb`, `deepseek`, `omniakey`, `mock`. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('model'),
    baseUrl: text('base_url'),
    catalogUrl: text('catalog_url'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    /** Multiplies compute cost when this provider hosts sandboxes. */
    computeMultiplier: real('compute_multiplier').notNull().default(1),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    healthStatus: connectionStatusEnum('health_status').notNull().default('disconnected'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('providers_key_unique').on(t.key)],
);

export const models = pgTable(
  'models',
  {
    id: id(),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    /** Upstream model identifier, passed verbatim to the provider API. */
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    family: text('family').notNull().default('other'),
    description: text('description').notNull().default(''),
    contextWindow: integer('context_window').notNull().default(128_000),
    maxOutputTokens: integer('max_output_tokens').notNull().default(8_192),
    supportsTools: boolean('supports_tools').notNull().default(true),
    supportsVision: boolean('supports_vision').notNull().default(false),
    supportsCaching: boolean('supports_caching').notNull().default(false),
    supportsStreaming: boolean('supports_streaming').notNull().default(true),
    /** Lowest plan tier allowed to select this model. */
    minPlanTier: planTierEnum('min_plan_tier').notNull().default('payg'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    /** Set by an admin to pin values against catalogue sync. */
    adminOverride: jsonb('admin_override').$type<Record<string, unknown>>(),
    sortOrder: integer('sort_order').notNull().default(100),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('models_provider_slug_unique').on(t.providerId, t.slug),
    index('models_enabled_idx').on(t.isEnabled),
    index('models_family_idx').on(t.family),
  ],
);

/**
 * Append-only price history. The row with `effectiveTo IS NULL` is current;
 * historic rows keep old usage events auditable after a catalogue refresh.
 */
export const modelPrices = pgTable(
  'model_prices',
  {
    id: id(),
    modelId: text('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    /** Micro-USD per 1 000 000 tokens (i.e. the usual "$/M tokens" figure). */
    inputMicroUsdPerMtok: bigint('input_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    outputMicroUsdPerMtok: bigint('output_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    cachedInputMicroUsdPerMtok: bigint('cached_input_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    cacheWriteMicroUsdPerMtok: bigint('cache_write_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    source: text('source').notNull().default('catalog'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('model_prices_model_idx').on(t.modelId, t.effectiveFrom),
    index('model_prices_current_idx').on(t.modelId, t.effectiveTo),
  ],
);

/** BYOK: user-supplied provider keys, encrypted at rest with AES-256-GCM. */
export const userApiKeys = pgTable(
  'user_api_keys',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    providerKey: text('provider_key').notNull(),
    baseUrl: text('base_url'),
    /** `v1:<iv>:<tag>:<ciphertext>` — never leaves the server. */
    keyCiphertext: text('key_ciphertext').notNull(),
    /** Last 4 characters, for display only. */
    keyLast4: text('key_last4').notNull(),
    keyFingerprint: text('key_fingerprint').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastVerifyError: text('last_verify_error'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('user_api_keys_user_idx').on(t.userId),
    uniqueIndex('user_api_keys_fingerprint_unique').on(t.userId, t.keyFingerprint),
  ],
);

/* ------------------------------------------------------------------ *
 *  Plans, subscriptions, balances
 * ------------------------------------------------------------------ */

export const plans = pgTable(
  'plans',
  {
    id: id(),
    key: text('key').notNull(),
    tier: planTierEnum('tier').notNull(),
    name: text('name').notNull(),
    tagline: text('tagline').notNull().default(''),
    description: text('description').notNull().default(''),
    priceMicroUsdMonthly: money('price_micro_usd_monthly'),
    priceMicroUsdYearly: money('price_micro_usd_yearly'),
    stripePriceIdMonthly: text('stripe_price_id_monthly'),
    stripePriceIdYearly: text('stripe_price_id_yearly'),

    /* ---- Quotas: every number here is admin-editable, never hard-coded ---- */
    includedWeightedTokens: bigint('included_weighted_tokens', { mode: 'number' })
      .notNull()
      .default(0),
    includedComputeHours: real('included_compute_hours').notNull().default(0),
    maxActiveSandboxes: integer('max_active_sandboxes').notNull().default(1),
    maxSandboxMemoryMb: integer('max_sandbox_memory_mb').notNull().default(512),
    maxSandboxCpuCores: real('max_sandbox_cpu_cores').notNull().default(0.25),
    storageGb: integer('storage_gb').notNull().default(5),
    maxTeamMembers: integer('max_team_members').notNull().default(1),
    maxProjects: integer('max_projects').notNull().default(10),
    maxSkills: integer('max_skills').notNull().default(5),
    maxPlugins: integer('max_plugins').notNull().default(5),
    maxMcpServers: integer('max_mcp_servers').notNull().default(3),
    maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(1),
    queuePriority: integer('queue_priority').notNull().default(0),
    auditRetentionDays: integer('audit_retention_days').notNull().default(7),
    autoSleepMinutes: integer('auto_sleep_minutes').notNull().default(15),
    autoDestroyHours: integer('auto_destroy_hours').notNull().default(72),

    /* ---- Capability flags ---- */
    allowByok: boolean('allow_byok').notNull().default(false),
    allowDocker: boolean('allow_docker').notNull().default(false),
    allowOwnServer: boolean('allow_own_server').notNull().default(true),
    allowExternalSandbox: boolean('allow_external_sandbox').notNull().default(false),
    allowCustomSandboxSize: boolean('allow_custom_sandbox_size').notNull().default(false),
    allowPreviewDeployments: boolean('allow_preview_deployments').notNull().default(false),
    allowPrivateSkills: boolean('allow_private_skills').notNull().default(false),
    allowApiAccess: boolean('allow_api_access').notNull().default(false),
    allowSso: boolean('allow_sso').notNull().default(false),
    allowDedicatedWorker: boolean('allow_dedicated_worker').notNull().default(false),
    allowCustomModelRouting: boolean('allow_custom_model_routing').notNull().default(false),
    allowedShells: jsonb('allowed_shells').$type<string[]>().notNull().default(['bash']),
    supportLevel: text('support_level').notNull().default('community'),

    /* ---- Overage & margin ---- */
    /** Applied on top of upstream model cost, in basis points (2000 = +20%). */
    marginBps: integer('margin_bps').notNull().default(2000),
    /** Price charged per 1M weighted tokens once the included quota is spent. */
    overageMicroUsdPerMWeighted: bigint('overage_micro_usd_per_m_weighted', { mode: 'number' })
      .notNull()
      .default(0),
    overageMicroUsdPerComputeHour: bigint('overage_micro_usd_per_compute_hour', {
      mode: 'number',
    })
      .notNull()
      .default(0),

    trialDays: integer('trial_days').notNull().default(0),
    isPublic: boolean('is_public').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Advertised but not purchasable yet: rendered on the marketing page with a
     * "coming soon" badge and refused at checkout, while the quotas stay
     * browsable. Distinct from `isActive` — an inactive plan disappears from
     * the marketing page entirely.
     */
    comingSoon: boolean('coming_soon').notNull().default(false),
    highlight: boolean('highlight').notNull().default(false),
    features: jsonb('features').$type<string[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(100),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('plans_key_unique').on(t.key), index('plans_tier_idx').on(t.tier)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    interval: text('interval').notNull().default('month'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true })
      .notNull()
      .defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    /**
     * A downgrade the team has asked for but which must not take effect yet.
     * The pricing page and the Terms both promise that downgrades apply at the
     * end of the current period, so the plan change is parked here and applied
     * at the renewal boundary rather than charged and swapped immediately.
     */
    pendingPlanId: text('pending_plan_id').references(() => plans.id, { onDelete: 'set null' }),
    pendingInterval: text('pending_interval'),
    pendingRequestedAt: timestamp('pending_requested_at', { withTimezone: true }),
    /** Snapshot of quota at purchase time; admin plan edits do not retro-apply. */
    quotaSnapshot: jsonb('quota_snapshot').$type<Record<string, number | boolean | string>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('subscriptions_team_unique').on(t.teamId),
    uniqueIndex('subscriptions_stripe_unique').on(t.stripeSubscriptionId),
    index('subscriptions_status_idx').on(t.status),
  ],
);

export const paygBalances = pgTable(
  'payg_balances',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    balanceMicroUsd: money('balance_micro_usd'),
    lifetimeToppedUpMicroUsd: money('lifetime_topped_up_micro_usd'),
    lifetimeSpentMicroUsd: money('lifetime_spent_micro_usd'),
    /** Allowed negative balance before execution is blocked. */
    creditLimitMicroUsd: money('credit_limit_micro_usd'),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payg_balances_team_unique').on(t.teamId)],
);

export const topups = pgTable(
  'topups',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    amountMicroUsd: money('amount_micro_usd'),
    bonusMicroUsd: money('bonus_micro_usd'),
    status: topupStatusEnum('status').notNull().default('pending'),
    provider: text('provider').notNull().default('mock'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    idempotencyKey: text('idempotency_key'),
    failureReason: text('failure_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('topups_team_idx').on(t.teamId, t.createdAt),
    uniqueIndex('topups_idempotency_unique').on(t.idempotencyKey),
  ],
);

/* ------------------------------------------------------------------ *
 *  Coupons — admin-minted promo codes
 * ------------------------------------------------------------------ */

export const couponKindEnum = pgEnum('coupon_kind', ['credit', 'plan_discount']);

/**
 * A promo code an operator mints in Admin → Coupons. Two kinds:
 *
 *  · `credit` — grants `amountMicroUsd` of bonus balance the moment it is
 *    redeemed in Billing (never at the Stripe checkout — promo codes there
 *    would be Stripe's, not Karo's). `creditFor` labels what the credit is
 *    meant to buy ('tokens' | 'compute' | 'any'); it is descriptive, since
 *    everything draws the same USD balance.
 *  · `plan_discount` — `percentOff` a specific `planTier` at subscription
 *    checkout, for handing someone a personal deal.
 *
 * `maxRedemptions` caps total activations across accounts; `maxPerTeam` caps
 * how often one team may redeem the same code.
 */
export const coupons = pgTable(
  'coupons',
  {
    id: id(),
    /** Stored uppercase; redemption is case-insensitive. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: couponKindEnum('kind').notNull(),
    amountMicroUsd: money('amount_micro_usd'),
    creditFor: text('credit_for').notNull().default('any'),
    percentOff: integer('percent_off'),
    planTier: planTierEnum('plan_tier'),
    maxRedemptions: integer('max_redemptions').notNull().default(1),
    maxPerTeam: integer('max_per_team').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('coupons_code_unique').on(t.code)],
);

export const couponRedemptionStatusEnum = pgEnum('coupon_redemption_status', [
  /** Granted and not yet consumed. A credit is `used` immediately; a plan
   * discount stays `active` until it prices a checkout. */
  'active',
  'used',
]);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: id(),
    couponId: text('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    redeemedById: text('redeemed_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: couponKindEnum('kind').notNull(),
    /** Credit granted (credit kind), or the percent locked in at redemption. */
    valueMicroUsd: money('value_micro_usd'),
    percentOff: integer('percent_off'),
    planTier: planTierEnum('plan_tier'),
    status: couponRedemptionStatusEnum('status').notNull().default('active'),
    topupId: text('topup_id').references(() => topups.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('coupon_redemptions_coupon_idx').on(t.couponId),
    index('coupon_redemptions_team_idx').on(t.teamId, t.status),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    subtotalMicroUsd: money('subtotal_micro_usd'),
    taxMicroUsd: money('tax_micro_usd'),
    totalMicroUsd: money('total_micro_usd'),
    amountPaidMicroUsd: money('amount_paid_micro_usd'),
    currency: text('currency').notNull().default('usd'),
    stripeInvoiceId: text('stripe_invoice_id'),
    hostedInvoiceUrl: text('hosted_invoice_url'),
    pdfUrl: text('pdf_url'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    lineItems: jsonb('line_items')
      .$type<Array<{ label: string; quantity: number; amountMicroUsd: number }>>()
      .notNull()
      .default([]),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_number_unique').on(t.number),
    index('invoices_team_idx').on(t.teamId, t.createdAt),
    uniqueIndex('invoices_stripe_unique').on(t.stripeInvoiceId),
  ],
);

/** Deduplicates webhook deliveries and unsafe POST retries. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    responseHash: text('response_hash'),
    responseBody: jsonb('response_body').$type<unknown>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('idempotency_scope_key_unique').on(t.scope, t.key),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);

/* ------------------------------------------------------------------ *
 *  Projects & files
 * ------------------------------------------------------------------ */

export const projects = pgTable(
  'projects',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    template: text('template').notNull().default('blank'),
    runtimeTarget: runtimeTargetEnum('runtime_target').notNull().default('karo_cloud'),
    /** For `own_server`: which registered worker runs this project. */
    workerId: text('worker_id'),
    defaultModelId: text('default_model_id').references(() => models.id, {
      onDelete: 'set null',
    }),
    defaultAgentMode: agentModeEnum('default_agent_mode').notNull().default('build'),
    defaultShell: shellEnum('default_shell').notNull().default('bash'),
    /** Per-project agent permission matrix (see `lib/rbac/permissions.ts`). */
    permissions: jsonb('permissions').$type<Record<string, boolean | string[]>>(),
    gitRemoteUrl: text('git_remote_url'),
    gitBranch: text('git_branch').notNull().default('main'),
    envVars: jsonb('env_vars').$type<Record<string, string>>(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    lastOpenedAt: timestamp('last_opened_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_team_slug_unique').on(t.teamId, t.slug),
    index('projects_team_idx').on(t.teamId, t.updatedAt),
    index('projects_created_by_idx').on(t.createdById),
  ],
);

export const projectFiles = pgTable(
  'project_files',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Workspace-relative POSIX path. Always validated against traversal. */
    path: text('path').notNull(),
    content: text('content').notNull().default(''),
    isDirectory: boolean('is_directory').notNull().default(false),
    isBinary: boolean('is_binary').notNull().default(false),
    sizeBytes: integer('size_bytes').notNull().default(0),
    contentHash: text('content_hash').notNull().default(''),
    language: text('language'),
    /** Set while an agent edit is pending user approval. */
    pendingContent: text('pending_content'),
    pendingChangeKind: fileChangeKindEnum('pending_change_kind'),
    pendingByRunId: text('pending_by_run_id'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('project_files_path_unique').on(t.projectId, t.path),
    index('project_files_project_idx').on(t.projectId),
    index('project_files_pending_idx').on(t.projectId, t.pendingChangeKind),
  ],
);

/* ------------------------------------------------------------------ *
 *  Sandboxes
 * ------------------------------------------------------------------ */

export const sandboxes = pgTable(
  'sandboxes',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('mock'),
    /** Identifier assigned by the provider (container id, workspace id, …). */
    externalId: text('external_id'),
    workerId: text('worker_id'),
    status: sandboxStatusEnum('status').notNull().default('creating'),
    statusMessage: text('status_message'),
    image: text('image').notNull().default('karo/sandbox-base:1'),
    region: text('region'),

    cpuCores: real('cpu_cores').notNull().default(0.25),
    memoryMb: integer('memory_mb').notNull().default(512),
    diskGb: integer('disk_gb').notNull().default(5),
    /** CPU × RAM × provider multiplier, snapshotted at creation. */
    computeMultiplier: real('compute_multiplier').notNull().default(1),

    /* Live telemetry, refreshed by the metrics poller. */
    cpuPercent: real('cpu_percent').notNull().default(0),
    memoryUsedMb: integer('memory_used_mb').notNull().default(0),
    diskUsedMb: integer('disk_used_mb').notNull().default(0),
    processCount: integer('process_count').notNull().default(0),

    autoSleepMinutes: integer('auto_sleep_minutes').notNull().default(15),
    autoDestroyHours: integer('auto_destroy_hours').notNull().default(72),
    networkPolicy: text('network_policy').notNull().default('restricted'),
    allowDocker: boolean('allow_docker').notNull().default(false),

    totalActiveSeconds: integer('total_active_seconds').notNull().default(0),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sandboxes_team_status_idx').on(t.teamId, t.status),
    index('sandboxes_project_idx').on(t.projectId),
    index('sandboxes_provider_external_idx').on(t.provider, t.externalId),
  ],
);

/** One row per running window of a sandbox — the unit compute is billed on. */
export const sandboxSessions = pgTable(
  'sandbox_sessions',
  {
    id: id(),
    sandboxId: text('sandbox_id')
      .notNull()
      .references(() => sandboxes.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    activeSeconds: integer('active_seconds').notNull().default(0),
    stopReason: text('stop_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sandbox_sessions_sandbox_idx').on(t.sandboxId, t.startedAt),
    index('sandbox_sessions_team_idx').on(t.teamId, t.startedAt),
  ],
);

export const terminalSessions = pgTable(
  'terminal_sessions',
  {
    id: id(),
    sandboxId: text('sandbox_id')
      .notNull()
      .references(() => sandboxes.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('Terminal'),
    shell: shellEnum('shell').notNull().default('bash'),
    cwd: text('cwd').notNull().default('/workspace'),
    cols: integer('cols').notNull().default(80),
    rows: integer('rows').notNull().default(24),
    isActive: boolean('is_active').notNull().default(true),
    /** Ring buffer of recent output so a reconnect can restore the screen. */
    scrollback: text('scrollback').notNull().default(''),
    history: jsonb('history').$type<string[]>().notNull().default([]),
    exitCode: integer('exit_code'),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('terminal_sessions_sandbox_idx').on(t.sandboxId),
    index('terminal_sessions_user_idx').on(t.userId, t.lastActiveAt),
  ],
);

/** Bring-Your-Own-Server workers: outbound-only agents on user hardware. */
export const byosWorkers = pgTable(
  'byos_workers',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: workerStatusEnum('status').notNull().default('pending'),
    /** SHA-256 of the one-time installation token. */
    installTokenHash: text('install_token_hash').notNull(),
    installTokenExpiresAt: timestamp('install_token_expires_at', {
      withTimezone: true,
    }).notNull(),
    /** SHA-256 of the long-lived worker credential issued after registration. */
    workerTokenHash: text('worker_token_hash'),
    tokenRotatedAt: timestamp('token_rotated_at', { withTimezone: true }),
    hostname: text('hostname'),
    platform: text('platform'),
    arch: text('arch'),
    agentVersion: text('agent_version'),
    capabilities: jsonb('capabilities').$type<Record<string, unknown>>(),
    cpuCores: real('cpu_cores'),
    memoryMb: integer('memory_mb'),
    diskGb: integer('disk_gb'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    registeredAt: timestamp('registered_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('byos_workers_install_token_unique').on(t.installTokenHash),
    index('byos_workers_team_idx').on(t.teamId, t.status),
  ],
);

/* ------------------------------------------------------------------ *
 *  Conversations, messages, agent runs
 * ------------------------------------------------------------------ */

/**
 * Karo Worker Protocol v1 command queue.
 *
 * Commands for BYOS workers are persisted, not held in process memory: on
 * serverless hosting the instance that queues a "create sandbox" command is
 * rarely the instance holding the worker's long-poll, and an in-memory queue
 * would strand the command until its timeout on every request. The long-poll
 * claims queued rows with `FOR UPDATE SKIP LOCKED`, so any instance can serve
 * any worker, and a second worker of the same team can never steal a command.
 */
export const byosCommands = pgTable(
  'byos_commands',
  {
    id: id(),
    workerId: text('worker_id')
      .notNull()
      .references(() => byosWorkers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** The full command payload exactly as dispatched. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: byosCommandStatusEnum('status').notNull().default('queued'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    /** Past this point an unclaimed command expires; its caller gives up. */
    timeoutAt: timestamp('timeout_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('byos_commands_worker_idx').on(t.workerId, t.status, t.createdAt)],
);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New chat'),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    agentMode: agentModeEnum('agent_mode').notNull().default('build'),
    /** Rolling summary written by `/compact`. */
    summary: text('summary'),
    messageCount: integer('message_count').notNull().default(0),
    totalInputTokens: integer('total_input_tokens').notNull().default(0),
    totalOutputTokens: integer('total_output_tokens').notNull().default(0),
    totalWeightedTokens: bigint('total_weighted_tokens', { mode: 'number' })
      .notNull()
      .default(0),
    totalChargedMicroUsd: money('total_charged_micro_usd'),
    isPinned: boolean('is_pinned').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('conversations_project_idx').on(t.projectId, t.updatedAt),
    index('conversations_user_idx').on(t.userId, t.updatedAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull().default(''),
    /** Structured reasoning/plan block rendered in a collapsible section. */
    thinking: text('thinking'),
    status: messageStatusEnum('status').notNull().default('complete'),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    agentMode: agentModeEnum('agent_mode'),
    /** Ordinal within the conversation; drives edit-and-resend truncation. */
    sequence: integer('sequence').notNull().default(0),
    parentMessageId: text('parent_message_id'),
    editedAt: timestamp('edited_at', { withTimezone: true }),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    weightedTokens: bigint('weighted_tokens', { mode: 'number' }).notNull().default(0),
    upstreamCostMicroUsd: money('upstream_cost_micro_usd'),
    chargedMicroUsd: money('charged_micro_usd'),
    latencyMs: integer('latency_ms').notNull().default(0),
    timeToFirstTokenMs: integer('time_to_first_token_ms'),
    finishReason: text('finish_reason'),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.sequence),
    index('messages_run_idx').on(t.runId),
    index('messages_created_idx').on(t.createdAt),
  ],
);

export const messageAttachments = pgTable(
  'message_attachments',
  {
    id: id(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('file'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull().default('application/octet-stream'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    /** Small text/image payloads are inlined; larger ones go to object storage. */
    inlineContent: text('inline_content'),
    storageKey: text('storage_key'),
    createdAt: createdAt(),
  },
  (t) => [index('message_attachments_message_idx').on(t.messageId)],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: id(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sandboxId: text('sandbox_id').references(() => sandboxes.id, { onDelete: 'set null' }),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    mode: agentModeEnum('mode').notNull().default('build'),
    status: runStatusEnum('status').notNull().default('queued'),
    title: text('title').notNull().default('Agent run'),
    /** Plan steps in `plan`/`auto` mode, rendered in the Tasks tab. */
    steps: jsonb('steps')
      .$type<Array<{ id: string; title: string; status: string; detail?: string }>>()
      .notNull()
      .default([]),
    stopReason: text('stop_reason'),
    errorMessage: text('error_message'),
    iterations: integer('iterations').notNull().default(0),
    maxIterations: integer('max_iterations').notNull().default(24),
    totalInputTokens: integer('total_input_tokens').notNull().default(0),
    totalOutputTokens: integer('total_output_tokens').notNull().default(0),
    totalWeightedTokens: bigint('total_weighted_tokens', { mode: 'number' })
      .notNull()
      .default(0),
    totalChargedMicroUsd: money('total_charged_micro_usd'),
    usedByok: boolean('used_byok').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('agent_runs_conversation_idx').on(t.conversationId, t.createdAt),
    index('agent_runs_project_idx').on(t.projectId, t.createdAt),
    index('agent_runs_status_idx').on(t.status),
    index('agent_runs_team_idx').on(t.teamId, t.createdAt),
  ],
);

export const toolCalls = pgTable(
  'tool_calls',
  {
    id: id(),
    runId: text('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    /** Identifier assigned by the model, used to correlate the tool result. */
    externalCallId: text('external_call_id'),
    toolName: text('tool_name').notNull(),
    /** `builtin` | `mcp` | `plugin` | `skill` */
    source: text('source').notNull().default('builtin'),
    sourceRef: text('source_ref'),
    args: jsonb('args').$type<Record<string, unknown>>(),
    result: text('result'),
    resultSummary: text('result_summary'),
    status: toolCallStatusEnum('status').notNull().default('pending'),
    /** True for commands matched by the destructive-command policy. */
    requiresApproval: boolean('requires_approval').notNull().default(false),
    approvedById: text('approved_by_id').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedReason: text('rejected_reason'),
    isError: boolean('is_error').notNull().default(false),
    exitCode: integer('exit_code'),
    durationMs: integer('duration_ms').notNull().default(0),
    sequence: integer('sequence').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tool_calls_run_idx').on(t.runId, t.sequence),
    index('tool_calls_message_idx').on(t.messageId),
    index('tool_calls_status_idx').on(t.status),
  ],
);

/* ------------------------------------------------------------------ *
 *  MCP
 * ------------------------------------------------------------------ */

export const mcpServers = pgTable(
  'mcp_servers',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    scope: scopeEnum('scope').notNull().default('account'),
    transport: mcpTransportEnum('transport').notNull().default('stdio'),
    command: text('command'),
    args: jsonb('args').$type<string[]>().notNull().default([]),
    url: text('url'),
    headers: jsonb('headers').$type<Record<string, string>>(),
    env: jsonb('env').$type<Record<string, string>>(),
    /** Secret env values, AES-256-GCM encrypted; keys stay in `env`. */
    secretsCiphertext: text('secrets_ciphertext'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    status: connectionStatusEnum('status').notNull().default('disconnected'),
    statusMessage: text('status_message'),
    /** Tools the agent may call from this server; empty = all discovered. */
    allowedTools: jsonb('allowed_tools').$type<string[]>().notNull().default([]),
    requireApproval: boolean('require_approval').notNull().default(true),
    lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
    lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
    logs: jsonb('logs')
      .$type<Array<{ at: string; level: string; message: string }>>()
      .notNull()
      .default([]),
    templateKey: text('template_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('mcp_servers_team_idx').on(t.teamId),
    index('mcp_servers_project_idx').on(t.projectId),
    uniqueIndex('mcp_servers_team_name_unique').on(t.teamId, t.name),
  ],
);

export const mcpTools = pgTable(
  'mcp_tools',
  {
    id: id(),
    serverId: text('server_id')
      .notNull()
      .references(() => mcpServers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    isDestructive: boolean('is_destructive').notNull().default(false),
    callCount: integer('call_count').notNull().default(0),
    lastCalledAt: timestamp('last_called_at', { withTimezone: true }),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mcp_tools_server_name_unique').on(t.serverId, t.name)],
);

/* ------------------------------------------------------------------ *
 *  Skills & plugins
 * ------------------------------------------------------------------ */

export const skills = pgTable(
  'skills',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    version: text('version').notNull().default('1.0.0'),
    author: text('author').notNull().default('Karo'),
    icon: text('icon').notNull().default('sparkles'),
    category: text('category').notNull().default('general'),
    allowedTools: jsonb('allowed_tools').$type<string[]>().notNull().default([]),
    requiredPlugins: jsonb('required_plugins').$type<string[]>().notNull().default([]),
    slashCommands: jsonb('slash_commands')
      .$type<Array<{ name: string; description: string; prompt: string }>>()
      .notNull()
      .default([]),
    environmentSchema: jsonb('environment_schema')
      .$type<
        Array<{
          key: string;
          label: string;
          required: boolean;
          secret: boolean;
          description?: string;
        }>
      >()
      .notNull()
      .default([]),
    /** `official` skills ship with Karo; `custom` are authored by a team. */
    origin: text('origin').notNull().default('official'),
    ownerTeamId: text('owner_team_id').references(() => teams.id, { onDelete: 'cascade' }),
    isPublic: boolean('is_public').notNull().default(true),
    installCount: integer('install_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('skills_key_unique').on(t.key),
    index('skills_owner_idx').on(t.ownerTeamId),
  ],
);

export const installedSkills = pgTable(
  'installed_skills',
  {
    id: id(),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    installedById: text('installed_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    scope: scopeEnum('scope').notNull().default('account'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    version: text('version').notNull().default('1.0.0'),
    config: jsonb('config').$type<Record<string, string>>(),
    secretsCiphertext: text('secrets_ciphertext'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('installed_skills_team_idx').on(t.teamId),
    uniqueIndex('installed_skills_unique').on(t.teamId, t.skillId, t.projectId),
  ],
);

export const plugins = pgTable(
  'plugins',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    longDescription: text('long_description').notNull().default(''),
    version: text('version').notNull().default('1.0.0'),
    publisher: text('publisher').notNull().default('Karo'),
    category: pluginCategoryEnum('category').notNull().default('development'),
    icon: text('icon').notNull().default('package'),
    /** Declared permissions shown before install. */
    permissions: jsonb('permissions')
      .$type<Array<{ key: string; label: string; risk: 'low' | 'medium' | 'high' }>>()
      .notNull()
      .default([]),
    configSchema: jsonb('config_schema')
      .$type<
        Array<{
          key: string;
          label: string;
          type: string;
          required: boolean;
          secret?: boolean;
          default?: string;
          description?: string;
        }>
      >()
      .notNull()
      .default([]),
    providedTools: jsonb('provided_tools').$type<string[]>().notNull().default([]),
    providedCommands: jsonb('provided_commands')
      .$type<Array<{ name: string; description: string }>>()
      .notNull()
      .default([]),
    /** Plan gate — e.g. the Docker plugin requires `pro`. */
    minPlanTier: planTierEnum('min_plan_tier').notNull().default('payg'),
    requiresPrivileged: boolean('requires_privileged').notNull().default(false),
    isVerified: boolean('is_verified').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    installCount: integer('install_count').notNull().default(0),
    homepageUrl: text('homepage_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('plugins_key_unique').on(t.key),
    index('plugins_category_idx').on(t.category),
  ],
);

export const installedPlugins = pgTable(
  'installed_plugins',
  {
    id: id(),
    pluginId: text('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    installedById: text('installed_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: text('version').notNull().default('1.0.0'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    config: jsonb('config').$type<Record<string, string>>(),
    secretsCiphertext: text('secrets_ciphertext'),
    grantedPermissions: jsonb('granted_permissions').$type<string[]>().notNull().default([]),
    healthStatus: connectionStatusEnum('health_status').notNull().default('disconnected'),
    healthMessage: text('health_message'),
    lastHealthCheckAt: timestamp('last_health_check_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('installed_plugins_team_idx').on(t.teamId),
    uniqueIndex('installed_plugins_unique').on(t.teamId, t.pluginId, t.projectId),
  ],
);

/* ------------------------------------------------------------------ *
 *  Metering
 * ------------------------------------------------------------------ */

export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    conversationId: text('conversation_id'),
    messageId: text('message_id'),
    runId: text('run_id'),

    kind: usageKindEnum('kind').notNull().default('model'),
    providerKey: text('provider_key').notNull().default('mock'),
    modelId: text('model_id').references(() => models.id, { onDelete: 'set null' }),
    modelSlug: text('model_slug').notNull().default(''),
    modelPriceId: text('model_price_id'),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** Weighted tokens: the unit plan quotas are denominated in. */
    weightedTokens: bigint('weighted_tokens', { mode: 'number' }).notNull().default(0),
    outputMultiplier: real('output_multiplier').notNull().default(1),

    upstreamCostMicroUsd: money('upstream_cost_micro_usd'),
    chargedMicroUsd: money('charged_micro_usd'),
    grossMarginMicroUsd: money('gross_margin_micro_usd'),
    /** How the charge was settled. */
    settlement: text('settlement').notNull().default('quota'),
    usedByok: boolean('used_byok').notNull().default(false),

    latencyMs: integer('latency_ms').notNull().default(0),
    status: text('status').notNull().default('success'),
    errorCode: text('error_code'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_events_team_time_idx').on(t.teamId, t.occurredAt),
    index('usage_events_project_time_idx').on(t.projectId, t.occurredAt),
    index('usage_events_model_time_idx').on(t.modelId, t.occurredAt),
    index('usage_events_user_time_idx').on(t.userId, t.occurredAt),
    index('usage_events_kind_idx').on(t.kind, t.occurredAt),
  ],
);

export const computeEvents = pgTable(
  'compute_events',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    sandboxId: text('sandbox_id').references(() => sandboxes.id, { onDelete: 'set null' }),
    sandboxSessionId: text('sandbox_session_id'),

    providerKey: text('provider_key').notNull().default('mock'),
    cpuCores: real('cpu_cores').notNull().default(0.25),
    memoryMb: integer('memory_mb').notNull().default(512),
    diskGb: integer('disk_gb').notNull().default(5),
    computeMultiplier: real('compute_multiplier').notNull().default(1),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    activeSeconds: integer('active_seconds').notNull().default(0),
    /** activeSeconds/3600 × multiplier — the unit plans include. */
    billedComputeHours: real('billed_compute_hours').notNull().default(0),

    upstreamCostMicroUsd: money('upstream_cost_micro_usd'),
    chargedMicroUsd: money('charged_micro_usd'),
    grossMarginMicroUsd: money('gross_margin_micro_usd'),
    settlement: text('settlement').notNull().default('quota'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('compute_events_team_time_idx').on(t.teamId, t.occurredAt),
    index('compute_events_sandbox_idx').on(t.sandboxId, t.occurredAt),
    index('compute_events_project_idx').on(t.projectId, t.occurredAt),
  ],
);

/** Rolled-up per-team per-period counters — the source for quota checks. */
export const usagePeriods = pgTable(
  'usage_periods',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    weightedTokensUsed: bigint('weighted_tokens_used', { mode: 'number' }).notNull().default(0),
    computeHoursUsed: real('compute_hours_used').notNull().default(0),
    storageGbUsed: real('storage_gb_used').notNull().default(0),
    modelChargedMicroUsd: money('model_charged_micro_usd'),
    computeChargedMicroUsd: money('compute_charged_micro_usd'),
    overageMicroUsd: money('overage_micro_usd'),
    upstreamCostMicroUsd: money('upstream_cost_micro_usd'),
    alertSentAt: timestamp('alert_sent_at', { withTimezone: true }),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('usage_periods_team_period_unique').on(t.teamId, t.periodStart),
    index('usage_periods_team_idx').on(t.teamId, t.periodStart),
  ],
);

/**
 * Budget held by runs that have been admitted but have not settled yet.
 *
 * `usage_periods` only moves when a run *finishes*, so it cannot answer the
 * question the spend guard actually asks: "counting everything already in
 * flight, can this team afford one more run?" Without that, N runs started
 * together each read the same un-debited counters, each decide there is room,
 * and the team sails past its spending cap and PAYG credit limit by a factor of
 * N. Admission therefore takes a row here, and settlement gives it back.
 *
 * `expiresAt` is the self-healing part: a process killed mid-run can never
 * release its own row, so a hold is only honoured until it expires. That makes
 * the worst case a temporarily over-tight limit, never a permanently wedged team.
 */
export const usageReservations = pgTable(
  'usage_reservations',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    /** Matches `usage_periods.period_start`; not a FK so admission never races row creation. */
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    /** For tracing only — the agent run row is written after the hold is taken. */
    runId: text('run_id'),
    weightedTokens: bigint('weighted_tokens', { mode: 'number' }).notNull().default(0),
    microUsd: money('micro_usd'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_reservations_team_period_idx').on(t.teamId, t.periodStart),
    index('usage_reservations_expires_idx').on(t.expiresAt),
  ],
);

/* ------------------------------------------------------------------ *
 *  Operations
 * ------------------------------------------------------------------ */

export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull().default('user'),
    /** Dotted action key, e.g. `sandbox.destroy`, `apikey.create`. */
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull().default(''),
    resourceId: text('resource_id'),
    severity: auditSeverityEnum('severity').notNull().default('info'),
    summary: text('summary').notNull().default(''),
    /** Always passes through `redactSecrets()` before insert. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_events_team_time_idx').on(t.teamId, t.createdAt),
    index('audit_events_user_time_idx').on(t.userId, t.createdAt),
    index('audit_events_action_idx').on(t.action, t.createdAt),
    index('audit_events_resource_idx').on(t.resourceType, t.resourceId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    level: notificationLevelEnum('level').notNull().default('info'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    actionLabel: text('action_label'),
    actionHref: text('action_href'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const incidents = pgTable(
  'incidents',
  {
    id: id(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: incidentStatusEnum('status').notNull().default('open'),
    severity: incidentSeverityEnum('severity').notNull().default('sev3'),
    component: text('component').notNull().default('platform'),
    affectedTeams: integer('affected_teams').notNull().default(0),
    timeline: jsonb('timeline')
      .$type<Array<{ at: string; author: string; note: string }>>()
      .notNull()
      .default([]),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('incidents_status_idx').on(t.status, t.detectedAt)],
);

/** Typed key/value store for every tunable number in the product. */
export const adminSettings = pgTable(
  'admin_settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').$type<unknown>().notNull(),
    valueType: text('value_type').notNull().default('string'),
    category: text('category').notNull().default('general'),
    label: text('label').notNull().default(''),
    description: text('description').notNull().default(''),
    updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [index('admin_settings_category_idx').on(t.category)],
);

/** Persisted slash-command registrations contributed by skills and plugins. */
export const customCommands = pgTable(
  'custom_commands',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('custom'),
    prompt: text('prompt').notNull().default(''),
    source: text('source').notNull().default('skill'),
    sourceRef: text('source_ref'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('custom_commands_scope_name_unique').on(t.teamId, t.projectId, t.name),
    index('custom_commands_team_idx').on(t.teamId),
  ],
);

/* ------------------------------------------------------------------ *
 *  Relations
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  memberships: many(teamMembers),
  apiKeys: many(userApiKeys),
  notifications: many(notifications),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(users, { fields: [teams.ownerId], references: [users.id] }),
  members: many(teamMembers),
  projects: many(projects),
  sandboxes: many(sandboxes),
  subscription: one(subscriptions),
  paygBalance: one(paygBalances),
  invitations: many(invitations),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
  createdBy: one(users, { fields: [projects.createdById], references: [users.id] }),
  defaultModel: one(models, { fields: [projects.defaultModelId], references: [models.id] }),
  files: many(projectFiles),
  conversations: many(conversations),
  sandboxes: many(sandboxes),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  project: one(projects, { fields: [conversations.projectId], references: [projects.id] }),
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  model: one(models, { fields: [conversations.modelId], references: [models.id] }),
  messages: many(messages),
  runs: many(agentRuns),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  model: one(models, { fields: [messages.modelId], references: [models.id] }),
  attachments: many(messageAttachments),
  toolCalls: many(toolCalls),
}));

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [agentRuns.conversationId],
    references: [conversations.id],
  }),
  project: one(projects, { fields: [agentRuns.projectId], references: [projects.id] }),
  sandbox: one(sandboxes, { fields: [agentRuns.sandboxId], references: [sandboxes.id] }),
  toolCalls: many(toolCalls),
}));

export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
  run: one(agentRuns, { fields: [toolCalls.runId], references: [agentRuns.id] }),
  message: one(messages, { fields: [toolCalls.messageId], references: [messages.id] }),
}));

export const sandboxesRelations = relations(sandboxes, ({ one, many }) => ({
  team: one(teams, { fields: [sandboxes.teamId], references: [teams.id] }),
  project: one(projects, { fields: [sandboxes.projectId], references: [projects.id] }),
  sessions: many(sandboxSessions),
  terminals: many(terminalSessions),
}));

export const modelsRelations = relations(models, ({ one, many }) => ({
  provider: one(providers, { fields: [models.providerId], references: [providers.id] }),
  prices: many(modelPrices),
}));

export const modelPricesRelations = relations(modelPrices, ({ one }) => ({
  model: one(models, { fields: [modelPrices.modelId], references: [models.id] }),
}));

export const mcpServersRelations = relations(mcpServers, ({ one, many }) => ({
  team: one(teams, { fields: [mcpServers.teamId], references: [teams.id] }),
  project: one(projects, { fields: [mcpServers.projectId], references: [projects.id] }),
  tools: many(mcpTools),
}));

export const mcpToolsRelations = relations(mcpTools, ({ one }) => ({
  server: one(mcpServers, { fields: [mcpTools.serverId], references: [mcpServers.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  team: one(teams, { fields: [subscriptions.teamId], references: [teams.id] }),
  plan: one(plans, { fields: [subscriptions.planId], references: [plans.id] }),
}));

export const paygBalancesRelations = relations(paygBalances, ({ one }) => ({
  team: one(teams, { fields: [paygBalances.teamId], references: [teams.id] }),
}));

export const installedSkillsRelations = relations(installedSkills, ({ one }) => ({
  skill: one(skills, { fields: [installedSkills.skillId], references: [skills.id] }),
  team: one(teams, { fields: [installedSkills.teamId], references: [teams.id] }),
  project: one(projects, { fields: [installedSkills.projectId], references: [projects.id] }),
}));

export const installedPluginsRelations = relations(installedPlugins, ({ one }) => ({
  plugin: one(plugins, { fields: [installedPlugins.pluginId], references: [plugins.id] }),
  team: one(teams, { fields: [installedPlugins.teamId], references: [teams.id] }),
  project: one(projects, { fields: [installedPlugins.projectId], references: [projects.id] }),
}));

/* ------------------------------------------------------------------ *
 *  Inferred types
 * ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;
export type Sandbox = typeof sandboxes.$inferSelect;
export type NewSandbox = typeof sandboxes.$inferInsert;
export type SandboxSession = typeof sandboxSessions.$inferSelect;
export type TerminalSession = typeof terminalSessions.$inferSelect;
export type ByosWorker = typeof byosWorkers.$inferSelect;
export type ByosCommand = typeof byosCommands.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type NewCoupon = typeof coupons.$inferInsert;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type NewByosCommand = typeof byosCommands.$inferInsert;
export type Provider = typeof providers.$inferSelect;
export type Model = typeof models.$inferSelect;
export type ModelPrice = typeof modelPrices.$inferSelect;
export type UserApiKey = typeof userApiKeys.$inferSelect;
export type McpServer = typeof mcpServers.$inferSelect;
export type McpTool = typeof mcpTools.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type InstalledSkill = typeof installedSkills.$inferSelect;
export type Plugin = typeof plugins.$inferSelect;
export type InstalledPlugin = typeof installedPlugins.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type PaygBalance = typeof paygBalances.$inferSelect;
export type Topup = typeof topups.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
export type ComputeEvent = typeof computeEvents.$inferSelect;
export type NewComputeEvent = typeof computeEvents.$inferInsert;
export type UsagePeriod = typeof usagePeriods.$inferSelect;
export type UsageReservation = typeof usageReservations.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type AdminSetting = typeof adminSettings.$inferSelect;
export type CustomCommand = typeof customCommands.$inferSelect;

export type TeamRole = (typeof teamRoleEnum.enumValues)[number];
export type PlatformRole = (typeof platformRoleEnum.enumValues)[number];
export type AgentMode = (typeof agentModeEnum.enumValues)[number];
export type SandboxStatus = (typeof sandboxStatusEnum.enumValues)[number];
export type RunStatus = (typeof runStatusEnum.enumValues)[number];
export type ToolCallStatus = (typeof toolCallStatusEnum.enumValues)[number];
export type PlanTier = (typeof planTierEnum.enumValues)[number];
export type RuntimeTarget = (typeof runtimeTargetEnum.enumValues)[number];
export type ShellKind = (typeof shellEnum.enumValues)[number];
export type McpTransport = (typeof mcpTransportEnum.enumValues)[number];
export type PluginCategory = (typeof pluginCategoryEnum.enumValues)[number];
export type ConnectionStatus = (typeof connectionStatusEnum.enumValues)[number];
export type MessageRole = (typeof messageRoleEnum.enumValues)[number];
export type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];

/** Re-exported so `primaryKey` stays available to future composite tables. */
export { primaryKey };
