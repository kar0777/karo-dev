import { beforeEach, describe, expect, it } from 'vitest';

import { __resetMockSandboxes, MockSandboxProvider } from '@/lib/sandbox/providers/mock';
import { SandboxError, type CreateSandboxOptions } from '@/lib/sandbox/types';

const provider = new MockSandboxProvider();

const OPTIONS: CreateSandboxOptions = {
  sandboxId: 'sbx_test_0000000001',
  teamId: 'team_test',
  projectId: 'prj_test',
  name: 'test-sandbox',
  image: 'karo/sandbox-base:1',
  cpuCores: 0.5,
  memoryMb: 1024,
  diskGb: 20,
  executionTimeoutSeconds: 120,
  maxProcesses: 128,
  networkPolicy: 'restricted',
  allowDocker: false,
};

async function fresh(id = OPTIONS.sandboxId) {
  return provider.createSandbox({ ...OPTIONS, sandboxId: id });
}

beforeEach(() => {
  __resetMockSandboxes();
});

describe('lifecycle', () => {
  it('creates a running sandbox with a workspace', async () => {
    const sandbox = await fresh();
    expect(sandbox.status).toBe('running');
    expect(sandbox.provider).toBe('mock');
    expect(sandbox.workspacePath).toBe('/workspace');
    expect(sandbox.externalId).toContain('mock-');
  });

  it('moves through stop and start', async () => {
    await fresh();
    await provider.stopSandbox(OPTIONS.sandboxId);
    expect(await provider.getStatus(OPTIONS.sandboxId)).toBe('stopped');
    await provider.startSandbox(OPTIONS.sandboxId);
    expect(await provider.getStatus(OPTIONS.sandboxId)).toBe('running');
  });

  it('reports destroyed after destruction', async () => {
    await fresh();
    await provider.destroySandbox(OPTIONS.sandboxId);
    expect(await provider.getStatus(OPTIONS.sandboxId)).toBe('destroyed');
  });

  it('refuses to run commands while stopped', async () => {
    await fresh();
    await provider.stopSandbox(OPTIONS.sandboxId);
    await expect(provider.execute(OPTIONS.sandboxId, { command: 'ls' })).rejects.toThrow(
      SandboxError,
    );
  });

  it('raises a not_found error for an unknown sandbox', async () => {
    await expect(provider.execute('sbx_missing', { command: 'ls' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('keeps sandboxes isolated from each other', async () => {
    await fresh('sbx_a');
    await fresh('sbx_b');
    await provider.uploadFiles('sbx_a', [{ path: 'only-in-a.txt', content: 'a' }]);

    const a = await provider.execute('sbx_a', { command: 'cat only-in-a.txt' });
    const b = await provider.execute('sbx_b', { command: 'cat only-in-a.txt' });
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).not.toBe(0);
  });
});

describe('filesystem', () => {
  it('seeds a starter workspace', async () => {
    await fresh();
    const files = await provider.listFiles(OPTIONS.sandboxId, '.');
    const names = files.map((f) => f.name);
    expect(names).toContain('README.md');
    expect(names).toContain('package.json');
  });

  it('uploads and reads a file back', async () => {
    await fresh();
    await provider.uploadFiles(OPTIONS.sandboxId, [
      { path: 'src/app.ts', content: 'export const x = 1;' },
    ]);
    const buffer = await provider.downloadFile(OPTIONS.sandboxId, 'src/app.ts');
    expect(buffer.toString('utf8')).toBe('export const x = 1;');
  });

  it('creates intermediate directories on upload', async () => {
    await fresh();
    await provider.uploadFiles(OPTIONS.sandboxId, [
      { path: 'a/b/c/deep.txt', content: 'deep' },
    ]);
    const top = await provider.listFiles(OPTIONS.sandboxId, '.');
    expect(top.find((f) => f.name === 'a')?.isDirectory).toBe(true);
  });

  it('decodes base64 uploads', async () => {
    await fresh();
    await provider.uploadFiles(OPTIONS.sandboxId, [
      { path: 'bin.txt', content: Buffer.from('hello').toString('base64'), encoding: 'base64' },
    ]);
    expect((await provider.downloadFile(OPTIONS.sandboxId, 'bin.txt')).toString()).toBe(
      'hello',
    );
  });

  it('deletes a directory tree', async () => {
    await fresh();
    await provider.uploadFiles(OPTIONS.sandboxId, [
      { path: 'tmp/one.txt', content: '1' },
      { path: 'tmp/two.txt', content: '2' },
    ]);
    await provider.deleteFile(OPTIONS.sandboxId, 'tmp');
    const files = await provider.listFiles(OPTIONS.sandboxId, '.');
    expect(files.map((f) => f.name)).not.toContain('tmp');
  });

  it('refuses to read outside the workspace', async () => {
    await fresh();
    await expect(
      provider.downloadFile(OPTIONS.sandboxId, '../../etc/passwd'),
    ).rejects.toThrow();
  });

  it('reports a missing file rather than returning empty content', async () => {
    await fresh();
    await expect(provider.downloadFile(OPTIONS.sandboxId, 'nope.txt')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('simulated shell', () => {
  it('runs pwd, whoami and echo', async () => {
    await fresh();
    expect((await provider.execute(OPTIONS.sandboxId, { command: 'pwd' })).stdout.trim()).toBe(
      '/workspace',
    );
    expect(
      (await provider.execute(OPTIONS.sandboxId, { command: 'whoami' })).stdout.trim(),
    ).toBe('karo');
    expect(
      (
        await provider.execute(OPTIONS.sandboxId, { command: 'echo hello world' })
      ).stdout.trim(),
    ).toBe('hello world');
  });

  it('lists and reads files', async () => {
    await fresh();
    const ls = await provider.execute(OPTIONS.sandboxId, { command: 'ls' });
    expect(ls.stdout).toContain('README.md');

    const cat = await provider.execute(OPTIONS.sandboxId, { command: 'cat README.md' });
    expect(cat.stdout).toContain('simulated');
    expect(cat.exitCode).toBe(0);
  });

  it('creates and removes files through the shell', async () => {
    await fresh();
    await provider.execute(OPTIONS.sandboxId, { command: 'mkdir src' });
    await provider.execute(OPTIONS.sandboxId, { command: 'touch src/index.ts' });
    const ls = await provider.execute(OPTIONS.sandboxId, { command: 'ls src' });
    expect(ls.stdout).toContain('index.ts');

    await provider.execute(OPTIONS.sandboxId, { command: 'rm -r src' });
    const after = await provider.execute(OPTIONS.sandboxId, { command: 'ls' });
    expect(after.stdout).not.toContain('src');
  });

  it('changes directory and tracks it in the prompt state', async () => {
    await fresh();
    await provider.execute(OPTIONS.sandboxId, { command: 'mkdir deep' });
    const result = await provider.execute(OPTIONS.sandboxId, { command: 'cd deep && pwd' });
    expect(result.stdout).toContain('/workspace/deep');
  });

  it('refuses to cd outside the workspace', async () => {
    await fresh();
    const result = await provider.execute(OPTIONS.sandboxId, { command: 'cd /etc' });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toContain('denied');
  });

  it('reports a non-zero exit for an unknown command', async () => {
    await fresh();
    const result = await provider.execute(OPTIONS.sandboxId, {
      command: 'definitely-not-real',
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('command not found');
  });

  it('short-circuits an && chain when the first command fails', async () => {
    await fresh();
    const result = await provider.execute(OPTIONS.sandboxId, {
      command: 'cat missing.txt && echo SHOULD_NOT_APPEAR',
    });
    expect(result.stdout).not.toContain('SHOULD_NOT_APPEAR');
  });

  it('greps file contents', async () => {
    await fresh();
    await provider.uploadFiles(OPTIONS.sandboxId, [
      { path: 'src/a.ts', content: 'const needle = 1;' },
    ]);
    const result = await provider.execute(OPTIONS.sandboxId, {
      command: 'grep needle src/a.ts',
    });
    expect(result.stdout).toContain('needle');
    expect(result.exitCode).toBe(0);
  });

  it('returns exit 1 from grep when nothing matches, like the real tool', async () => {
    await fresh();
    const result = await provider.execute(OPTIONS.sandboxId, {
      command: 'grep zzzznotfound README.md',
    });
    expect(result.exitCode).toBe(1);
  });

  it('simulates package manager and git output', async () => {
    await fresh();
    expect(
      (await provider.execute(OPTIONS.sandboxId, { command: 'npm install' })).stdout,
    ).toContain('simulated');
    expect(
      (await provider.execute(OPTIONS.sandboxId, { command: 'git status' })).stdout,
    ).toContain('On branch main');
    expect(
      (await provider.execute(OPTIONS.sandboxId, { command: 'npm run build' })).stdout,
    ).toContain('Compiled successfully');
  });

  it('is honest that the network and docker are unavailable', async () => {
    await fresh();
    const curl = await provider.execute(OPTIONS.sandboxId, { command: 'curl https://x.dev' });
    expect(curl.exitCode).not.toBe(0);
    expect(curl.stderr).toContain('network access is disabled');

    const docker = await provider.execute(OPTIONS.sandboxId, { command: 'docker ps' });
    expect(docker.exitCode).not.toBe(0);
  });

  it('redacts a secret that appears in command output', async () => {
    await fresh();
    await provider.uploadFiles(OPTIONS.sandboxId, [
      { path: '.env', content: 'STRIPE_SECRET_KEY=sk_live_51ABCdefGHIjklMNOpqrST' },
    ]);
    const result = await provider.execute(OPTIONS.sandboxId, { command: 'cat .env' });
    expect(result.stdout).not.toContain('sk_live_51ABCdefGHIjklMNOpqrST');
    expect(result.stdout).toContain('[redacted]');
  });
});

describe('metrics', () => {
  it('reports plausible telemetry for a running sandbox', async () => {
    await fresh();
    const metrics = await provider.getMetrics(OPTIONS.sandboxId);
    expect(metrics.memoryLimitMb).toBe(OPTIONS.memoryMb);
    expect(metrics.diskLimitMb).toBe(OPTIONS.diskGb * 1024);
    expect(metrics.cpuPercent).toBeGreaterThan(0);
    expect(metrics.cpuPercent).toBeLessThan(100);
    expect(metrics.memoryUsedMb).toBeLessThanOrEqual(metrics.memoryLimitMb);
    expect(metrics.processCount).toBeGreaterThan(0);
  });

  it('reports zero usage once stopped', async () => {
    await fresh();
    await provider.stopSandbox(OPTIONS.sandboxId);
    const metrics = await provider.getMetrics(OPTIONS.sandboxId);
    expect(metrics.cpuPercent).toBe(0);
    expect(metrics.memoryUsedMb).toBe(0);
    expect(metrics.processCount).toBe(0);
  });
});

describe('provider contract', () => {
  it('is always available and never bills compute', async () => {
    expect(await provider.isAvailable()).toBe(true);
    expect(provider.upstreamMicroUsdPerBaseHour).toBe(0);
    expect(provider.computeMultiplier).toBe(1);
    expect(provider.key).toBe('mock');
  });
});
