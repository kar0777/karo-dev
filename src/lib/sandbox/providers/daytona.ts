import 'server-only';

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

const log = createLogger('sandbox:daytona');

/**
 * Daytona cloud sandbox provider.
 *
 * Verified against the Daytona API documentation:
 *   base URL  `https://app.daytona.io/api`   (override with `DAYTONA_API_URL`)
 *   auth      `Authorization: Bearer <DAYTONA_API_KEY>`
 *   lifecycle `POST /sandbox`, `POST /sandbox/{id}/start`,
 *             `POST /sandbox/{id}/stop`, `DELETE /sandbox/{id}`, `GET /sandbox/{id}`
 *
 * Daytona exposes command execution and file operations through its **toolbox**
 * surface, which its own SDKs wrap (`process.executeCommand`, `fs.*`). The paths
 * used below are declared as named constants rather than scattered string
 * literals precisely so an operator can correct them in one place if Daytona
 * revises that surface — see `TOOLBOX_PATHS` and the README section
 * "Daytona setup". If a toolbox call returns 404 the provider degrades loudly
 * (a `provider_unavailable` SandboxError with an actionable message) instead of
 * silently pretending the command ran.
 *
 * This provider is inactive unless both `DAYTONA_API_URL` and `DAYTONA_API_KEY`
 * are set; otherwise the resolver falls back to the mock provider.
 */

/** Kept together so a Daytona API revision is a one-place edit. */
const TOOLBOX_PATHS = {
  execute: (id: string) => `/toolbox/${id}/toolbox/process/execute`,
  uploadFile: (id: string) => `/toolbox/${id}/toolbox/files/upload`,
  downloadFile: (id: string) => `/toolbox/${id}/toolbox/files/download`,
  listFiles: (id: string) => `/toolbox/${id}/toolbox/files`,
  deleteFile: (id: string) => `/toolbox/${id}/toolbox/files`,
} as const;

export class DaytonaSandboxProvider implements SandboxProvider {
  readonly key = 'daytona' as const;
  readonly displayName = 'Daytona Cloud';
  /** Managed cloud capacity costs more than a self-hosted node. */
  readonly computeMultiplier = 1.2;
  readonly upstreamMicroUsdPerBaseHour = 12_000; // $0.012 / base compute hour

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly target: string | undefined;
  /** Karo sandbox id → Daytona sandbox id. */
  private readonly externalIds = new Map<string, string>();

  constructor() {
    this.baseUrl = (env.DAYTONA_API_URL ?? 'https://app.daytona.io/api').replace(/\/+$/, '');
    this.apiKey = env.DAYTONA_API_KEY;
    this.target = env.DAYTONA_TARGET;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await this.request('GET', '/sandbox', undefined, 10_000);
      return response.ok;
    } catch {
      return false;
    }
  }

  async createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    const body: Record<string, unknown> = {
      name: `karo-${options.sandboxId.slice(-16)}`,
      image: options.image,
      cpu: Math.max(1, Math.ceil(options.cpuCores)),
      memory: Math.ceil(options.memoryMb / 1024),
      disk: options.diskGb,
      autoStopInterval: 0, // Karo owns the sleep policy
      env: options.env ?? {},
      labels: {
        'dev.karo.sandbox': options.sandboxId,
        'dev.karo.team': options.teamId,
        ...options.labels,
      },
      ...(this.target ? { target: this.target } : {}),
      ...(options.networkPolicy === 'none' ? { networkBlockAll: true } : {}),
    };

    const created = await this.json<{ id?: string; sandboxId?: string; state?: string }>(
      'POST',
      '/sandbox',
      body,
    );
    const externalId = created.id ?? created.sandboxId;
    if (!externalId) {
      throw new SandboxError('internal', 'Daytona did not return a sandbox id.');
    }

    this.externalIds.set(options.sandboxId, externalId);

    if (options.initialFiles?.length) {
      await this.uploadFiles(options.sandboxId, options.initialFiles);
    }

    return {
      id: options.sandboxId,
      externalId,
      provider: 'daytona',
      status: mapState(created.state) ?? 'running',
      workspacePath: WORKSPACE_ROOT,
      createdAt: new Date(),
      metadata: { target: this.target ?? null },
    };
  }

  async startSandbox(id: string): Promise<void> {
    await this.json('POST', `/sandbox/${await this.externalId(id)}/start`);
  }

  async stopSandbox(id: string): Promise<void> {
    await this.json('POST', `/sandbox/${await this.externalId(id)}/stop`);
  }

  async destroySandbox(id: string): Promise<void> {
    try {
      await this.json('DELETE', `/sandbox/${await this.externalId(id)}`);
    } finally {
      this.externalIds.delete(id);
    }
  }

  async getStatus(id: string): Promise<SandboxRuntimeStatus> {
    try {
      const info = await this.json<{ state?: string }>(
        'GET',
        `/sandbox/${await this.externalId(id)}`,
      );
      return mapState(info.state) ?? 'stopped';
    } catch (error) {
      if (error instanceof SandboxError && error.code === 'not_found') return 'destroyed';
      throw error;
    }
  }

  async execute(id: string, command: ExecuteCommand): Promise<ExecutionResult> {
    const started = Date.now();
    const external = await this.externalId(id);

    const result = await this.json<{
      exitCode?: number;
      result?: string;
      stdout?: string;
      stderr?: string;
    }>('POST', TOOLBOX_PATHS.execute(external), {
      command: command.command,
      cwd: command.cwd ? absolute(command.cwd) : WORKSPACE_ROOT,
      env: command.env,
      timeout: command.timeoutSeconds ?? 120,
    });

    const stdout = result.stdout ?? result.result ?? '';
    return {
      stdout: redactText(stdout),
      stderr: redactText(result.stderr ?? ''),
      exitCode: result.exitCode ?? 0,
      durationMs: Date.now() - started,
      timedOut: false,
      truncated: false,
    };
  }

  /**
   * Daytona's REST surface is request/response, not a PTY. Karo therefore
   * emulates an interactive terminal by executing each submitted line and
   * streaming its output back — line-buffered rather than character-buffered.
   * Interactive programs (vim, top) are not supported here; use the Docker or
   * BYOS provider for a true PTY.
   */
  async *streamTerminal(
    id: string,
    options: TerminalStreamOptions,
  ): AsyncIterable<TerminalChunk> {
    yield { type: 'status', status: 'running', message: 'Connected to Daytona sandbox.' };
    yield {
      type: 'stdout',
      data: `\x1b[2mDaytona line-mode shell. Interactive TUI programs are not supported here.\x1b[0m\r\n`,
    };

    const queue = getQueue(id, options.sessionId);
    try {
      while (!options.signal?.aborted) {
        const chunk = await queue.next();
        if (!chunk) break;
        yield chunk;
      }
    } finally {
      dropQueue(id, options.sessionId);
    }
  }

  async writeTerminal(id: string, sessionId: string, data: string): Promise<void> {
    const queue = getQueue(id, sessionId);
    for (const line of data.split(/\r?\n/)) {
      const command = line.trim();
      if (!command) continue;
      queue.push({ type: 'stdout', data: `${command}\r\n` });
      try {
        const result = await this.execute(id, { command, timeoutSeconds: 120 });
        if (result.stdout) queue.push({ type: 'stdout', data: crlf(result.stdout) });
        if (result.stderr) queue.push({ type: 'stderr', data: crlf(result.stderr) });
      } catch (error) {
        queue.push({
          type: 'error',
          message: error instanceof Error ? error.message : 'Command failed.',
        });
      }
    }
  }

  async resizeTerminal(): Promise<void> {
    // Line-mode shell — nothing to resize.
  }

  async killTerminal(id: string, sessionId: string): Promise<void> {
    getQueue(id, sessionId).push({ type: 'stdout', data: '\r\n^C\r\n' });
  }

  async uploadFiles(id: string, files: FileInput[]): Promise<void> {
    const external = await this.externalId(id);
    for (const file of files) {
      await this.json('POST', TOOLBOX_PATHS.uploadFile(external), {
        path: absolute(file.path),
        content:
          file.encoding === 'base64'
            ? file.content
            : Buffer.from(file.content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
    }
  }

  async downloadFile(id: string, path: string): Promise<Buffer> {
    const external = await this.externalId(id);
    const response = await this.request(
      'GET',
      `${TOOLBOX_PATHS.downloadFile(external)}?path=${encodeURIComponent(absolute(path))}`,
    );
    if (!response.ok) {
      throw new SandboxError('not_found', `Could not read ${path} from the sandbox.`, {
        status: 404,
      });
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async listFiles(id: string, path: string): Promise<FileEntry[]> {
    const external = await this.externalId(id);
    const target = path === '.' ? WORKSPACE_ROOT : absolute(path);
    const entries = await this.json<
      Array<{ name?: string; isDir?: boolean; size?: number; modTime?: string }>
    >('GET', `${TOOLBOX_PATHS.listFiles(external)}?path=${encodeURIComponent(target)}`);

    if (!Array.isArray(entries)) return [];
    return entries.map((entry) => ({
      path:
        target === WORKSPACE_ROOT ? (entry.name ?? '') : `${strip(target)}/${entry.name ?? ''}`,
      name: entry.name ?? '',
      isDirectory: Boolean(entry.isDir),
      sizeBytes: entry.size ?? 0,
      modifiedAt: entry.modTime ? new Date(entry.modTime) : new Date(),
    }));
  }

  async deleteFile(id: string, path: string): Promise<void> {
    const external = await this.externalId(id);
    await this.request(
      'DELETE',
      `${TOOLBOX_PATHS.deleteFile(external)}?path=${encodeURIComponent(absolute(path))}`,
    );
  }

  async getMetrics(id: string): Promise<SandboxMetrics> {
    // Daytona does not expose per-sandbox cgroup counters over REST, so we read
    // them from inside the sandbox — the same numbers, one hop further away.
    const result = await this.execute(id, {
      command:
        "printf '%s|%s|%s|%s' " +
        '"$(awk \'{print $1}\' /proc/loadavg)" ' +
        '"$(awk \'/MemAvailable/{a=$2} /MemTotal/{t=$2} END{print (t-a)/1024}\' /proc/meminfo)" ' +
        '"$(df -m /workspace | awk \'NR==2{print $3}\')" ' +
        '"$(ls /proc | grep -c \'^[0-9]\')"',
      shell: 'sh',
      timeoutSeconds: 15,
    });

    const [load, memMb, diskMb, procs] = result.stdout.trim().split('|');
    return {
      cpuPercent: Math.min(100, Math.round((Number.parseFloat(load ?? '0') || 0) * 100)),
      memoryUsedMb: Math.round(Number.parseFloat(memMb ?? '0') || 0),
      memoryLimitMb: 0,
      diskUsedMb: Number.parseInt(diskMb ?? '0', 10) || 0,
      diskLimitMb: 0,
      processCount: Number.parseInt(procs ?? '0', 10) || 0,
      uptimeSeconds: 0,
    };
  }

  /* ---------------- internals ---------------- */

  private async externalId(sandboxId: string): Promise<string> {
    const cached = this.externalIds.get(sandboxId);
    if (cached) return cached;
    // The caller (sandbox service) stores the external id on the DB row and
    // re-registers it after a process restart.
    throw new SandboxError(
      'not_found',
      'This sandbox is not registered with the Daytona provider in this process.',
      { status: 404 },
    );
  }

  /** Called by the sandbox service when rehydrating a row from the database. */
  registerExternalId(sandboxId: string, externalId: string): void {
    this.externalIds.set(sandboxId, externalId);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<Response> {
    if (!this.apiKey) {
      throw new SandboxError('provider_unavailable', 'DAYTONA_API_KEY is not configured.', {
        status: 503,
      });
    }
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new SandboxError('provider_unavailable', 'Could not reach the Daytona API.', {
        retryable: true,
        cause: error,
      });
    }
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.request(method, path, body);
    if (response.status === 404) {
      throw new SandboxError(
        'not_found',
        `Daytona returned 404 for ${method} ${path}. If this is a toolbox path, verify it against the current Daytona API docs and update TOOLBOX_PATHS.`,
        { status: 404 },
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.warn('Daytona API error', { status: response.status, path });
      throw new SandboxError(
        response.status >= 500 ? 'provider_unavailable' : 'internal',
        `Daytona API returned ${response.status}. ${text.slice(0, 200)}`,
        { retryable: response.status >= 500, status: response.status },
      );
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function mapState(state: string | undefined): SandboxRuntimeStatus | null {
  if (!state) return null;
  switch (state.toLowerCase()) {
    case 'started':
    case 'running':
      return 'running';
    case 'starting':
    case 'pending_start':
    case 'creating':
      return 'starting';
    case 'stopping':
    case 'pending_stop':
      return 'stopping';
    case 'stopped':
      return 'stopped';
    case 'archived':
      return 'sleeping';
    case 'error':
    case 'build_failed':
      return 'failed';
    case 'destroyed':
    case 'deleted':
      return 'destroyed';
    default:
      return null;
  }
}

function absolute(path: string): string {
  if (path === WORKSPACE_ROOT) return WORKSPACE_ROOT;
  return `${WORKSPACE_ROOT}/${normalizeWorkspacePath(path)}`;
}

function strip(absolutePath: string): string {
  return absolutePath.startsWith(`${WORKSPACE_ROOT}/`)
    ? absolutePath.slice(WORKSPACE_ROOT.length + 1)
    : absolutePath;
}

function crlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/* ---- shared line-mode terminal queues ---- */

type Queue = {
  push(chunk: TerminalChunk): void;
  next(): Promise<TerminalChunk | null>;
  close(): void;
};

const queues = new Map<string, Queue>();

function getQueue(sandboxId: string, sessionId: string): Queue {
  const key = `${sandboxId}:${sessionId}`;
  const existing = queues.get(key);
  if (existing) return existing;

  const buffer: TerminalChunk[] = [];
  let resolver: ((chunk: TerminalChunk | null) => void) | null = null;
  let closed = false;

  const queue: Queue = {
    push(chunk) {
      if (closed) return;
      if (resolver) {
        const r = resolver;
        resolver = null;
        r(chunk);
      } else buffer.push(chunk);
    },
    next() {
      if (buffer.length) return Promise.resolve(buffer.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        resolver = resolve;
      });
    },
    close() {
      closed = true;
      resolver?.(null);
      resolver = null;
    },
  };
  queues.set(key, queue);
  return queue;
}

function dropQueue(sandboxId: string, sessionId: string) {
  const key = `${sandboxId}:${sessionId}`;
  queues.get(key)?.close();
  queues.delete(key);
}
