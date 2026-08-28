import { plans } from '@/lib/db/schema';

/**
 * Plan catalogue.
 *
 * Every quota the product enforces lives here and nowhere else — components read
 * the `plans` table, never a hard-coded tier constant. Money is integer
 * micro-USD (1e-6 USD): $19/mo is `19_000_000`.
 *
 * Overage semantics (see `@/lib/pricing/calculator`):
 *   · `overageMicroUsdPerMWeighted > 0`  → billed at that published rate.
 *   · `overageMicroUsdPerMWeighted === 0` → billed at upstream cost + `marginBps`.
 * Pay as you go therefore sets both overage rates to 0 on purpose: 0 means
 * "cost-plus", not "free".
 *
 * Yearly price is 10× monthly — two months free.
 */
export type PlanSeed = Omit<typeof plans.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * The shells a plan can offer, which is bounded by what the sandbox image can
 * launch rather than by price. `docker/sandbox-base/Dockerfile` installs bash on
 * Debian slim and `/bin/sh` comes with the base system; neither `pwsh` nor
 * `cmd.exe` is present, so `describeShell` in the workspace loader refuses both
 * Windows shells on every provider Karo ships. Listing them here would sell a
 * shell that dies on spawn.
 */
const SANDBOX_SHELLS = ['bash', 'sh'];

export const PLAN_SEEDS: readonly PlanSeed[] = [
  {
    key: 'payg',
    tier: 'payg',
    name: 'Pay as you go',
    tagline: 'No subscription. Upstream cost plus 20%.',
    description:
      'Top up a balance and spend it. Nothing is included and nothing expires — every token and every compute-second is billed at what Karo pays its providers plus a flat 20% platform margin. Best if you use the agent occasionally, or if you bring your own model key and only need the machine.',
    priceMicroUsdMonthly: 0,
    priceMicroUsdYearly: 0,

    includedWeightedTokens: 0,
    includedComputeHours: 0,
    maxActiveSandboxes: 1,
    maxSandboxMemoryMb: 512,
    maxSandboxCpuCores: 0.25,
    storageGb: 5,
    maxTeamMembers: 1,
    maxProjects: 3,
    maxSkills: 3,
    maxPlugins: 3,
    maxMcpServers: 2,
    maxConcurrentRuns: 1,
    queuePriority: 0,
    auditRetentionDays: 7,
    autoSleepMinutes: 10,
    autoDestroyHours: 24,

    allowByok: true,
    allowDocker: false,
    allowOwnServer: true,
    allowExternalSandbox: true,
    allowCustomSandboxSize: false,
    allowPreviewDeployments: false,
    allowPrivateSkills: false,
    allowApiAccess: false,
    allowSso: false,
    allowDedicatedWorker: false,
    allowCustomModelRouting: false,
    allowedShells: SANDBOX_SHELLS,
    supportLevel: 'community',

    marginBps: 2000,
    // 0 = cost-plus. See the file header before "fixing" these to a number.
    overageMicroUsdPerMWeighted: 0,
    overageMicroUsdPerComputeHour: 0,

    trialDays: 0,
    isPublic: true,
    isActive: true,
    highlight: false,
    features: [
      'No monthly fee — your balance is only drawn down when the agent actually runs',
      'Model tokens billed at upstream provider cost plus a flat 20% platform margin',
      'Compute billed per second against the 0.25 vCPU / 512 MB base rate',
      '1 active sandbox — 512 MB RAM, about 416 MB of which reaches your processes',
      '5 GB of persistent project storage',
      'Bring your own model key: those tokens are billed by your provider, not by Karo',
      'Bring your own server: the agent runs on your hardware and compute is metered but never charged',
      'Attach an external sandbox provider (Daytona or a remote Docker host)',
      'bash and sh in every sandbox',
      'Every charge itemised — input, output and cached tokens with the exact multiplier applied',
      'Community support through the public issue tracker',
    ],
    sortOrder: 10,
  },

  {
    key: 'lite',
    tier: 'lite',
    name: 'Lite',
    tagline: 'A real machine and a frontier model for the price of lunch.',
    description:
      'The smallest plan that still gives the agent a genuine computer. One 512 MB sandbox, a million included weighted tokens, and Claude Opus 5 on top of the whole open-weight catalogue — only Claude Fable 5, Gemini 3.1 Pro Preview and Grok 4.5 are held back for Pro. Sized for one person shipping side projects, not for a team.',
    priceMicroUsdMonthly: 5_000_000,
    priceMicroUsdYearly: 50_000_000,

    includedWeightedTokens: 1_000_000,
    includedComputeHours: 20,
    maxActiveSandboxes: 1,
    maxSandboxMemoryMb: 512,
    maxSandboxCpuCores: 0.25,
    storageGb: 5,
    maxTeamMembers: 1,
    maxProjects: 5,
    maxSkills: 5,
    maxPlugins: 5,
    maxMcpServers: 3,
    maxConcurrentRuns: 1,
    queuePriority: 5,
    auditRetentionDays: 7,
    autoSleepMinutes: 15,
    autoDestroyHours: 72,

    allowByok: true,
    allowDocker: false,
    allowOwnServer: true,
    allowExternalSandbox: false,
    allowCustomSandboxSize: false,
    allowPreviewDeployments: false,
    allowPrivateSkills: false,
    allowApiAccess: false,
    allowSso: false,
    allowDedicatedWorker: false,
    allowCustomModelRouting: false,
    allowedShells: SANDBOX_SHELLS,
    supportLevel: 'community',

    marginBps: 2000,
    overageMicroUsdPerMWeighted: 6_000_000,
    overageMicroUsdPerComputeHour: 20_000,

    trialDays: 0,
    isPublic: true,
    isActive: true,
    comingSoon: true,
    highlight: false,
    features: [
      '1,000,000 included weighted tokens per month — roughly 80 build turns on a frontier model',
      'Claude Opus 5 and every model in the catalogue except Claude Fable 5, Gemini 3.1 Pro Preview and Grok 4.5, which need Pro',
      '20 included compute hours (about 20 wall-clock hours on the base machine)',
      '512 MB sandbox RAM — about 416 MB is available to your processes after the agent and shell',
      '0.25 shared vCPU and 5 GB of persistent storage',
      '1 active sandbox, 5 projects, 5 skills, 5 plugins, 3 MCP servers',
      'Sandbox sleeps after 15 idle minutes and wakes on your next command in about 4 seconds',
      'bash and sh shells',
      'Bring your own model key and pay Karo nothing for those tokens',
      'Overage at $6.00 per million weighted tokens — never a surprise invoice',
      'Community support through the public issue tracker',
    ],
    sortOrder: 20,
  },

  {
    key: 'pro',
    tier: 'pro',
    name: 'Pro',
    tagline: 'The working plan: two machines, Docker, six million tokens.',
    description:
      'Enough headroom to use the agent as a daily driver. Two concurrent sandboxes at 1 GB each, rootless Docker inside the sandbox, and six million included weighted tokens. Team seats start at Scale — Pro is one very productive person.',
    priceMicroUsdMonthly: 19_000_000,
    priceMicroUsdYearly: 190_000_000,

    includedWeightedTokens: 6_000_000,
    includedComputeHours: 100,
    maxActiveSandboxes: 2,
    maxSandboxMemoryMb: 1024,
    maxSandboxCpuCores: 0.5,
    storageGb: 20,
    maxTeamMembers: 1,
    maxProjects: 25,
    maxSkills: 999,
    maxPlugins: 50,
    maxMcpServers: 20,
    maxConcurrentRuns: 2,
    queuePriority: 10,
    auditRetentionDays: 30,
    autoSleepMinutes: 20,
    autoDestroyHours: 168,

    allowByok: true,
    allowDocker: true,
    allowOwnServer: true,
    allowExternalSandbox: true,
    allowCustomSandboxSize: false,
    allowPreviewDeployments: false,
    allowPrivateSkills: false,
    allowApiAccess: false,
    allowSso: false,
    allowDedicatedWorker: false,
    allowCustomModelRouting: false,
    allowedShells: SANDBOX_SHELLS,
    supportLevel: 'email',

    marginBps: 1800,
    overageMicroUsdPerMWeighted: 4_000_000,
    overageMicroUsdPerComputeHour: 18_000,

    trialDays: 7,
    isPublic: true,
    isActive: true,
    comingSoon: true,
    highlight: true,
    features: [
      '6,000,000 included weighted tokens per month — about six times Lite for under four times the price',
      '100 included compute hours on machines up to 0.5 vCPU / 1 GB RAM',
      '2 sandboxes running at once, so a build can run while you keep chatting',
      'Rootless Docker inside the sandbox — build and run containers without touching a host socket',
      '20 GB of persistent storage and 25 projects',
      'Unlimited skills, 50 plugins, 20 MCP servers',
      'Bring your own model key, your own server, or an external sandbox provider',
      'Overage at $4.00 per million weighted tokens',
      'Email support with a one-business-day first-response target',
      '7-day trial, cancel any time',
    ],
    sortOrder: 30,
  },

  {
    key: 'scale',
    tier: 'scale',
    name: 'Scale',
    tagline: 'Five seats, five machines, custom sandbox sizes and an API.',
    description:
      'For a small team that has made the agent part of its workflow. Seat-based collaboration, custom machine sizes up to 2 vCPU and 4 GB, private team skills, and a REST API so Karo can be driven from CI.',
    priceMicroUsdMonthly: 100_000_000,
    priceMicroUsdYearly: 1_000_000_000,

    includedWeightedTokens: 45_000_000,
    includedComputeHours: 500,
    maxActiveSandboxes: 5,
    maxSandboxMemoryMb: 4096,
    maxSandboxCpuCores: 2,
    storageGb: 100,
    maxTeamMembers: 5,
    maxProjects: 100,
    maxSkills: 999,
    maxPlugins: 999,
    maxMcpServers: 50,
    maxConcurrentRuns: 5,
    queuePriority: 20,
    auditRetentionDays: 180,
    autoSleepMinutes: 30,
    autoDestroyHours: 336,

    allowByok: true,
    allowDocker: true,
    allowOwnServer: true,
    allowExternalSandbox: true,
    allowCustomSandboxSize: true,
    allowPreviewDeployments: false,
    allowPrivateSkills: true,
    allowApiAccess: true,
    allowSso: false,
    allowDedicatedWorker: false,
    allowCustomModelRouting: false,
    allowedShells: SANDBOX_SHELLS,
    supportLevel: 'priority',

    marginBps: 1500,
    overageMicroUsdPerMWeighted: 3_000_000,
    overageMicroUsdPerComputeHour: 15_000,

    trialDays: 0,
    isPublic: true,
    isActive: true,
    comingSoon: true,
    highlight: false,
    features: [
      '45,000,000 included weighted tokens per month, pooled across the whole team',
      '500 included compute hours and 5 sandboxes running at once',
      'Custom sandbox sizes up to 2 vCPU and 4 GB RAM, chosen per project',
      '5 team seats with owner / admin / developer / viewer roles',
      '100 GB of storage and 100 projects',
      'Private skills: author a skill once and keep it inside your team',
      'REST API and scoped API keys so CI can start runs and read results',
      'Rootless Docker, BYOK, BYOS and external sandboxes',
      'Overage at $3.00 per million weighted tokens',
      'Priority support with a four-hour first-response target on business days',
    ],
    sortOrder: 40,
  },

  {
    key: 'ultra',
    tier: 'ultra',
    name: 'Ultra',
    tagline: 'Fifteen seats, ten 8 GB machines, the lowest overage rate.',
    description:
      'The largest self-serve plan. Ten concurrent machines at up to 4 vCPU and 8 GB, a hundred million included weighted tokens pooled across fifteen seats, and the lowest published overage rate.',
    priceMicroUsdMonthly: 200_000_000,
    priceMicroUsdYearly: 2_000_000_000,

    includedWeightedTokens: 100_000_000,
    includedComputeHours: 1200,
    maxActiveSandboxes: 10,
    maxSandboxMemoryMb: 8192,
    maxSandboxCpuCores: 4,
    storageGb: 250,
    maxTeamMembers: 15,
    maxProjects: 250,
    maxSkills: 999,
    maxPlugins: 999,
    maxMcpServers: 100,
    maxConcurrentRuns: 10,
    queuePriority: 30,
    auditRetentionDays: 365,
    autoSleepMinutes: 60,
    autoDestroyHours: 720,

    allowByok: true,
    allowDocker: true,
    allowOwnServer: true,
    allowExternalSandbox: true,
    allowCustomSandboxSize: true,
    allowPreviewDeployments: false,
    allowPrivateSkills: true,
    allowApiAccess: true,
    allowSso: false,
    allowDedicatedWorker: false,
    allowCustomModelRouting: false,
    allowedShells: SANDBOX_SHELLS,
    supportLevel: 'premium',

    marginBps: 1200,
    overageMicroUsdPerMWeighted: 2_500_000,
    overageMicroUsdPerComputeHour: 12_000,

    trialDays: 0,
    isPublic: true,
    isActive: true,
    comingSoon: true,
    highlight: false,
    features: [
      '100,000,000 included weighted tokens per month, pooled across 15 seats',
      '1,200 included compute hours and 10 sandboxes running at once',
      'Machines up to 4 vCPU and 8 GB RAM with 250 GB of storage',
      'Private team skills, 100 MCP servers and unlimited plugins',
      'REST API and scoped API keys so CI can start runs and read results',
      'Overage at $2.50 per million weighted tokens — the lowest published rate',
      'Premium support: shared channel, named contact, one-hour first response',
    ],
    sortOrder: 50,
  },
];
