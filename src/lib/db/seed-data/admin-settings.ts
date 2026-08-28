import { adminSettings } from '@/lib/db/schema';

/**
 * Every tunable number in the product.
 *
 * The rule this table exists to enforce: if an operator might ever want to
 * change a number without a deploy, it lives here — not in a constant, not in
 * an env var, not inline in a route handler. Reads go through a cached loader;
 * writes go through the admin UI and are audited.
 *
 * `valueType` drives which editor the admin UI renders and how the value is
 * coerced on read, so it must match the runtime type of `value`.
 */
export type AdminSettingSeed = Omit<
  typeof adminSettings.$inferInsert,
  'updatedById' | 'createdAt' | 'updatedAt'
> & {
  valueType: 'number' | 'string' | 'boolean' | 'json';
};

export const ADMIN_SETTING_SEEDS: readonly AdminSettingSeed[] = [
  /* ------------------------------ billing ------------------------------ */
  {
    key: 'billing.platform_margin_bps',
    value: 2000,
    valueType: 'number',
    category: 'billing',
    label: 'Default platform margin (bps)',
    description:
      'Added on top of upstream cost when a plan has no published overage rate. 2000 = +20%. A plan row may override this; this is the fallback and the value shown on the pricing page.',
  },
  {
    key: 'billing.minimum_topup_micro_usd',
    value: 5_000_000,
    valueType: 'number',
    category: 'billing',
    label: 'Minimum top-up (micro-USD)',
    description:
      'Smallest accepted balance top-up. 5,000,000 = $5.00. Below roughly $2 the payment processor fee eats the whole transaction.',
  },
  {
    key: 'billing.payg_credit_limit_micro_usd',
    value: 2_000_000,
    valueType: 'number',
    category: 'billing',
    label: 'Pay-as-you-go credit limit (micro-USD)',
    description:
      'How far a balance may go negative before runs are blocked. 2,000,000 = $2.00. Covers a run that overshoots its estimate rather than killing it mid-way.',
  },
  {
    key: 'billing.auto_topup_default_amount_micro_usd',
    value: 20_000_000,
    valueType: 'number',
    category: 'billing',
    label: 'Default auto top-up amount (micro-USD)',
    description: 'Pre-filled amount when a team switches auto top-up on. 20,000,000 = $20.00.',
  },
  {
    key: 'billing.expensive_task_warn_micro_usd',
    value: 1_000_000,
    valueType: 'number',
    category: 'billing',
    label: 'Expensive-task warning threshold (micro-USD)',
    description:
      'A pre-flight estimate at or above this shows a confirmation with the forecast before the run starts. 1,000,000 = $1.00.',
  },
  {
    key: 'billing.invoice_currency',
    value: 'usd',
    valueType: 'string',
    category: 'billing',
    label: 'Invoice currency',
    description: 'ISO 4217 code used on invoices. Internal accounting is always micro-USD.',
  },
  {
    key: 'billing.usage_alert_threshold',
    value: 0.8,
    valueType: 'number',
    category: 'billing',
    label: 'Default usage alert threshold',
    description:
      'Fraction of the monthly allowance at which a team is notified. 0.8 = 80%. Teams can override this in billing settings.',
  },

  /* ------------------------------ compute ------------------------------ */
  {
    key: 'compute.upstream_micro_usd_per_base_hour.karo_cloud',
    value: 9_000,
    valueType: 'number',
    category: 'compute',
    label: 'Karo Cloud cost per base compute hour (micro-USD)',
    description:
      'What Karo pays per hour of 0.25 vCPU + 512 MB on its own fleet. 9,000 = $0.009. Bigger machines multiply this by CPU x RAM.',
  },
  {
    key: 'compute.upstream_micro_usd_per_base_hour.daytona',
    value: 14_000,
    valueType: 'number',
    category: 'compute',
    label: 'Daytona cost per base compute hour (micro-USD)',
    description: 'Upstream rate when a sandbox runs on Daytona. 14,000 = $0.014.',
  },
  {
    key: 'compute.upstream_micro_usd_per_base_hour.remote_docker',
    value: 9_000,
    valueType: 'number',
    category: 'compute',
    label: 'Remote Docker cost per base compute hour (micro-USD)',
    description: 'Upstream rate for a Karo-operated remote Docker host.',
  },
  {
    key: 'compute.upstream_micro_usd_per_base_hour.local_docker',
    value: 4_000,
    valueType: 'number',
    category: 'compute',
    label: 'Local Docker cost per base compute hour (micro-USD)',
    description: 'Amortised rate for self-hosted Karo deployments running local Docker.',
  },
  {
    key: 'compute.upstream_micro_usd_per_base_hour.own_server',
    value: 0,
    valueType: 'number',
    category: 'compute',
    label: 'Bring-your-own-server cost per base compute hour (micro-USD)',
    description:
      'Always 0. BYOS compute runs on the customer hardware — it is metered for visibility and never charged.',
  },
  {
    key: 'compute.upstream_micro_usd_per_base_hour.mock',
    value: 0,
    valueType: 'number',
    category: 'compute',
    label: 'Demo sandbox cost per base compute hour (micro-USD)',
    description: 'Always 0 so demo mode never produces a charge.',
  },
  {
    key: 'compute.storage_micro_usd_per_gb_month',
    value: 20_000,
    valueType: 'number',
    category: 'compute',
    label: 'Storage cost per GB-month (micro-USD)',
    description: 'Charged on storage past the plan allowance. 20,000 = $0.02 per GB per month.',
  },

  /* ------------------------------ sandbox ------------------------------ */
  {
    key: 'sandbox.default_auto_sleep_minutes',
    value: 15,
    valueType: 'number',
    category: 'sandbox',
    label: 'Default auto-sleep (minutes)',
    description:
      'Idle minutes before a sandbox sleeps and stops burning compute. A plan may set a longer value; this is the fallback for new sandboxes.',
  },
  {
    key: 'sandbox.default_auto_destroy_hours',
    value: 72,
    valueType: 'number',
    category: 'sandbox',
    label: 'Default auto-destroy (hours)',
    description:
      'Hours a sleeping sandbox is kept before it is destroyed. Project files live in the database and survive; anything installed only inside the sandbox does not.',
  },
  {
    key: 'sandbox.max_command_seconds',
    value: 300,
    valueType: 'number',
    category: 'sandbox',
    label: 'Command timeout (seconds)',
    description:
      'Wall-clock cap on a single command. The process is terminated and the agent is told it timed out rather than hanging the run.',
  },
  {
    key: 'sandbox.max_processes',
    value: 128,
    valueType: 'number',
    category: 'sandbox',
    label: 'Max processes per sandbox',
    description: 'Process-count limit. Primary defence against a fork bomb inside the sandbox.',
  },
  {
    key: 'sandbox.default_network_policy',
    value: 'restricted',
    valueType: 'string',
    category: 'sandbox',
    label: 'Default network policy',
    description:
      'none, restricted or open. Restricted allows package registries and the outbound allow-list, and always blocks cloud metadata endpoints.',
  },
  {
    key: 'sandbox.max_lifetime_hours',
    value: 720,
    valueType: 'number',
    category: 'sandbox',
    label: 'Maximum sandbox lifetime (hours)',
    description:
      'Hard ceiling on how long any one sandbox may exist, regardless of plan. 720 = 30 days. Forces a rebuild onto a patched base image.',
  },
  {
    key: 'sandbox.wake_timeout_seconds',
    value: 45,
    valueType: 'number',
    category: 'sandbox',
    label: 'Wake timeout (seconds)',
    description:
      'How long to wait for a sleeping sandbox to come back before reporting it as failed to the user.',
  },

  /* ---------------------------- rate limits ---------------------------- */
  {
    key: 'ratelimit.messages_per_minute',
    value: 20,
    valueType: 'number',
    category: 'rate_limits',
    label: 'Chat messages per minute (per user)',
    description: 'Agent runs started per user per minute. Protects the model provider quota.',
  },
  {
    key: 'ratelimit.commands_per_minute',
    value: 60,
    valueType: 'number',
    category: 'rate_limits',
    label: 'Terminal commands per minute (per user)',
    description: 'Interactive shell commands per user per minute.',
  },
  {
    key: 'ratelimit.sandbox_creates_per_hour',
    value: 10,
    valueType: 'number',
    category: 'rate_limits',
    label: 'Sandbox creations per hour (per team)',
    description:
      'Caps create/destroy churn, which is the most expensive thing a team can do to the fleet.',
  },
  {
    key: 'ratelimit.login_attempts_per_15min',
    value: 10,
    valueType: 'number',
    category: 'rate_limits',
    label: 'Login attempts per 15 minutes (per IP + email)',
    description:
      'Credential-stuffing defence. Counted per IP and per email address separately.',
  },
  {
    key: 'ratelimit.api_requests_per_minute',
    value: 120,
    valueType: 'number',
    category: 'rate_limits',
    label: 'API requests per minute (per key)',
    description: 'Applies to scoped API keys on plans with API access.',
  },
  {
    key: 'ratelimit.file_writes_per_minute',
    value: 120,
    valueType: 'number',
    category: 'rate_limits',
    label: 'File writes per minute (per project)',
    description: 'Caps how fast an agent run can rewrite a workspace.',
  },

  /* ------------------------------- limits ------------------------------ */
  {
    key: 'limits.max_upload_bytes',
    value: 10_485_760,
    valueType: 'number',
    category: 'limits',
    label: 'Max upload size (bytes)',
    description: 'Largest single file a user may attach to a message. 10,485,760 = 10 MiB.',
  },
  {
    key: 'limits.max_file_bytes',
    value: 2_097_152,
    valueType: 'number',
    category: 'limits',
    label: 'Max editable file size (bytes)',
    description:
      'Files above this are shown read-only and never sent to the model whole. 2,097,152 = 2 MiB.',
  },
  {
    key: 'limits.max_agent_iterations',
    value: 24,
    valueType: 'number',
    category: 'limits',
    label: 'Max agent iterations per run',
    description:
      'Hard stop on the tool-call loop. Prevents an agent that has lost the plot from spending a whole balance.',
  },
  {
    key: 'limits.max_concurrent_runs',
    value: 4,
    valueType: 'number',
    category: 'limits',
    label: 'Max concurrent runs (platform fallback)',
    description:
      'Used when a plan does not set its own value. Plan-level `maxConcurrentRuns` wins where present.',
  },
  {
    key: 'limits.max_conversation_messages',
    value: 500,
    valueType: 'number',
    category: 'limits',
    label: 'Max messages per conversation',
    description:
      'Past this the UI requires /compact or a new chat before another run can start.',
  },
  {
    key: 'limits.max_terminal_scrollback_bytes',
    value: 262_144,
    valueType: 'number',
    category: 'limits',
    label: 'Terminal scrollback buffer (bytes)',
    description:
      'Ring buffer kept per terminal so a reconnect can restore the screen. 256 KiB.',
  },

  /* ------------------------------ fair use ----------------------------- */
  {
    key: 'fairuse.weighted_tokens_per_day_multiplier',
    value: 0.2,
    valueType: 'number',
    category: 'fair_use',
    label: 'Daily weighted-token burst multiplier',
    description:
      'Fraction of the monthly allowance a team may spend in one day before soft throttling. 0.2 = 20%, so the monthly quota cannot be drained in under five days.',
  },
  {
    key: 'fairuse.compute_hours_per_day_multiplier',
    value: 0.15,
    valueType: 'number',
    category: 'fair_use',
    label: 'Daily compute-hour burst multiplier',
    description: 'Same idea for compute. 0.15 = 15% of the monthly compute allowance per day.',
  },
  {
    key: 'fairuse.throttle_queue_penalty',
    value: 10,
    valueType: 'number',
    category: 'fair_use',
    label: 'Queue penalty when throttled',
    description:
      'Subtracted from queue priority while a team is over its daily burst. Work still runs, just behind everyone else.',
  },

  /* ------------------------------ catalogue ---------------------------- */
  {
    key: 'catalog.sync_interval_minutes',
    value: 60,
    valueType: 'number',
    category: 'catalog',
    label: 'Model catalogue sync interval (minutes)',
    description:
      'How often model IDs, context windows and prices are refreshed from the provider catalogue. New prices are appended as a new price row; historic usage keeps its original price.',
  },
  {
    key: 'catalog.auto_disable_missing_models',
    value: true,
    valueType: 'boolean',
    category: 'catalog',
    label: 'Disable models missing from the catalogue',
    description:
      'When a sync no longer lists a model, disable it instead of deleting it so old usage rows stay auditable.',
  },
  {
    key: 'catalog.price_change_alert_bps',
    value: 1000,
    valueType: 'number',
    category: 'catalog',
    label: 'Price-change alert threshold (bps)',
    description:
      'A sync that moves a price by more than this notifies admins before it takes effect. 1000 = 10%.',
  },

  /* ------------------------------- signup ------------------------------ */
  {
    key: 'signup.enabled',
    value: true,
    valueType: 'boolean',
    category: 'signup',
    label: 'Registration open',
    description:
      'When off, the register page returns a closed-beta notice and existing users still sign in.',
  },
  {
    key: 'signup.require_email_verification',
    // Ships off. This row said `true` for as long as it existed, but nothing
    // read it — the code looked up a differently-named key and always got its
    // compiled `false`. Now that the two names are reconciled the row finally
    // decides, so leaving it `true` would switch a brand-new gate on for every
    // install at once and lock out every unconfirmed account. Off is what these
    // installs have actually been doing; turning it on is now a real choice.
    value: false,
    valueType: 'boolean',
    category: 'signup',
    label: 'Require email verification',
    description:
      'Unverified accounts can sign in and read, but every state-changing request is refused ' +
      'until they confirm. Confirming, resending the email, editing their profile and signing ' +
      'out stay available so they can always get out of it.',
  },
  {
    key: 'signup.default_plan_key',
    value: 'payg',
    valueType: 'string',
    category: 'signup',
    label: 'Plan assigned at signup',
    description: 'Must match a key in the plans table.',
  },
  {
    key: 'signup.welcome_credit_micro_usd',
    value: 1_000_000,
    valueType: 'number',
    category: 'signup',
    label: 'Welcome credit (micro-USD)',
    description:
      'Balance granted to a new team so the product can be tried without a card. 1,000,000 = $1.00. Set 0 to disable.',
  },

  /* -------------------------------- demo ------------------------------- */
  {
    key: 'demo.login_enabled',
    value: true,
    valueType: 'boolean',
    category: 'demo',
    label: 'Allow demo login',
    description:
      'Shows the "Try the demo account" button on the login screen. Turn this off before a public production launch.',
  },
  {
    key: 'demo.banner_enabled',
    value: true,
    valueType: 'boolean',
    category: 'demo',
    label: 'Show demo-mode indicator',
    description:
      'Displays an unobtrusive "Demo mode" badge in the app shell whenever mock providers are in use.',
  },
  {
    key: 'demo.reset_interval_hours',
    value: 24,
    valueType: 'number',
    category: 'demo',
    label: 'Demo account reset interval (hours)',
    description:
      'How often the demo workspace is reset to its seeded state. 0 disables the reset.',
  },

  /* ------------------------------- abuse ------------------------------- */
  {
    key: 'abuse.max_sandboxes_per_team_hard_cap',
    value: 25,
    valueType: 'number',
    category: 'abuse',
    label: 'Hard cap on sandboxes per team',
    description:
      'Ceiling no plan may exceed. Guards against a compromised account provisioning the whole fleet.',
  },
  {
    key: 'abuse.max_projects_per_team_hard_cap',
    value: 500,
    valueType: 'number',
    category: 'abuse',
    label: 'Hard cap on projects per team',
    description: 'Ceiling no plan may exceed, regardless of the plan-level project limit.',
  },
  {
    key: 'abuse.block_disposable_email_domains',
    value: true,
    valueType: 'boolean',
    category: 'abuse',
    label: 'Block disposable email domains',
    description: 'Rejects registration from known throwaway mail providers.',
  },
  {
    key: 'abuse.max_accounts_per_ip_per_day',
    value: 5,
    valueType: 'number',
    category: 'abuse',
    label: 'Max new accounts per IP per day',
    description: 'Slows automated signup farming for the welcome credit.',
  },
  {
    key: 'abuse.suspend_on_negative_balance_micro_usd',
    value: -10_000_000,
    valueType: 'number',
    category: 'abuse',
    label: 'Auto-suspend below balance (micro-USD)',
    description:
      'A team whose balance falls below this is suspended pending review. -10,000,000 = -$10.00. Should never be reachable through the normal credit limit.',
  },

  /* ------------------------------ general ------------------------------ */
  {
    key: 'general.support_email',
    value: 'support@karo.local',
    valueType: 'string',
    category: 'general',
    label: 'Support email',
    description: 'Shown in error states, invoices and account emails.',
  },
  {
    key: 'general.status_page_url',
    value: 'https://status.karo.local',
    valueType: 'string',
    category: 'general',
    label: 'Status page URL',
    description: 'Linked from provider-unavailable and incident banners.',
  },
  {
    key: 'general.maintenance_mode',
    value: false,
    valueType: 'boolean',
    category: 'general',
    label: 'Maintenance mode',
    description:
      'Refuses every state-changing request from a signed-in non-admin with 503, and shows an ' +
      'explanatory strip in the app. Reads keep working, platform admins keep full access, and ' +
      'sign-in plus provider webhooks are never refused.',
  },
  {
    key: 'general.announcement',
    value: '',
    valueType: 'string',
    category: 'general',
    label: 'Announcement',
    description:
      'Shown as a strip at the top of every signed-in page. Plain text — markup is escaped, not ' +
      'rendered. Empty draws nothing at all.',
  },
];

/** Keys the seed writes as JSON payloads rather than scalars. */
export const MCP_TEMPLATES_SETTING_KEY = 'mcp.templates';
export const PROJECT_TEMPLATES_SETTING_KEY = 'project.templates';
