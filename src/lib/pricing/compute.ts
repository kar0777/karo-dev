/**
 * Compute units.
 *
 * One **base compute hour** is one hour of:
 *   · 0.25 shared vCPU
 *   · 512 MB RAM
 *   · a standard system disk
 *
 * Bigger machines burn the same budget faster:
 *
 *   compute multiplier = CPU multiplier × RAM multiplier × provider multiplier
 *
 * The multiplier is always shown before a sandbox starts, so "100 compute
 * hours" is never a surprise.
 */

export const BASE_COMPUTE_UNIT = {
  cpuCores: 0.25,
  memoryMb: 512,
  diskGb: 5,
} as const;

/** Disk is not part of the multiplier; it is billed as storage, separately. */
export type ComputeShape = {
  cpuCores: number;
  memoryMb: number;
  diskGb?: number;
  /** Provider-specific factor: Karo Cloud 1.0, external providers vary, BYOS 0. */
  providerMultiplier?: number;
};

export type ComputeMultiplierResult = {
  value: number;
  cpu: number;
  ram: number;
  provider: number;
  explanation: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateComputeMultiplier(shape: ComputeShape): ComputeMultiplierResult {
  const cpu = round2(Math.max(shape.cpuCores, 0) / BASE_COMPUTE_UNIT.cpuCores);
  const ram = round2(Math.max(shape.memoryMb, 0) / BASE_COMPUTE_UNIT.memoryMb);
  const provider = round2(shape.providerMultiplier ?? 1);
  const value = round2(cpu * ram * provider);

  const explanation =
    `${shape.cpuCores} vCPU (×${cpu}) · ${shape.memoryMb} MB RAM (×${ram})` +
    (provider === 1 ? '' : ` · provider ×${provider}`) +
    ` → ×${value} compute rate`;

  return { value, cpu, ram, provider, explanation };
}

/** Compute hours actually charged for a running window. */
export function billedComputeHours(activeSeconds: number, multiplier: number): number {
  if (!Number.isFinite(activeSeconds) || activeSeconds <= 0) return 0;
  const hours = (activeSeconds / 3600) * Math.max(multiplier, 0);
  return Math.round(hours * 10_000) / 10_000;
}

/** Inverse: how much wall-clock time a remaining budget buys on this shape. */
export function wallClockHoursRemaining(
  computeHoursRemaining: number,
  multiplier: number,
): number {
  if (multiplier <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, computeHoursRemaining) / multiplier;
}

export type ComputeCostInput = {
  activeSeconds: number;
  multiplier: number;
  /** What Karo pays the sandbox provider per base compute hour, micro-USD. */
  upstreamMicroUsdPerBaseHour: number;
  marginBps: number;
};

export type ComputeCostResult = {
  billedHours: number;
  upstreamCostMicroUsd: number;
  chargedMicroUsd: number;
  grossMarginMicroUsd: number;
};

export function calculateComputeCost(input: ComputeCostInput): ComputeCostResult {
  const billedHours = billedComputeHours(input.activeSeconds, input.multiplier);
  const upstreamCostMicroUsd = Math.round(billedHours * input.upstreamMicroUsdPerBaseHour);
  const chargedMicroUsd = Math.round(
    upstreamCostMicroUsd * (1 + Math.max(0, input.marginBps) / 10_000),
  );
  return {
    billedHours,
    upstreamCostMicroUsd,
    chargedMicroUsd,
    grossMarginMicroUsd: chargedMicroUsd - upstreamCostMicroUsd,
  };
}

/** Presets offered in the sandbox size picker. Admin-editable at runtime. */
export type SandboxSizePreset = {
  key: string;
  label: string;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  /** Lowest plan tier that may select this size. */
  minPlanTier: 'payg' | 'lite' | 'pro' | 'scale' | 'ultra';
};

export const SANDBOX_SIZE_PRESETS: readonly SandboxSizePreset[] = [
  { key: 'nano', label: 'Nano', cpuCores: 0.25, memoryMb: 512, diskGb: 5, minPlanTier: 'payg' },
  {
    key: 'small',
    label: 'Small',
    cpuCores: 0.5,
    memoryMb: 1024,
    diskGb: 20,
    minPlanTier: 'pro',
  },
  {
    key: 'medium',
    label: 'Medium',
    cpuCores: 1,
    memoryMb: 2048,
    diskGb: 50,
    minPlanTier: 'scale',
  },
  {
    key: 'large',
    label: 'Large',
    cpuCores: 2,
    memoryMb: 4096,
    diskGb: 100,
    minPlanTier: 'scale',
  },
  {
    key: 'xlarge',
    label: 'X-Large',
    cpuCores: 4,
    memoryMb: 8192,
    diskGb: 250,
    minPlanTier: 'ultra',
  },
] as const;

export function presetFor(cpuCores: number, memoryMb: number): SandboxSizePreset | undefined {
  return SANDBOX_SIZE_PRESETS.find((p) => p.cpuCores === cpuCores && p.memoryMb === memoryMb);
}

/**
 * Memory available to *user processes*, after the sandbox agent, shell and
 * base image overhead. Surfaced verbatim in the pricing table so a 512 MB plan
 * is not mistaken for 512 MB of application memory.
 */
export function usableMemoryMb(memoryMb: number): number {
  const overhead = Math.max(96, Math.round(memoryMb * 0.18));
  return Math.max(0, memoryMb - overhead);
}
