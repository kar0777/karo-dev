import { describe, expect, it } from 'vitest';

import {
  BASE_COMPUTE_UNIT,
  billedComputeHours,
  calculateComputeCost,
  calculateComputeMultiplier,
  presetFor,
  SANDBOX_SIZE_PRESETS,
  usableMemoryMb,
  wallClockHoursRemaining,
} from '@/lib/pricing/compute';

describe('the base compute unit', () => {
  it('is 0.25 vCPU and 512 MB — the definition every plan is quoted against', () => {
    expect(BASE_COMPUTE_UNIT.cpuCores).toBe(0.25);
    expect(BASE_COMPUTE_UNIT.memoryMb).toBe(512);
  });

  it('costs exactly 1x for a machine of that size', () => {
    const result = calculateComputeMultiplier({ cpuCores: 0.25, memoryMb: 512 });
    expect(result.value).toBe(1);
    expect(result.cpu).toBe(1);
    expect(result.ram).toBe(1);
  });
});

describe('calculateComputeMultiplier', () => {
  it('multiplies CPU and RAM factors together, not averages them', () => {
    // 1 vCPU (4x base) and 2048 MB (4x base) → 16x, not 4x.
    const result = calculateComputeMultiplier({ cpuCores: 1, memoryMb: 2048 });
    expect(result.cpu).toBe(4);
    expect(result.ram).toBe(4);
    expect(result.value).toBe(16);
  });

  it('applies the provider factor on top', () => {
    const result = calculateComputeMultiplier({
      cpuCores: 0.5,
      memoryMb: 1024,
      providerMultiplier: 1.2,
    });
    expect(result.cpu).toBe(2);
    expect(result.ram).toBe(2);
    expect(result.value).toBe(4.8);
  });

  it('is 0 for a bring-your-own-server sandbox, so nothing is billed', () => {
    const result = calculateComputeMultiplier({
      cpuCores: 4,
      memoryMb: 8192,
      providerMultiplier: 0,
    });
    expect(result.value).toBe(0);
  });

  it('always produces an explanation shown before the machine starts', () => {
    const result = calculateComputeMultiplier({ cpuCores: 2, memoryMb: 4096 });
    expect(result.explanation).toContain('2 vCPU');
    expect(result.explanation).toContain('4096 MB');
    expect(result.explanation).toContain('×64');
  });

  it('omits the provider term from the explanation when it is 1', () => {
    expect(
      calculateComputeMultiplier({ cpuCores: 0.25, memoryMb: 512 }).explanation,
    ).not.toContain('provider');
  });

  it('treats a negative size as zero rather than crediting compute', () => {
    expect(calculateComputeMultiplier({ cpuCores: -2, memoryMb: 512 }).value).toBe(0);
  });
});

describe('billedComputeHours', () => {
  it('bills one wall-clock hour on a base machine as one compute hour', () => {
    expect(billedComputeHours(3600, 1)).toBe(1);
  });

  it('bills a 4x machine four times as fast', () => {
    expect(billedComputeHours(3600, 4)).toBe(4);
  });

  it('bills partial time proportionally', () => {
    expect(billedComputeHours(900, 1)).toBe(0.25);
    expect(billedComputeHours(60, 2)).toBeCloseTo(0.0333, 4);
  });

  it('bills nothing for zero or negative time', () => {
    expect(billedComputeHours(0, 4)).toBe(0);
    expect(billedComputeHours(-100, 4)).toBe(0);
  });

  it('bills nothing on a zero-multiplier (own server) machine', () => {
    expect(billedComputeHours(86_400, 0)).toBe(0);
  });
});

describe('wallClockHoursRemaining', () => {
  it('tells the user how long their remaining budget actually lasts', () => {
    // 100 included hours on a 16x machine is 6.25 real hours.
    expect(wallClockHoursRemaining(100, 16)).toBe(6.25);
  });

  it('is unbounded when compute is not billed', () => {
    expect(wallClockHoursRemaining(10, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('never goes negative once the budget is spent', () => {
    expect(wallClockHoursRemaining(-5, 2)).toBe(0);
  });
});

describe('calculateComputeCost', () => {
  it('applies the platform margin on top of the upstream cost', () => {
    const result = calculateComputeCost({
      activeSeconds: 3600,
      multiplier: 1,
      upstreamMicroUsdPerBaseHour: 9_000,
      marginBps: 2_000, // +20%
    });
    expect(result.billedHours).toBe(1);
    expect(result.upstreamCostMicroUsd).toBe(9_000);
    expect(result.chargedMicroUsd).toBe(10_800);
    expect(result.grossMarginMicroUsd).toBe(1_800);
  });

  it('scales cost with the machine size', () => {
    const small = calculateComputeCost({
      activeSeconds: 3600,
      multiplier: 1,
      upstreamMicroUsdPerBaseHour: 9_000,
      marginBps: 0,
    });
    const large = calculateComputeCost({
      activeSeconds: 3600,
      multiplier: 16,
      upstreamMicroUsdPerBaseHour: 9_000,
      marginBps: 0,
    });
    expect(large.chargedMicroUsd).toBe(small.chargedMicroUsd * 16);
  });

  it('produces a zero-margin charge when margin is zero', () => {
    const result = calculateComputeCost({
      activeSeconds: 1800,
      multiplier: 2,
      upstreamMicroUsdPerBaseHour: 10_000,
      marginBps: 0,
    });
    expect(result.chargedMicroUsd).toBe(result.upstreamCostMicroUsd);
    expect(result.grossMarginMicroUsd).toBe(0);
  });

  it('never charges a fraction of a micro-USD', () => {
    const result = calculateComputeCost({
      activeSeconds: 37,
      multiplier: 1.75,
      upstreamMicroUsdPerBaseHour: 9_000,
      marginBps: 2_000,
    });
    expect(Number.isInteger(result.chargedMicroUsd)).toBe(true);
    expect(Number.isInteger(result.upstreamCostMicroUsd)).toBe(true);
  });
});

describe('sandbox size presets', () => {
  it('starts at exactly the base unit so the cheapest plan is 1x', () => {
    const nano = SANDBOX_SIZE_PRESETS[0]!;
    expect(nano.cpuCores).toBe(BASE_COMPUTE_UNIT.cpuCores);
    expect(nano.memoryMb).toBe(BASE_COMPUTE_UNIT.memoryMb);
    expect(calculateComputeMultiplier(nano).value).toBe(1);
  });

  it('increases monotonically in both CPU and RAM', () => {
    for (let i = 1; i < SANDBOX_SIZE_PRESETS.length; i += 1) {
      const previous = SANDBOX_SIZE_PRESETS[i - 1]!;
      const current = SANDBOX_SIZE_PRESETS[i]!;
      expect(current.cpuCores).toBeGreaterThan(previous.cpuCores);
      expect(current.memoryMb).toBeGreaterThan(previous.memoryMb);
    }
  });

  it('resolves a known shape back to its preset', () => {
    expect(presetFor(0.25, 512)?.key).toBe('nano');
    expect(presetFor(4, 8192)?.key).toBe('xlarge');
    expect(presetFor(3, 999)).toBeUndefined();
  });
});

describe('usableMemoryMb', () => {
  it('reports roughly 400 MB usable on a 512 MB sandbox, as the Lite plan states', () => {
    const usable = usableMemoryMb(512);
    expect(usable).toBeGreaterThanOrEqual(380);
    expect(usable).toBeLessThanOrEqual(430);
  });

  it('always leaves headroom for the sandbox agent and shell', () => {
    for (const mb of [512, 1024, 2048, 4096, 8192]) {
      expect(usableMemoryMb(mb)).toBeLessThan(mb);
      expect(usableMemoryMb(mb)).toBeGreaterThan(0);
    }
  });

  it('never reports negative usable memory', () => {
    expect(usableMemoryMb(0)).toBe(0);
    expect(usableMemoryMb(32)).toBe(0);
  });
});
