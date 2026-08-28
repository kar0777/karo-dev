import 'server-only';

import { normalizeWorkspacePath, WORKSPACE_ROOT } from '@/lib/agent/policy';
import { redactText } from '@/lib/crypto/secrets';
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
import {
  dispatch,
  dispatchNoWait,
  isWorkerOnline,
  subscribe,
  type WorkerEvent,
} from '../worker-bus';

/**
 * Bring Your Own Server.
 *
 * Containers run in rootless Docker on hardware the user controls — a VPS, a
 * home server, a spare laptop. Karo reaches it only through the outbound worker
 * connection described in `worker-bus.ts`; there is no inbound port, no stored
 * SSH credential, and nothing about the machine is exposed to the browser.
 *
 * Compute on a user's own server is **metered but never billed** — the user is
 * already paying for the hardware. `upstreamMicroUsdPerBaseHour` is therefore 0
 * and `settleComputeUsage({ isOwnServer: true })` short-circuits the charge.
 */
export class RemoteDockerSandboxProvider implements SandboxProvider {
  readonly key = 'remote-docker' as const;
  readonly displayName = 'Your own server';
  readonly computeMultiplier = 0;
  readonly upstreamMicroUsdPerBaseHour = 0;

  /** Karo sandbox id → { workerId, externalId }. */
  private readonly routes = new Map<string, { workerId: string; externalId: string }>();

  async isAvailable(): Promise<boolean> {
    // Availability is per-worker; the service checks the specific worker.
    return true;
  }

  registerRoute(sandboxId: string, workerId: string, externalId: string): void {
    this.routes.set(sandboxId, { workerId, externalId });
  }

  private async route(sandboxId: string): Promise<{ workerId: string; externalId: string }> {
    const entry = this.routes.get(sandboxId);
    if (!entry) {
      throw new SandboxError(
        'not_found',
        'This sandbox is not bound to a server in this process.',
        { status: 404 },
      );
    }
    if (!(await isWorkerOnline(entry.workerId))) {
      throw new SandboxError(
        'worker_offline',
        'Your server is not connected. Start the karo-worker service and try again.',
        { status: 503, retryable: true },
      );
    }
    return entry;
  }

  async createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    if (!options.workerId) {
      throw new SandboxError(
        'worker_offline',
        'No server selected. Register a server under Settings → Servers first.',
        { status: 400 },
      );
    }
    if (!(await isWorkerOnline(options.workerId))) {
      throw new SandboxError(
        'worker_offline',
        'The selected server is offline. Check that karo-worker is running on it.',
        { status: 503, retryable: true },
      );
    }

    const externalId = `karo-${options.sandboxId.slice(-16)}`;

    const result = await dispatch(options.workerId, {
      kind: 'create',
      sandboxExternalId: externalId,
      image: options.image,
      cpuCores: options.cpuCores,
      memoryMb: options.memoryMb,
      diskGb: options.diskGb,
      maxProcesses: options.maxProcesses,
      networkPolicy: options.networkPolicy,
      env: options.env ?? {},
    });

    if (!result.ok) {
      throw new SandboxError(
        'internal',
        result.error ?? 'The server could not create the sandbox.',
      );
    }

    this.routes.set(options.sandboxId, { workerId: options.workerId, externalId });

    if (options.initialFiles?.length) {
      await this.uploadFiles(options.sandboxId, options.initialFiles);
    }

    return {
      id: options.sandboxId,
      externalId,
      provider: 'remote-docker',
      status: 'running',
      workspacePath: WORKSPACE_ROOT,
      createdAt: new Date(),
      metadata: { workerId: options.workerId },
    };
  }

  async startSandbox(id: string): Promise<void> {
    const { workerId, externalId } = await this.route(id);
    await this.expectOk(dispatch(workerId, { kind: 'start', sandboxExternalId: externalId }));
  }

  async stopSandbox(id: string): Promise<void> {
    const { workerId, externalId } = await this.route(id);
    await this.expectOk(dispatch(workerId, { kind: 'stop', sandboxExternalId: externalId }));
  }

  async destroySandbox(id: string): Promise<void> {
    const entry = this.routes.get(id);
    if (!entry) return;
    try {
      if (await isWorkerOnline(entry.workerId)) {
        await dispatch(entry.workerId, {
          kind: 'destroy',
          sandboxExternalId: entry.externalId,
        });
      }
    } finally {
      this.routes.delete(id);
    }
  }

  async getStatus(id: string): Promise<SandboxRuntimeStatus> {
    const entry = this.routes.get(id);
    if (!entry) return 'destroyed';
    if (!(await isWorkerOnline(entry.workerId))) return 'sleeping';
    try {
      const result = await dispatch(
        entry.workerId,
        { kind: 'status', sandboxExternalId: entry.externalId },
        15_000,
      );
      const status = (result.data as { status?: string } | undefined)?.status;
      return isRuntimeStatus(status) ? status : 'stopped';
    } catch {
      return 'failed';
    }
  }

  async execute(id: string, command: ExecuteCommand): Promise<ExecutionResult> {
    const { workerId, externalId } = await this.route(id);
    const started = Date.now();

    const result = await dispatch(
      workerId,
      {
        kind: 'exec',
        sandboxExternalId: externalId,
        command: command.command,
        shell: command.shell ?? 'bash',
        cwd: command.cwd ? absolute(command.cwd) : WORKSPACE_ROOT,
        env: command.env ?? {},
        timeoutSeconds: command.timeoutSeconds ?? 120,
      },
      (command.timeoutSeconds ?? 120) * 1000 + 15_000,
    );

    if (!result.ok) {
      throw new SandboxError('internal', result.error ?? 'The command failed on your server.');
    }

    const data = (result.data ?? {}) as {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      timedOut?: boolean;
      truncated?: boolean;
    };

    return {
      stdout: redactText(data.stdout ?? ''),
      stderr: redactText(data.stderr ?? ''),
      exitCode: data.exitCode ?? 0,
      durationMs: Date.now() - started,
      timedOut: Boolean(data.timedOut),
      truncated: Boolean(data.truncated),
    };
  }

  async *streamTerminal(
    id: string,
    options: TerminalStreamOptions,
  ): AsyncIterable<TerminalChunk> {
    const { workerId, externalId } = await this.route(id);

    const queue: TerminalChunk[] = [];
    let done = false;
    let wake: (() => void) | null = null;
    const push = (chunk: TerminalChunk) => {
      queue.push(chunk);
      const w = wake;
      wake = null;
      w?.();
    };

    const unsubscribe = subscribe(workerId, options.sessionId, (event: WorkerEvent) => {
      if (event.type === 'terminal_output') {
        push({ type: event.stream, data: redactText(event.data) });
      } else if (event.type === 'terminal_exit') {
        push({ type: 'exit', exitCode: event.exitCode });
        done = true;
      }
    });

    dispatchNoWait(workerId, {
      kind: 'terminal_open',
      sandboxExternalId: externalId,
      sessionId: options.sessionId,
      shell: options.shell,
      cols: options.cols,
      rows: options.rows,
    });

    options.signal?.addEventListener('abort', () => {
      done = true;
      wake?.();
    });

    yield { type: 'status', status: 'running', message: 'Connected to your server.' };

    try {
      while (!done || queue.length) {
        if (!queue.length) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        yield queue.shift()!;
      }
    } finally {
      unsubscribe();
      dispatchNoWait(workerId, { kind: 'terminal_close', sessionId: options.sessionId });
    }
  }

  async writeTerminal(id: string, sessionId: string, data: string): Promise<void> {
    const { workerId } = await this.route(id);
    dispatchNoWait(workerId, { kind: 'terminal_input', sessionId, data });
  }

  async resizeTerminal(
    id: string,
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const { workerId } = await this.route(id);
    dispatchNoWait(workerId, { kind: 'terminal_resize', sessionId, cols, rows });
  }

  async killTerminal(id: string, sessionId: string): Promise<void> {
    const { workerId } = await this.route(id);
    dispatchNoWait(workerId, { kind: 'terminal_input', sessionId, data: '\x03' });
  }

  async uploadFiles(id: string, files: FileInput[]): Promise<void> {
    const { workerId, externalId } = await this.route(id);
    await this.expectOk(
      dispatch(workerId, {
        kind: 'write_files',
        sandboxExternalId: externalId,
        files: files.map((file) => ({
          path: normalizeWorkspacePath(file.path),
          contentBase64:
            file.encoding === 'base64'
              ? file.content
              : Buffer.from(file.content, 'utf8').toString('base64'),
          mode: file.mode,
        })),
      }),
    );
  }

  async downloadFile(id: string, path: string): Promise<Buffer> {
    const { workerId, externalId } = await this.route(id);
    const result = await dispatch(workerId, {
      kind: 'read_file',
      sandboxExternalId: externalId,
      path: normalizeWorkspacePath(path),
    });
    if (!result.ok) {
      throw new SandboxError('not_found', result.error ?? `Could not read ${path}.`, {
        status: 404,
      });
    }
    const data = (result.data ?? {}) as { contentBase64?: string };
    return Buffer.from(data.contentBase64 ?? '', 'base64');
  }

  async listFiles(id: string, path: string): Promise<FileEntry[]> {
    const { workerId, externalId } = await this.route(id);
    const result = await dispatch(workerId, {
      kind: 'list_files',
      sandboxExternalId: externalId,
      path: path === '.' ? '' : normalizeWorkspacePath(path),
    });
    if (!result.ok) return [];

    const entries = (result.data ?? []) as Array<{
      path?: string;
      name?: string;
      isDirectory?: boolean;
      sizeBytes?: number;
      modifiedAt?: string;
    }>;

    return entries.map((entry) => ({
      path: entry.path ?? entry.name ?? '',
      name: entry.name ?? '',
      isDirectory: Boolean(entry.isDirectory),
      sizeBytes: entry.sizeBytes ?? 0,
      modifiedAt: entry.modifiedAt ? new Date(entry.modifiedAt) : new Date(),
    }));
  }

  async deleteFile(id: string, path: string): Promise<void> {
    const { workerId, externalId } = await this.route(id);
    await this.expectOk(
      dispatch(workerId, {
        kind: 'delete_file',
        sandboxExternalId: externalId,
        path: normalizeWorkspacePath(path),
      }),
    );
  }

  async getMetrics(id: string): Promise<SandboxMetrics> {
    const { workerId, externalId } = await this.route(id);
    const result = await dispatch(
      workerId,
      { kind: 'metrics', sandboxExternalId: externalId },
      20_000,
    );
    const data = (result.data ?? {}) as Partial<SandboxMetrics>;
    return {
      cpuPercent: data.cpuPercent ?? 0,
      memoryUsedMb: data.memoryUsedMb ?? 0,
      memoryLimitMb: data.memoryLimitMb ?? 0,
      diskUsedMb: data.diskUsedMb ?? 0,
      diskLimitMb: data.diskLimitMb ?? 0,
      processCount: data.processCount ?? 0,
      uptimeSeconds: data.uptimeSeconds ?? 0,
      networkRxBytes: data.networkRxBytes,
      networkTxBytes: data.networkTxBytes,
    };
  }

  private async expectOk(promise: Promise<{ ok: boolean; error?: string }>): Promise<void> {
    const result = await promise;
    if (!result.ok) {
      throw new SandboxError('internal', result.error ?? 'Your server rejected the request.');
    }
  }
}

function absolute(path: string): string {
  if (path === WORKSPACE_ROOT) return WORKSPACE_ROOT;
  return `${WORKSPACE_ROOT}/${normalizeWorkspacePath(path)}`;
}

function isRuntimeStatus(value: unknown): value is SandboxRuntimeStatus {
  return (
    typeof value === 'string' &&
    [
      'creating',
      'starting',
      'running',
      'sleeping',
      'stopping',
      'stopped',
      'failed',
      'destroyed',
    ].includes(value)
  );
}
