import { describe, expect, it } from 'vitest';

import { toWorkerView } from '@/lib/account/byos-shared';
import type { ByosWorker } from '@/lib/db/schema';

/**
 * A BYOS server with no container runtime heartbeats normally and reads as
 * "Online", then fails every sandbox scheduled onto it. `WorkerView` carried no
 * hint of that at all — the panel showed hostname, CPU and RAM and stopped — so
 * a user who installed Docker after enrolling had nothing on screen that could
 * ever change to confirm it.
 */

function worker(capabilities: unknown): ByosWorker {
  const now = new Date();
  return {
    id: 'wkr_test',
    teamId: 'team_test',
    createdById: 'usr_test',
    name: 'test-box',
    status: 'online',
    installTokenHash: 'x',
    installTokenExpiresAt: new Date(now.getTime() + 3_600_000),
    workerTokenHash: 'y',
    tokenRotatedAt: null,
    hostname: 'test-box',
    platform: 'linux',
    arch: 'x64',
    agentVersion: '1.1.0',
    capabilities: capabilities as Record<string, unknown> | null,
    cpuCores: 4,
    memoryMb: 3745,
    diskGb: 40,
    lastHeartbeatAt: now,
    registeredAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  } as ByosWorker;
}

describe('toWorkerView — container runtime', () => {
  it('reports docker when the agent found it', () => {
    expect(toWorkerView(worker({ docker: true, podman: false })).runtime).toBe('docker');
  });

  it('reports podman when that is the only runtime present', () => {
    expect(toWorkerView(worker({ docker: false, podman: true })).runtime).toBe('podman');
  });

  it('reports none when the agent probed and found neither', () => {
    expect(toWorkerView(worker({ docker: false, podman: false })).runtime).toBe('none');
  });

  it('reports dry-run ahead of the runtimes it deliberately suppresses', () => {
    // A dry-run agent reports `docker: false` whether or not Docker exists, so
    // "none" would be a misdiagnosis with a misleading fix attached to it.
    expect(toWorkerView(worker({ docker: false, podman: false, dryRun: true })).runtime).toBe(
      'dry-run',
    );
  });

  it('reports unknown for an agent too old to send capabilities', () => {
    expect(toWorkerView(worker(null)).runtime).toBe('unknown');
  });

  it('does not mistake unrelated capability keys for a probe result', () => {
    expect(toWorkerView(worker({ shells: ['bash'] })).runtime).toBe('unknown');
  });
});
