import type { ShellKind } from '@/lib/db/schema';

/**
 * The sandbox abstraction.
 *
 * Every way of getting a computer — a managed Karo Cloud container, a Daytona
 * workspace, the user's own VPS reached through an outbound worker, or the
 * in-process simulator used in demo mode — implements this one interface.
 * Nothing above this layer knows which one it is talking to.
 */

export type SandboxProviderKey =
  'mock' | 'local-docker' | 'daytona' | 'remote-docker' | 'external';

export type CreateSandboxOptions = {
  /** Karo's own sandbox row id; providers use it for tagging/labels. */
  sandboxId: string;
  teamId: string;
  projectId?: string | null;
  name: string;
  image: string;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  /** Maximum wall-clock seconds any single command may run. */
  executionTimeoutSeconds: number;
  maxProcesses: number;
  /** `none` blocks all egress; `restricted` allows an allow-listed set. */
  networkPolicy: 'none' | 'restricted' | 'open';
  allowDocker: boolean;
  env?: Record<string, string>;
  /** Files seeded into /workspace at creation (template scaffolding). */
  initialFiles?: FileInput[];
  labels?: Record<string, string>;
  /** For `remote-docker`: which registered BYOS worker to run on. */
  workerId?: string | null;
  region?: string | null;
};

export type Sandbox = {
  id: string;
  externalId: string;
  provider: SandboxProviderKey;
  status: SandboxRuntimeStatus;
  workspacePath: string;
  createdAt: Date;
  /** Ports the provider has exposed for preview, keyed by container port. */
  exposedPorts?: Record<number, string>;
  metadata?: Record<string, unknown>;
};

export type SandboxRuntimeStatus =
  | 'creating'
  | 'starting'
  | 'running'
  | 'sleeping'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'destroyed';

export type ExecuteCommand = {
  command: string;
  shell?: ShellKind;
  cwd?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
  /** Sent to the process stdin before it is closed. */
  stdin?: string;
};

export type ExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
};

export type TerminalChunk =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'status'; status: SandboxRuntimeStatus; message?: string }
  | { type: 'error'; message: string };

export type FileInput = {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  mode?: number;
};

export type FileEntry = {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: Date;
};

export type SandboxMetrics = {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
  diskUsedMb: number;
  diskLimitMb: number;
  processCount: number;
  uptimeSeconds: number;
  /** Provider-reported network counters, when available. */
  networkRxBytes?: number;
  networkTxBytes?: number;
};

export type TerminalStreamOptions = {
  sessionId: string;
  shell: ShellKind;
  cols: number;
  rows: number;
  cwd?: string;
  signal?: AbortSignal;
};

/**
 * The provider contract. Implementations live in `src/lib/sandbox/providers/`.
 *
 * Implementations MUST:
 *  · never run anything on the Karo web host;
 *  · never mount the host Docker socket;
 *  · enforce CPU / memory / disk / process / time limits;
 *  · block cloud metadata endpoints;
 *  · confine all file operations to the workspace root.
 */
export interface SandboxProvider {
  readonly key: SandboxProviderKey;
  readonly displayName: string;
  /** Compute cost multiplier applied on top of the CPU × RAM factor. */
  readonly computeMultiplier: number;
  /** What Karo pays this provider per base compute hour, in micro-USD. */
  readonly upstreamMicroUsdPerBaseHour: number;

  isAvailable(): Promise<boolean>;

  createSandbox(options: CreateSandboxOptions): Promise<Sandbox>;
  startSandbox(id: string): Promise<void>;
  stopSandbox(id: string): Promise<void>;
  destroySandbox(id: string): Promise<void>;

  execute(id: string, command: ExecuteCommand): Promise<ExecutionResult>;
  streamTerminal(id: string, options: TerminalStreamOptions): AsyncIterable<TerminalChunk>;
  /** Feeds keystrokes into a live terminal opened by `streamTerminal`. */
  writeTerminal(id: string, sessionId: string, data: string): Promise<void>;
  resizeTerminal(id: string, sessionId: string, cols: number, rows: number): Promise<void>;
  killTerminal(id: string, sessionId: string): Promise<void>;

  uploadFiles(id: string, files: FileInput[]): Promise<void>;
  downloadFile(id: string, path: string): Promise<Buffer>;
  listFiles(id: string, path: string): Promise<FileEntry[]>;
  deleteFile(id: string, path: string): Promise<void>;

  getMetrics(id: string): Promise<SandboxMetrics>;
  getStatus(id: string): Promise<SandboxRuntimeStatus>;
}

/** Raised when a provider cannot satisfy a request; carries UI-ready copy. */
export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    code: SandboxErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SandboxError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 502;
  }
}

export type SandboxErrorCode =
  | 'provider_unavailable'
  | 'not_found'
  | 'not_running'
  | 'quota_exceeded'
  | 'timeout'
  | 'command_denied'
  | 'path_denied'
  | 'worker_offline'
  | 'internal';

export const SANDBOX_ERROR_COPY: Record<
  SandboxErrorCode,
  { title: string; description: string; action?: string }
> = {
  provider_unavailable: {
    title: 'Sandbox provider unavailable',
    description:
      'Karo could not reach the machine provider. Your work is saved; try again in a moment.',
    action: 'Retry',
  },
  not_found: {
    title: 'Sandbox not found',
    description: 'This sandbox no longer exists. Create a new one to keep working.',
    action: 'Create sandbox',
  },
  not_running: {
    title: 'Sandbox is not running',
    description: 'Start the sandbox to run commands in it.',
    action: 'Start sandbox',
  },
  quota_exceeded: {
    title: 'Sandbox limit reached',
    description:
      'Your plan allows a limited number of active sandboxes. Stop one, or upgrade for more.',
    action: 'Manage sandboxes',
  },
  timeout: {
    title: 'Command timed out',
    description: 'The command exceeded the execution time limit for your plan and was stopped.',
  },
  command_denied: {
    title: 'Command blocked',
    description: 'This command is not permitted inside a Karo sandbox.',
  },
  path_denied: {
    title: 'Path outside the workspace',
    description: 'The agent may only read and write inside /workspace.',
  },
  worker_offline: {
    title: 'Your server is offline',
    description:
      'The Karo worker on your machine is not connected. Check that the karo-worker service is running.',
    action: 'View servers',
  },
  internal: {
    title: 'Sandbox error',
    description: 'Something went wrong inside the sandbox runtime. The team has been notified.',
    action: 'Retry',
  },
};
