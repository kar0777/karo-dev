import 'server-only';

import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { DaytonaSandboxProvider } from './providers/daytona';
import { LocalDockerSandboxProvider } from './providers/local-docker';
import { MockSandboxProvider } from './providers/mock';
import { RemoteDockerSandboxProvider } from './providers/remote-docker';
import type { SandboxProvider, SandboxProviderKey } from './types';

const log = createLogger('sandbox');

const mock = new MockSandboxProvider();
let localDocker: LocalDockerSandboxProvider | null = null;
let daytona: DaytonaSandboxProvider | null = null;
let remoteDocker: RemoteDockerSandboxProvider | null = null;

export function getProvider(key: SandboxProviderKey): SandboxProvider {
  switch (key) {
    case 'local-docker':
      localDocker ??= new LocalDockerSandboxProvider();
      return localDocker;
    case 'daytona':
      daytona ??= new DaytonaSandboxProvider();
      return daytona;
    case 'remote-docker':
      remoteDocker ??= new RemoteDockerSandboxProvider();
      return remoteDocker;
    case 'mock':
    case 'external':
    default:
      return mock;
  }
}

export function getMockProvider(): MockSandboxProvider {
  return mock;
}

export function getDaytonaProvider(): DaytonaSandboxProvider {
  daytona ??= new DaytonaSandboxProvider();
  return daytona;
}

export function getRemoteDockerProvider(): RemoteDockerSandboxProvider {
  remoteDocker ??= new RemoteDockerSandboxProvider();
  return remoteDocker;
}

/**
 * Chooses the provider for a *new* sandbox.
 *
 * Existing sandboxes always use the provider recorded on their row — a machine
 * does not migrate between providers because an environment variable changed.
 */
export async function resolveProviderForTarget(
  runtimeTarget: 'karo_cloud' | 'own_server' | 'external_sandbox' | 'local',
): Promise<SandboxProvider> {
  if (runtimeTarget === 'own_server') return getRemoteDockerProvider();

  if (runtimeTarget === 'external_sandbox') {
    const provider = getProvider('daytona');
    if (await provider.isAvailable()) return provider;
    log.warn('External sandbox provider unavailable — falling back to the simulator.');
    return mock;
  }

  // karo_cloud / local
  const configured = env.RESOLVED_SANDBOX_PROVIDER;
  if (configured === 'mock') return mock;

  const provider = getProvider(configured);
  if (await provider.isAvailable()) return provider;

  log.warn('Configured sandbox provider is unavailable — falling back to the simulator.', {
    configured,
  });
  return mock;
}

/** Provider descriptions surfaced in the sandbox creation UI. */
export const PROVIDER_META: Record<
  SandboxProviderKey,
  { label: string; description: string; billed: boolean }
> = {
  mock: {
    label: 'Karo Demo',
    description:
      'A simulated machine that runs entirely in memory. Great for exploring Karo; nothing is really executed.',
    billed: false,
  },
  'local-docker': {
    label: 'Karo Cloud',
    description:
      'A rootless container with hard CPU, memory, disk and process limits on an isolated network.',
    billed: true,
  },
  daytona: {
    label: 'Daytona',
    description: 'A managed cloud sandbox provisioned through Daytona.',
    billed: true,
  },
  'remote-docker': {
    label: 'Your own server',
    description:
      'Runs on hardware you control through the Karo worker. Metered for visibility, never billed.',
    billed: false,
  },
  external: {
    label: 'External provider',
    description: 'A third-party sandbox provider connected through its own API.',
    billed: true,
  },
};

export * from './types';
export {
  MockSandboxProvider,
  LocalDockerSandboxProvider,
  DaytonaSandboxProvider,
  RemoteDockerSandboxProvider,
};
