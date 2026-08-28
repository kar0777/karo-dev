import { z } from 'zod';

/**
 * The plan editor's field map.
 *
 * Karo's rule is that no tier's numbers are ever hard-coded in a component —
 * they all live in the `plans` table. This descriptor is what makes that
 * practical: the form, the validation and the diff confirmation are all
 * generated from one list, so adding a quota column means adding one entry
 * here rather than touching three files.
 */

export type PlanFieldType =
  'money' | 'int' | 'float' | 'bool' | 'text' | 'textarea' | 'select' | 'stringList';

export type PlanField = {
  key: keyof PlanFormValues;
  label: string;
  hint?: string;
  type: PlanFieldType;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  /** `0` means "unlimited" for several quota columns; say so in the UI. */
  zeroMeansUnlimited?: boolean;
};

export type PlanSection = {
  id: string;
  title: string;
  description: string;
  fields: PlanField[];
};

export const PLAN_TIERS = ['payg', 'lite', 'pro', 'scale', 'ultra'] as const;
export const SUPPORT_LEVELS = ['community', 'email', 'priority', 'dedicated'] as const;
export const SHELL_OPTIONS = ['bash', 'sh', 'powershell', 'cmd'] as const;

const optionalId = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((value) => (value === '' ? null : (value ?? null)))
  .nullable();

const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nonNegativeInt = z.number().int().min(0);
const nonNegativeFloat = z.number().min(0);

export const planFormSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits and hyphens only.'),
  tier: z.enum(PLAN_TIERS),
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(160),
  description: z.string().trim().max(1000),

  priceMicroUsdMonthly: money,
  priceMicroUsdYearly: money,
  stripePriceIdMonthly: optionalId,
  stripePriceIdYearly: optionalId,

  includedWeightedTokens: nonNegativeInt,
  includedComputeHours: nonNegativeFloat,
  maxActiveSandboxes: nonNegativeInt,
  maxSandboxMemoryMb: z.number().int().min(128).max(1_048_576),
  maxSandboxCpuCores: z.number().min(0.1).max(256),
  storageGb: nonNegativeInt,
  maxTeamMembers: nonNegativeInt,
  maxProjects: nonNegativeInt,
  maxSkills: nonNegativeInt,
  maxPlugins: nonNegativeInt,
  maxMcpServers: nonNegativeInt,
  maxConcurrentRuns: z.number().int().min(1).max(1000),
  queuePriority: z.number().int().min(-100).max(100),
  auditRetentionDays: z.number().int().min(1).max(3650),
  autoSleepMinutes: z.number().int().min(1).max(1440),
  autoDestroyHours: z.number().int().min(1).max(8760),

  allowByok: z.boolean(),
  allowDocker: z.boolean(),
  allowOwnServer: z.boolean(),
  allowExternalSandbox: z.boolean(),
  allowCustomSandboxSize: z.boolean(),
  allowPreviewDeployments: z.boolean(),
  allowPrivateSkills: z.boolean(),
  allowApiAccess: z.boolean(),
  allowSso: z.boolean(),
  allowDedicatedWorker: z.boolean(),
  allowCustomModelRouting: z.boolean(),
  allowedShells: z.array(z.enum(SHELL_OPTIONS)).min(1, 'A plan needs at least one shell.'),
  supportLevel: z.enum(SUPPORT_LEVELS),

  marginBps: z.number().int().min(0).max(100_000),
  overageMicroUsdPerMWeighted: money,
  overageMicroUsdPerComputeHour: money,

  trialDays: z.number().int().min(0).max(365),
  isPublic: z.boolean(),
  isActive: z.boolean(),
  highlight: z.boolean(),
  features: z.array(z.string().trim().min(1).max(160)).max(24),
  sortOrder: z.number().int().min(0).max(10_000),
});

export type PlanFormValues = z.infer<typeof planFormSchema>;

/** PATCH accepts any subset; the route merges it onto the stored row. */
export const planPatchSchema = planFormSchema.partial();

export const PLAN_SECTIONS: PlanSection[] = [
  {
    id: 'identity',
    title: 'Identity',
    description: 'How the plan is addressed in code and presented on the pricing page.',
    fields: [
      {
        key: 'key',
        label: 'Key',
        type: 'text',
        hint: 'Stable machine key. Changing it breaks deep links to the pricing page.',
      },
      {
        key: 'tier',
        label: 'Tier',
        type: 'select',
        options: PLAN_TIERS.map((tier) => ({ value: tier, label: tier })),
        hint: 'Drives model gating — a model with a higher minimum tier is hidden below it.',
      },
      { key: 'name', label: 'Display name', type: 'text' },
      { key: 'tagline', label: 'Tagline', type: 'text', hint: 'One line under the plan name.' },
      { key: 'description', label: 'Description', type: 'textarea' },
      {
        key: 'sortOrder',
        label: 'Sort order',
        type: 'int',
        hint: 'Lower sorts first on the pricing page.',
      },
    ],
  },
  {
    id: 'pricing',
    title: 'Price',
    description: 'What a subscriber pays, and the Stripe prices those map to.',
    fields: [
      { key: 'priceMicroUsdMonthly', label: 'Monthly price', type: 'money' },
      { key: 'priceMicroUsdYearly', label: 'Yearly price', type: 'money' },
      { key: 'stripePriceIdMonthly', label: 'Stripe price ID (monthly)', type: 'text' },
      { key: 'stripePriceIdYearly', label: 'Stripe price ID (yearly)', type: 'text' },
      { key: 'trialDays', label: 'Trial length', type: 'int', unit: 'days' },
    ],
  },
  {
    id: 'allowance',
    title: 'Included allowance',
    description: 'What the monthly price buys before overage starts.',
    fields: [
      {
        key: 'includedWeightedTokens',
        label: 'Included weighted tokens',
        type: 'int',
        hint: 'The plan quota unit. 1 input token = 1 weighted token; other classes convert at the model price ratio.',
      },
      {
        key: 'includedComputeHours',
        label: 'Included compute hours',
        type: 'float',
        unit: 'hours',
      },
      { key: 'storageGb', label: 'Workspace storage', type: 'int', unit: 'GB' },
    ],
  },
  {
    id: 'sandbox',
    title: 'Sandbox limits',
    description: 'The machine a subscriber may ask for, and how long it lives.',
    fields: [
      { key: 'maxActiveSandboxes', label: 'Concurrent sandboxes', type: 'int' },
      { key: 'maxSandboxMemoryMb', label: 'Max RAM per sandbox', type: 'int', unit: 'MB' },
      {
        key: 'maxSandboxCpuCores',
        label: 'Max vCPU per sandbox',
        type: 'float',
        unit: 'cores',
      },
      { key: 'autoSleepMinutes', label: 'Auto-sleep after', type: 'int', unit: 'idle minutes' },
      {
        key: 'autoDestroyHours',
        label: 'Auto-destroy after',
        type: 'int',
        unit: 'hours asleep',
      },
    ],
  },
  {
    id: 'workspace',
    title: 'Workspace limits',
    description: 'How much a team may build on this plan.',
    fields: [
      { key: 'maxTeamMembers', label: 'Team members', type: 'int', zeroMeansUnlimited: true },
      { key: 'maxProjects', label: 'Projects', type: 'int', zeroMeansUnlimited: true },
      { key: 'maxSkills', label: 'Installed skills', type: 'int', zeroMeansUnlimited: true },
      { key: 'maxPlugins', label: 'Installed plugins', type: 'int', zeroMeansUnlimited: true },
      { key: 'maxMcpServers', label: 'MCP servers', type: 'int', zeroMeansUnlimited: true },
      { key: 'maxConcurrentRuns', label: 'Concurrent agent runs', type: 'int' },
      {
        key: 'queuePriority',
        label: 'Queue priority',
        type: 'int',
        hint: 'Higher jumps ahead when the run queue is contended.',
      },
      { key: 'auditRetentionDays', label: 'Audit retention', type: 'int', unit: 'days' },
    ],
  },
  {
    id: 'capabilities',
    title: 'Capabilities',
    description:
      'Feature gates. Each one is checked at the point of use, not just hidden in the UI.',
    fields: [
      { key: 'allowByok', label: 'Bring your own API key', type: 'bool' },
      { key: 'allowDocker', label: 'Docker inside the sandbox', type: 'bool' },
      { key: 'allowOwnServer', label: 'Bring your own server', type: 'bool' },
      { key: 'allowExternalSandbox', label: 'External sandbox providers', type: 'bool' },
      { key: 'allowCustomSandboxSize', label: 'Custom sandbox sizing', type: 'bool' },
      { key: 'allowPreviewDeployments', label: 'Preview deployments', type: 'bool' },
      { key: 'allowPrivateSkills', label: 'Private skills', type: 'bool' },
      { key: 'allowApiAccess', label: 'Public API access', type: 'bool' },
      { key: 'allowSso', label: 'SSO', type: 'bool' },
      { key: 'allowDedicatedWorker', label: 'Dedicated worker', type: 'bool' },
      { key: 'allowCustomModelRouting', label: 'Custom model routing', type: 'bool' },
      {
        key: 'allowedShells',
        label: 'Allowed shells',
        type: 'stringList',
        hint: 'Comma-separated. Valid values: bash, sh, powershell, cmd.',
      },
      {
        key: 'supportLevel',
        label: 'Support level',
        type: 'select',
        options: SUPPORT_LEVELS.map((level) => ({ value: level, label: level })),
      },
    ],
  },
  {
    id: 'economics',
    title: 'Margin and overage',
    description: 'What happens once the included allowance is spent.',
    fields: [
      {
        key: 'marginBps',
        label: 'Margin',
        type: 'int',
        unit: 'basis points',
        hint: '2000 = +20% on top of upstream cost. Used when no explicit overage rate is set.',
      },
      {
        key: 'overageMicroUsdPerMWeighted',
        label: 'Overage per 1M weighted tokens',
        type: 'money',
        hint: 'Leave at $0 to fall back to upstream cost plus the margin above.',
      },
      {
        key: 'overageMicroUsdPerComputeHour',
        label: 'Overage per compute hour',
        type: 'money',
      },
    ],
  },
  {
    id: 'visibility',
    title: 'Visibility',
    description: 'Where and whether this plan is offered.',
    fields: [
      {
        key: 'isActive',
        label: 'Active',
        type: 'bool',
        hint: 'Inactive plans keep existing subscriptions but cannot be bought.',
      },
      { key: 'isPublic', label: 'Listed on the pricing page', type: 'bool' },
      { key: 'highlight', label: 'Highlighted as recommended', type: 'bool' },
      {
        key: 'features',
        label: 'Feature bullets',
        type: 'stringList',
        hint: 'One per line. Shown verbatim on the pricing page.',
      },
    ],
  },
];

export const PLAN_FIELDS: PlanField[] = PLAN_SECTIONS.flatMap((section) => section.fields);

export const PLAN_FIELD_BY_KEY = new Map(PLAN_FIELDS.map((field) => [field.key, field]));
