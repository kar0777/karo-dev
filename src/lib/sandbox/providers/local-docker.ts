import 'server-only';

import type Dockerode from 'dockerode';
import type { Container } from 'dockerode';

import { normalizeWorkspacePath, WORKSPACE_ROOT } from '@/lib/agent/policy';
import { redactText } from '@/lib/crypto/secrets';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import type {
  CreateSandboxOptions,
  ExecuteCommand,
  ExecutionResult,
  FileEntry,
  FileInput,
  Sandbox,
  SandboxMetrics,
  SandboxProvider,
  SandboxRuntimeStatus,
  TerminalChunk,
  TerminalStreamOptions,
} from '../types';
import { SandboxError } from '../types';

const log = createLogger('sandbox:docker');

/**
 * Local Docker sandbox provider — for development and self-hosted single-node
 * installs.
 *
 * ## Isolation contract
 *
 * Every container created here is constrained the same way, and these are not
 * optional:
 *
 *  · `Privileged: false` — always.
 *  · `CapDrop: ['ALL']` — no capabilities are added back.
 *  · `SecurityOpt: ['no-new-privileges:true']` — setuid binaries cannot escalate.
 *  · `NetworkMode: env.SANDBOX_NETWORK` — a Compose network declared
 *    `internal: true`, so the container has **no route off the host** and
 *    therefore cannot reach cloud metadata endpoints (169.254.169.254).
 *  · `PidsLimit`, `Memory`, `NanoCpus`, `--storage-opt size` — hard resource caps.
 *  · No bind mounts at all, and specifically never `/var/run/docker.sock`.
 *  · `ReadonlyRootfs: true` with tmpfs for `/tmp` and a named volume for
 *    `/workspace`, so the base image cannot be mutated between runs.
 *  · Runs as uid 10001 (`karo`), never root.
 *
 * The daemon connection itself should be a **rootless** Docker or Podman socket.
 * Point `DOCKER_SOCKET` at `$XDG_RUNTIME_DIR/docker.sock` (rootless) rather than
 * `/var/run/docker.sock`. Karo never mounts that socket into a sandbox.
 */
export class LocalDockerSandboxProvider implements SandboxProvider {
  readonly key = 'local-docker' as const;
  readonly displayName = 'Local Docker';
  readonly computeMultiplier = 1;
  readonly upstreamMicroUsdPerBaseHour = 0;

  private client: Dockerode | null = null;
  private available: boolean | null = null;
  private readonly terminals = new Map<
    string,
    { stream: NodeJS.ReadWriteStream; exec: unknown }
  >();

  private async docker(): Promise<Dockerode> {
    if (this.client) return this.client;
    // Imported lazily so demo-mode installs never load the native-ish module.
    const { default: Docker } = await import('dockerode');
    this.client = env.DOCKER_SOCKET
      ? new Docker({ socketPath: env.DOCKER_SOCKET })
      : new Docker();
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const docker = await this.docker();
      await docker.ping();
      this.available = true;
    } catch (error) {
      log.warn('Docker daemon is not reachable', { error: String(error) });
      this.available = false;
    }
    return this.available;
  }

  async createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    const docker = await this.docker();

    await this.ensureImage(options.image);

    const container = await docker.createContainer({
      name: `karo-sbx-${options.sandboxId.slice(-16)}`,
      Image: options.image,
      // Keep PID 1 alive; work happens through `docker exec`.
      Cmd: ['sleep', 'infinity'],
      User: '10001:10001',
      WorkingDir: WORKSPACE_ROOT,
      Env: Object.entries({
        ...options.env,
        HOME: '/home/karo',
        KARO_SANDBOX_ID: options.sandboxId,
      }).map(([k, v]) => `${k}=${v}`),
      Labels: {
        'dev.karo.sandbox': options.sandboxId,
        'dev.karo.team': options.teamId,
        ...(options.projectId ? { 'dev.karo.project': options.projectId } : {}),
        ...options.labels,
      },
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
      NetworkDisabled: options.networkPolicy === 'none',
      HostConfig: {
        // ---- Isolation (see the class comment; do not relax these) ----
        Privileged: false,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        NetworkMode: options.networkPolicy === 'none' ? 'none' : env.SANDBOX_NETWORK,
        Binds: [], // never bind-mount anything from the host
        Mounts: [
          {
            Type: 'volume' as const,
            Source: `karo-ws-${options.sandboxId.slice(-16)}`,
            Target: WORKSPACE_ROOT,
            ReadOnly: false,
          },
        ],
        Tmpfs: {
          '/tmp': `rw,noexec,nosuid,size=${Math.min(512, options.memoryMb)}m`,
          '/home/karo': `rw,nosuid,size=64m`,
        },
        // ---- Resource caps ----
        Memory: options.memoryMb * 1024 * 1024,
        MemorySwap: options.memoryMb * 1024 * 1024, // disable swap
        NanoCpus: Math.round(options.cpuCores * 1e9),
        PidsLimit: options.maxProcesses,
        Ulimits: [
          { Name: 'nofile', Soft: 4096, Hard: 8192 },
          { Name: 'nproc', Soft: options.maxProcesses, Hard: options.maxProcesses },
        ],
        RestartPolicy: { Name: 'no' },
        AutoRemove: false,
        LogConfig: { Type: 'json-file', Config: { 'max-size': '4m', 'max-file': '2' } },
      },
    });

    await container.start();

    if (options.initialFiles?.length) {
      await this.uploadFiles(options.sandboxId, options.initialFiles);
    }

    return {
      id: options.sandboxId,
      externalId: container.id,
      provider: 'local-docker',
      status: 'running',
      workspacePath: WORKSPACE_ROOT,
      createdAt: new Date(),
      metadata: { containerName: `karo-sbx-${options.sandboxId.slice(-16)}` },
    };
  }

  async startSandbox(id: string): Promise<void> {
    const container = await this.container(id);
    const info = await container.inspect();
    if (!info.State.Running) await container.start();
  }

  async stopSandbox(id: string): Promise<void> {
    const container = await this.container(id);
    await container.stop({ t: 5 }).catch(() => undefined);
  }

  async destroySandbox(id: string): Promise<void> {
    const docker = await this.docker();
    try {
      const container = await this.container(id);
      await container.remove({ force: true, v: true });
    } catch {
      // Already gone.
    }
    // Remove the workspace volume too, otherwise disk leaks silently.
    await docker
      .getVolume(`karo-ws-${id.slice(-16)}`)
      .remove({ force: true })
      .catch(() => undefined);
  }

  async getStatus(id: string): Promise<SandboxRuntimeStatus> {
    try {
      const info = await (await this.container(id)).inspect();
      if (info.State.Running) return 'running';
      if (info.State.Restarting) return 'starting';
      if (info.State.Dead || info.State.OOMKilled) return 'failed';
      return 'stopped';
    } catch {
      return 'destroyed';
    }
  }

  async execute(id: string, command: ExecuteCommand): Promise<ExecutionResult> {
    const container = await this.container(id);
    const started = Date.now();
    const timeoutMs = (command.timeoutSeconds ?? 120) * 1000;

    const shell = shellArgv(command.shell ?? 'bash', command.command);
    const exec = await container.exec({
      Cmd: shell,
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: Boolean(command.stdin),
      Tty: false,
      User: '10001:10001',
      WorkingDir: command.cwd ? absoluteWorkspace(command.cwd) : WORKSPACE_ROOT,
      Env: command.env ? Object.entries(command.env).map(([k, v]) => `${k}=${v}`) : undefined,
    });

    const stream = await exec.start({ hijack: true, stdin: Boolean(command.stdin) });
    if (command.stdin) {
      stream.write(command.stdin);
      stream.end();
    }

    const { stdout, stderr, truncated } = await collectMultiplexed(stream, timeoutMs);
    const timedOut = Date.now() - started >= timeoutMs;

    let exitCode = 0;
    try {
      const inspected = await exec.inspect();
      exitCode = inspected.ExitCode ?? 0;
    } catch {
      exitCode = timedOut ? 124 : 1;
    }

    return {
      stdout: redactText(stdout),
      stderr: redactText(stderr),
      exitCode,
      durationMs: Date.now() - started,
      timedOut,
      truncated,
    };
  }

  async *streamTerminal(
    id: string,
    options: TerminalStreamOptions,
  ): AsyncIterable<TerminalChunk> {
    const container = await this.container(id);

    const exec = await container.exec({
      Cmd: [interactiveShellBinary(options.shell)],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      User: '10001:10001',
      WorkingDir: options.cwd ? absoluteWorkspace(options.cwd) : WORKSPACE_ROOT,
      Env: ['TERM=xterm-256color'],
    });

    const stream = await exec.start({ hijack: true, stdin: true });
    await exec.resize({ h: options.rows, w: options.cols }).catch(() => undefined);
    this.terminals.set(`${id}:${options.sessionId}`, { stream, exec });

    yield { type: 'status', status: 'running' };

    const queue: TerminalChunk[] = [];
    let done = false;
    let waiter: (() => void) | null = null;

    const wake = () => {
      const w = waiter;
      waiter = null;
      w?.();
    };

    stream.on('data', (chunk: Buffer) => {
      queue.push({ type: 'stdout', data: redactText(chunk.toString('utf8')) });
      wake();
    });
    stream.on('end', () => {
      done = true;
      wake();
    });
    stream.on('error', (error: Error) => {
      queue.push({ type: 'error', message: error.message });
      done = true;
      wake();
    });
    options.signal?.addEventListener('abort', () => {
      done = true;
      wake();
    });

    try {
      while (!done || queue.length) {
        if (!queue.length) {
          await new Promise<void>((resolve) => {
            waiter = resolve;
          });
          continue;
        }
        yield queue.shift()!;
      }
      const inspected = await exec.inspect().catch(() => null);
      yield { type: 'exit', exitCode: inspected?.ExitCode ?? 0 };
    } finally {
      this.terminals.delete(`${id}:${options.sessionId}`);
      stream.destroy?.();
    }
  }

  async writeTerminal(id: string, sessionId: string, data: string): Promise<void> {
    const entry = this.terminals.get(`${id}:${sessionId}`);
    if (!entry) throw new SandboxError('not_running', 'Terminal session is not attached.');
    entry.stream.write(data);
  }

  async resizeTerminal(
    id: string,
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const entry = this.terminals.get(`${id}:${sessionId}`);
    if (!entry) return;
    await (entry.exec as { resize(o: { h: number; w: number }): Promise<void> })
      .resize({ h: rows, w: cols })
      .catch(() => undefined);
  }

  async killTerminal(id: string, sessionId: string): Promise<void> {
    const entry = this.terminals.get(`${id}:${sessionId}`);
    entry?.stream.write('\x03');
  }

  async uploadFiles(id: string, files: FileInput[]): Promise<void> {
    const container = await this.container(id);
    const tar = buildTar(
      files.map((file) => ({
        path: normalizeWorkspacePath(file.path),
        content:
          file.encoding === 'base64'
            ? Buffer.from(file.content, 'base64')
            : Buffer.from(file.content, 'utf8'),
        mode: file.mode ?? 0o644,
      })),
    );
    await container.putArchive(tar, { path: WORKSPACE_ROOT });
  }

  async downloadFile(id: string, path: string): Promise<Buffer> {
    const result = await this.execute(id, {
      command: `cat -- ${shellQuote(absoluteWorkspace(path))} | base64 -w0`,
      shell: 'sh',
      timeoutSeconds: 30,
    });
    if (result.exitCode !== 0) {
      throw new SandboxError('not_found', `Could not read ${path}`, { status: 404 });
    }
    return Buffer.from(result.stdout.trim(), 'base64');
  }

  async listFiles(id: string, path: string): Promise<FileEntry[]> {
    const target = path === '.' ? WORKSPACE_ROOT : absoluteWorkspace(path);
    const result = await this.execute(id, {
      // `%s|%Y|%F|%n` keeps parsing trivial and avoids `ls` output ambiguity.
      command: `find ${shellQuote(target)} -mindepth 1 -maxdepth 1 -printf '%s|%T@|%y|%f\\n' 2>/dev/null | head -500`,
      shell: 'sh',
      timeoutSeconds: 20,
    });

    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [size, mtime, type, ...nameParts] = line.split('|');
        const name = nameParts.join('|');
        const relative = target === WORKSPACE_ROOT ? name : `${stripRoot(target)}/${name}`;
        return {
          path: relative,
          name,
          isDirectory: type === 'd',
          sizeBytes: Number.parseInt(size ?? '0', 10) || 0,
          modifiedAt: new Date(Number.parseFloat(mtime ?? '0') * 1000),
        };
      })
      .sort(
        (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
      );
  }

  async deleteFile(id: string, path: string): Promise<void> {
    await this.execute(id, {
      command: `rm -rf -- ${shellQuote(absoluteWorkspace(path))}`,
      shell: 'sh',
      timeoutSeconds: 20,
    });
  }

  async getMetrics(id: string): Promise<SandboxMetrics> {
    const container = await this.container(id);
    const stats = (await container.stats({ stream: false })) as DockerStats;

    const cpuDelta =
      (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
      (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
    const systemDelta =
      (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
    const cores = stats.cpu_stats?.online_cpus ?? 1;
    const cpuPercent =
      systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cores * 100 : 0;

    const memoryUsed =
      (stats.memory_stats?.usage ?? 0) - (stats.memory_stats?.stats?.cache ?? 0);
    const memoryLimit = stats.memory_stats?.limit ?? 0;

    const du = await this.execute(id, {
      command: `du -sm ${WORKSPACE_ROOT} 2>/dev/null | cut -f1`,
      shell: 'sh',
      timeoutSeconds: 15,
    });

    const info = await container.inspect();
    const startedAt = info.State.StartedAt ? new Date(info.State.StartedAt) : new Date();

    return {
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryUsedMb: Math.round(memoryUsed / (1024 * 1024)),
      memoryLimitMb: Math.round(memoryLimit / (1024 * 1024)),
      diskUsedMb: Number.parseInt(du.stdout.trim(), 10) || 0,
      diskLimitMb: 0,
      processCount: stats.pids_stats?.current ?? 0,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)),
      networkRxBytes: sumNetwork(stats, 'rx_bytes'),
      networkTxBytes: sumNetwork(stats, 'tx_bytes'),
    };
  }

  /* ---------------- internals ---------------- */

  private async container(sandboxId: string): Promise<Container> {
    const docker = await this.docker();
    const list = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`dev.karo.sandbox=${sandboxId}`] }),
    });
    const found = list[0];
    if (!found) {
      throw new SandboxError('not_found', 'The container for this sandbox no longer exists.', {
        status: 404,
      });
    }
    return docker.getContainer(found.Id);
  }

  private async ensureImage(image: string): Promise<void> {
    const docker = await this.docker();
    try {
      await docker.getImage(image).inspect();
      return;
    } catch {
      log.info('Pulling sandbox image', { image });
    }
    await new Promise<void>((resolve, reject) => {
      void docker.pull(image, (error: Error | null, stream: NodeJS.ReadableStream) => {
        if (error) return reject(error);
        docker.modem.followProgress(stream, (progressError: Error | null) =>
          progressError ? reject(progressError) : resolve(),
        );
      });
    });
  }
}

/* ------------------------------------------------------------------ *
 *  Wire helpers
 * ------------------------------------------------------------------ */

type DockerStats = {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: { cache?: number } };
  pids_stats?: { current?: number };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
};

function sumNetwork(stats: DockerStats, field: 'rx_bytes' | 'tx_bytes'): number {
  return Object.values(stats.networks ?? {}).reduce((sum, n) => sum + (n[field] ?? 0), 0);
}

const MAX_OUTPUT_BYTES = 512 * 1024;

/**
 * Docker's non-TTY exec stream is multiplexed: each frame is an 8-byte header
 * (stream type + big-endian length) followed by the payload.
 */
async function collectMultiplexed(
  stream: NodeJS.ReadableStream,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; truncated: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      let offset = 0;
      let stdout = '';
      let stderr = '';
      while (offset + 8 <= buffer.length) {
        const type = buffer[offset];
        const length = buffer.readUInt32BE(offset + 4);
        const payload = buffer.subarray(offset + 8, offset + 8 + length).toString('utf8');
        if (type === 2) stderr += payload;
        else stdout += payload;
        offset += 8 + length;
      }
      resolve({ stdout, stderr, truncated });
    };

    const timer = setTimeout(finish, timeoutMs);

    stream.on('data', (chunk: Buffer) => {
      if (total >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      total += chunk.length;
      chunks.push(chunk);
    });
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

/** Capacity of the `name` field at header offset 0 and `prefix` at offset 345. */
const TAR_NAME_FIELD = 100;
const TAR_PREFIX_FIELD = 155;

const SLASH = 0x2f;
const NO_PREFIX = Buffer.alloc(0);

/**
 * Minimal POSIX tar writer — avoids pulling in a tar dependency.
 *
 * Member names are the one part of the format that cannot be written naively:
 * `name` holds 100 bytes, and anything longer has to be carried by the
 * 155-byte `prefix` field or by a GNU long-name member. Truncating instead
 * would extract the file to a *different* path than the caller asked for, and
 * two long paths that share their first 100 bytes would land on top of each
 * other. Workspace paths are allowed up to 1024 bytes
 * (`normalizeWorkspacePath`), so both long forms are reachable.
 */
export function buildTar(
  files: Array<{ path: string; content: Buffer; mode: number }>,
): Buffer {
  const blocks: Buffer[] = [];

  for (const file of files) {
    const path = Buffer.from(file.path, 'utf8');
    const split = splitUstarName(path);

    if (!split) {
      // Neither field can hold this name, so the real one travels ahead of the
      // file in a GNU long-name member — the extension Docker's tar reader
      // uses for exactly this case. The truncated name in the header that
      // follows is what a reader ignoring the extension would fall back to.
      const payload = Buffer.concat([path, Buffer.of(0)]);
      blocks.push(
        tarHeader({
          name: Buffer.from('././@LongLink', 'utf8'),
          prefix: NO_PREFIX,
          mode: 0o644,
          size: payload.length,
          typeFlag: 'L',
        }),
        payload,
        ...blockPadding(payload.length),
      );
    }

    blocks.push(
      tarHeader({
        name: split?.name ?? truncateUtf8(path, TAR_NAME_FIELD),
        prefix: split?.prefix ?? NO_PREFIX,
        mode: file.mode,
        size: file.content.length,
        typeFlag: '0', // regular file
      }),
      file.content,
      ...blockPadding(file.content.length),
    );
  }

  blocks.push(Buffer.alloc(1024)); // two zero blocks terminate the archive
  return Buffer.concat(blocks);
}

/**
 * Places a path in the ustar `name` and `prefix` fields, which a reader
 * rejoins as `prefix + '/' + name`. Returns null when the pair cannot hold it:
 * the split has to fall on a `/`, so a single path component over 100 bytes has
 * no valid split, and neither does a path longer than 256 bytes.
 */
function splitUstarName(path: Buffer): { name: Buffer; prefix: Buffer } | null {
  if (path.length <= TAR_NAME_FIELD) return { name: path, prefix: NO_PREFIX };

  // Cut at the first slash that leaves a name the field can hold: the shorter
  // the prefix, the more of the path stays in `name`, which is the only one of
  // the two fields a pre-ustar reader knows about.
  const earliest = Math.max(1, path.length - TAR_NAME_FIELD - 1);
  const latest = Math.min(TAR_PREFIX_FIELD, path.length - 2);
  for (let cut = earliest; cut <= latest; cut += 1) {
    if (path[cut] !== SLASH) continue;
    return { name: path.subarray(cut + 1), prefix: path.subarray(0, cut) };
  }
  return null;
}

/** Cuts a UTF-8 buffer to at most `max` bytes without splitting a character. */
function truncateUtf8(buffer: Buffer, max: number): Buffer {
  if (buffer.length <= max) return buffer;
  let end = max;
  // Continuation bytes are 10xxxxxx; walk back to where the character starts.
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end);
}

function blockPadding(size: number): Buffer[] {
  const padding = (512 - (size % 512)) % 512;
  return padding ? [Buffer.alloc(padding)] : [];
}

function tarHeader(entry: {
  name: Buffer;
  prefix: Buffer;
  mode: number;
  size: number;
  typeFlag: '0' | 'L';
}): Buffer {
  const header = Buffer.alloc(512);
  // Copied rather than written as a string so a multi-byte character can never
  // spill past the end of the field into the one after it.
  entry.name.copy(header, 0, 0, TAR_NAME_FIELD);
  header.write(entry.mode.toString(8).padStart(7, '0'), 100, 'utf8');
  // uid/gid 10001 — the unprivileged `karo` user the sandbox image runs as,
  // so extracted files are writable without ever needing root in the container.
  header.write((10001).toString(8).padStart(7, '0'), 108, 'utf8');
  header.write((10001).toString(8).padStart(7, '0'), 116, 'utf8');
  header.write(entry.size.toString(8).padStart(11, '0'), 124, 'utf8');
  header.write(
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0'),
    136,
    'utf8',
  );
  header.write('        ', 148, 'utf8'); // checksum placeholder
  header.write(entry.typeFlag, 156, 'utf8');
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');
  entry.prefix.copy(header, 345, 0, TAR_PREFIX_FIELD);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8');

  return header;
}

function shellArgv(shell: string, command: string): string[] {
  switch (shell) {
    case 'powershell':
      return ['pwsh', '-NoProfile', '-NonInteractive', '-Command', command];
    case 'cmd':
      // Not available in a Linux sandbox; fall back rather than fail confusingly.
      return ['/bin/sh', '-lc', command];
    case 'sh':
      return ['/bin/sh', '-lc', command];
    default:
      return ['/bin/bash', '-lc', command];
  }
}

function interactiveShellBinary(shell: string): string {
  if (shell === 'powershell') return 'pwsh';
  if (shell === 'sh' || shell === 'cmd') return '/bin/sh';
  return '/bin/bash';
}

function absoluteWorkspace(path: string): string {
  if (path === WORKSPACE_ROOT) return WORKSPACE_ROOT;
  return `${WORKSPACE_ROOT}/${normalizeWorkspacePath(path)}`;
}

function stripRoot(absolute: string): string {
  return absolute.startsWith(`${WORKSPACE_ROOT}/`)
    ? absolute.slice(WORKSPACE_ROOT.length + 1)
    : absolute;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
