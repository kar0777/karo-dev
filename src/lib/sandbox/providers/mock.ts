import { redactText } from '@/lib/crypto/secrets';
import { normalizeWorkspacePath, WORKSPACE_ROOT } from '@/lib/agent/policy';
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

/**
 * The simulated sandbox.
 *
 * Demo mode has to be *usable*, not a screenshot — so this implements a real
 * in-memory filesystem and a small POSIX-ish shell interpreter. The terminal
 * responds to the commands people actually type first (`ls`, `cd`, `cat`,
 * `mkdir`, `git status`, `npm run dev`), streams output at a believable
 * cadence, and reports plausible metrics.
 *
 * It is also the safety backstop: if a provider is misconfigured in production
 * the resolver falls back here rather than executing anything on the host.
 * Nothing in this file touches the real filesystem, network or process table.
 */

type MockFile = { content: string; isDirectory: boolean; modifiedAt: Date; mode: number };

type MockInstance = {
  id: string;
  externalId: string;
  status: SandboxRuntimeStatus;
  createdAt: Date;
  startedAt: Date | null;
  cpuCores: number;
  memoryMb: number;
  diskGb: number;
  env: Record<string, string>;
  files: Map<string, MockFile>;
  cwd: string;
  history: string[];
  processes: Set<string>;
};

const instances = new Map<string, MockInstance>();

const DEFAULT_TREE: Record<string, string> = {
  'README.md':
    '# Workspace\n\nThis sandbox is simulated. Karo runs it entirely in memory so you can explore\nthe product without provisioning a real machine.\n\nConnect a sandbox provider (Docker, Daytona, or your own server) to run real\ncommands.\n',
  'package.json': JSON.stringify(
    {
      name: 'workspace',
      private: true,
      version: '0.1.0',
      scripts: { dev: 'next dev', build: 'next build', test: 'vitest run' },
    },
    null,
    2,
  ),
  '.gitignore': 'node_modules\n.next\n.env\n',
};

export class MockSandboxProvider implements SandboxProvider {
  readonly key = 'mock' as const;
  readonly displayName = 'Karo Demo Sandbox';
  readonly computeMultiplier = 1;
  /** Simulated compute is free; metering still runs so the UI is populated. */
  readonly upstreamMicroUsdPerBaseHour = 0;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    const files = new Map<string, MockFile>();
    const now = new Date();

    files.set('', { content: '', isDirectory: true, modifiedAt: now, mode: 0o755 });
    for (const [path, content] of Object.entries(DEFAULT_TREE)) {
      files.set(path, { content, isDirectory: false, modifiedAt: now, mode: 0o644 });
    }
    for (const file of options.initialFiles ?? []) {
      writeInto(files, file.path, decodeInput(file), now);
    }

    const instance: MockInstance = {
      id: options.sandboxId,
      externalId: `mock-${options.sandboxId.slice(-12)}`,
      status: 'running',
      createdAt: now,
      startedAt: now,
      cpuCores: options.cpuCores,
      memoryMb: options.memoryMb,
      diskGb: options.diskGb,
      env: { ...options.env, HOME: '/home/karo', PWD: WORKSPACE_ROOT, USER: 'karo' },
      files,
      cwd: WORKSPACE_ROOT,
      history: [],
      processes: new Set(),
    };

    instances.set(options.sandboxId, instance);

    return {
      id: options.sandboxId,
      externalId: instance.externalId,
      provider: 'mock',
      status: 'running',
      workspacePath: WORKSPACE_ROOT,
      createdAt: now,
      exposedPorts: { 3000: `https://preview.karo.local/${instance.externalId}` },
      metadata: { simulated: true },
    };
  }

  async startSandbox(id: string): Promise<void> {
    const instance = this.require(id);
    instance.status = 'running';
    instance.startedAt ??= new Date();
  }

  async stopSandbox(id: string): Promise<void> {
    const instance = this.require(id);
    instance.status = 'stopped';
    instance.processes.clear();
  }

  async destroySandbox(id: string): Promise<void> {
    instances.delete(id);
  }

  async getStatus(id: string): Promise<SandboxRuntimeStatus> {
    return instances.get(id)?.status ?? 'destroyed';
  }

  async execute(id: string, command: ExecuteCommand): Promise<ExecutionResult> {
    const instance = this.require(id);
    if (instance.status !== 'running') {
      throw new SandboxError('not_running', 'The sandbox is not running.', { status: 409 });
    }

    const started = Date.now();
    const result = runShell(instance, command.command, command.cwd);
    // Simulate work proportional to the command, capped so tests stay fast.
    await delay(Math.min(220, 40 + command.command.length * 2));

    return {
      stdout: redactText(result.stdout),
      stderr: redactText(result.stderr),
      exitCode: result.exitCode,
      durationMs: Date.now() - started,
      timedOut: false,
      truncated: false,
    };
  }

  async *streamTerminal(
    id: string,
    options: TerminalStreamOptions,
  ): AsyncIterable<TerminalChunk> {
    const instance = instances.get(id);
    if (!instance) {
      yield { type: 'error', message: 'Sandbox not found.' };
      return;
    }

    yield { type: 'status', status: instance.status, message: 'Attached to simulated shell.' };
    yield {
      type: 'stdout',
      data:
        `\x1b[38;5;79m Karo demo sandbox \x1b[0m ${instance.cpuCores} vCPU · ${instance.memoryMb} MB\r\n` +
        `\x1b[2mCommands run against an in-memory filesystem. Type 'help' for what works.\x1b[0m\r\n\r\n`,
    };
    yield { type: 'stdout', data: prompt(instance) };

    // Keep the stream open until the client aborts; input arrives via
    // `writeTerminal`, which pushes into this session's queue.
    const queue = queueFor(id, options.sessionId);
    try {
      while (!options.signal?.aborted) {
        const chunk = await queue.next();
        if (chunk === null) break;
        yield chunk;
      }
    } finally {
      releaseQueue(id, options.sessionId);
    }
  }

  async writeTerminal(id: string, sessionId: string, data: string): Promise<void> {
    const instance = this.require(id);
    const queue = queueFor(id, sessionId);

    for (const line of data.split(/\r?\n/)) {
      const command = line.trim();
      if (!command) continue;

      queue.push({ type: 'stdout', data: `${command}\r\n` });

      if (command === 'clear') {
        queue.push({ type: 'stdout', data: '\x1b[2J\x1b[H' });
        queue.push({ type: 'stdout', data: prompt(instance) });
        continue;
      }
      if (command === 'exit') {
        queue.push({ type: 'stdout', data: 'logout\r\n' });
        queue.push({ type: 'exit', exitCode: 0 });
        queue.close();
        return;
      }

      instance.history.push(command);
      const result = runShell(instance, command);
      if (result.stdout) {
        queue.push({ type: 'stdout', data: toCrlf(redactText(result.stdout)) });
      }
      if (result.stderr) {
        queue.push({ type: 'stderr', data: toCrlf(redactText(result.stderr)) });
      }
      queue.push({ type: 'stdout', data: prompt(instance) });
    }
  }

  async resizeTerminal(): Promise<void> {
    // The simulated shell does not reflow; accepted for interface parity.
  }

  async killTerminal(id: string, sessionId: string): Promise<void> {
    const queue = queueFor(id, sessionId);
    queue.push({ type: 'stdout', data: '\r\n\x1b[33m^C\x1b[0m\r\n' });
    const instance = instances.get(id);
    if (instance) {
      instance.processes.clear();
      queue.push({ type: 'stdout', data: prompt(instance) });
    }
  }

  async uploadFiles(id: string, files: FileInput[]): Promise<void> {
    const instance = this.require(id);
    const now = new Date();
    for (const file of files) {
      writeInto(instance.files, file.path, decodeInput(file), now);
    }
  }

  async downloadFile(id: string, path: string): Promise<Buffer> {
    const instance = this.require(id);
    const key = safeKey(path);
    const file = instance.files.get(key);
    if (!file || file.isDirectory) {
      throw new SandboxError('not_found', `No such file: ${path}`, { status: 404 });
    }
    return Buffer.from(file.content, 'utf8');
  }

  async listFiles(id: string, path: string): Promise<FileEntry[]> {
    const instance = this.require(id);
    const prefix = path === '.' || path === '' || path === WORKSPACE_ROOT ? '' : safeKey(path);
    const seen = new Map<string, FileEntry>();

    for (const [key, file] of instance.files) {
      if (key === '') continue;
      if (prefix && !key.startsWith(`${prefix}/`)) continue;
      const relative = prefix ? key.slice(prefix.length + 1) : key;
      const [head, ...rest] = relative.split('/');
      if (!head) continue;

      const fullPath = prefix ? `${prefix}/${head}` : head;
      if (seen.has(fullPath)) continue;

      seen.set(fullPath, {
        path: fullPath,
        name: head,
        isDirectory: rest.length > 0 || file.isDirectory,
        sizeBytes: rest.length > 0 ? 0 : Buffer.byteLength(file.content),
        modifiedAt: file.modifiedAt,
      });
    }

    return [...seen.values()].sort(
      (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
    );
  }

  async deleteFile(id: string, path: string): Promise<void> {
    const instance = this.require(id);
    const key = safeKey(path);
    for (const existing of [...instance.files.keys()]) {
      if (existing === key || existing.startsWith(`${key}/`)) instance.files.delete(existing);
    }
  }

  async getMetrics(id: string): Promise<SandboxMetrics> {
    const instance = this.require(id);
    const uptimeSeconds = instance.startedAt
      ? Math.floor((Date.now() - instance.startedAt.getTime()) / 1000)
      : 0;

    const diskUsedMb =
      [...instance.files.values()].reduce((sum, f) => sum + Buffer.byteLength(f.content), 0) /
      (1024 * 1024);

    // A slow sine wave reads as "a machine doing something" without looking random.
    const phase = (Date.now() / 9000) % (Math.PI * 2);
    const cpuPercent =
      instance.status === 'running' ? Math.max(0.4, 6 + Math.sin(phase) * 5) : 0;
    const memoryUsedMb =
      instance.status === 'running'
        ? Math.round(instance.memoryMb * (0.28 + Math.sin(phase / 2) * 0.06))
        : 0;

    return {
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryUsedMb,
      memoryLimitMb: instance.memoryMb,
      diskUsedMb: Math.max(1, Math.round(diskUsedMb * 100) / 100),
      diskLimitMb: instance.diskGb * 1024,
      processCount: instance.status === 'running' ? 3 + instance.processes.size : 0,
      uptimeSeconds,
      networkRxBytes: 0,
      networkTxBytes: 0,
    };
  }

  private require(id: string): MockInstance {
    const instance = instances.get(id);
    if (!instance) {
      throw new SandboxError('not_found', 'This sandbox no longer exists.', { status: 404 });
    }
    return instance;
  }
}

/* ------------------------------------------------------------------ *
 *  Simulated shell
 * ------------------------------------------------------------------ */

type ShellResult = { stdout: string; stderr: string; exitCode: number };

function runShell(instance: MockInstance, input: string, cwdOverride?: string): ShellResult {
  const previousCwd = instance.cwd;
  if (cwdOverride) instance.cwd = cwdOverride;
  try {
    // Handle `a && b` and `a; b` chains, stopping at the first failure for `&&`.
    const segments = input.split(/\s*(&&|;)\s*/);
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    for (let i = 0; i < segments.length; i += 2) {
      const segment = segments[i]?.trim();
      if (!segment) continue;
      const separator = segments[i - 1];
      if (separator === '&&' && exitCode !== 0) break;

      const result = runSingle(instance, segment);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
    }
    return { stdout, stderr, exitCode };
  } finally {
    if (cwdOverride) instance.cwd = previousCwd;
  }
}

function runSingle(instance: MockInstance, input: string): ShellResult {
  const tokens = tokenizeCommand(input);
  const [cmd, ...args] = tokens;
  if (!cmd) return { stdout: '', stderr: '', exitCode: 0 };

  const cwdRel = relativeCwd(instance);
  const resolve = (p: string) => safeKey(p.startsWith('/') ? p : joinPath(cwdRel, p));

  switch (cmd) {
    case 'help':
      return out(
        [
          'Simulated shell — supported commands:',
          '  ls [path]        cat <file>       pwd            cd <path>',
          '  mkdir [-p] <d>   touch <file>     rm [-r] <p>    mv <a> <b>',
          '  echo <text>      env              whoami         date',
          '  head/tail <f>    wc <file>        grep <p> <f>   find <path>',
          '  git <status|log|diff|add|commit|branch>',
          '  npm/pnpm/node/python/pip  (simulated output)',
          '  history          clear            exit',
          '',
          'This machine is not real. Connect a sandbox provider for real execution.',
        ].join('\n'),
      );

    case 'pwd':
      return out(instance.cwd);

    case 'whoami':
      return out('karo');

    case 'date':
      return out(new Date().toUTCString());

    case 'history':
      return out(
        instance.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'),
      );

    case 'env':
      return out(
        Object.entries(instance.env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      );

    case 'echo': {
      const text = args
        .join(' ')
        .replace(/^["']|["']$/g, '')
        .replace(/\$(\w+)/g, (_m, name: string) => instance.env[name] ?? '');
      return out(text);
    }

    case 'cd': {
      const target = args[0] ?? '';
      if (!target || target === '~' || target === WORKSPACE_ROOT) {
        instance.cwd = WORKSPACE_ROOT;
        return out('');
      }
      const normalized = resolveLoose(cwdRel, target);
      if (normalized === null) {
        return fail(`cd: ${target}: Permission denied (outside workspace)`);
      }
      if (normalized !== '' && !hasDirectory(instance, normalized)) {
        return fail(`cd: ${target}: No such file or directory`);
      }
      instance.cwd = normalized ? `${WORKSPACE_ROOT}/${normalized}` : WORKSPACE_ROOT;
      instance.env.PWD = instance.cwd;
      return out('');
    }

    case 'ls': {
      const flags = args.filter((a) => a.startsWith('-'));
      const target = args.find((a) => !a.startsWith('-')) ?? '.';
      const prefix = target === '.' ? cwdRel : resolveLoose(cwdRel, target);
      if (prefix === null) return fail(`ls: ${target}: Permission denied`);

      const entries = listDirect(instance, prefix);
      if (entries.length === 0 && prefix !== '' && !hasDirectory(instance, prefix)) {
        return fail(`ls: cannot access '${target}': No such file or directory`);
      }
      if (flags.some((f) => f.includes('l'))) {
        return out(
          entries
            .map((e) => {
              const size = String(e.sizeBytes).padStart(7);
              const kind = e.isDirectory ? 'drwxr-xr-x' : '-rw-r--r--';
              return `${kind} 1 karo karo ${size} ${e.modifiedAt.toISOString().slice(0, 16).replace('T', ' ')} ${e.name}`;
            })
            .join('\n'),
        );
      }
      return out(entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name)).join('  '));
    }

    case 'cat': {
      if (!args[0]) return fail('cat: missing operand');
      const key = resolve(args[0]);
      const file = instance.files.get(key);
      if (!file) return fail(`cat: ${args[0]}: No such file or directory`);
      if (file.isDirectory) return fail(`cat: ${args[0]}: Is a directory`);
      return out(file.content);
    }

    case 'head':
    case 'tail': {
      const nFlag = args.findIndex((a) => a === '-n');
      const count = nFlag >= 0 ? Number.parseInt(args[nFlag + 1] ?? '10', 10) : 10;
      const target = args.filter((a) => !a.startsWith('-') && !/^\d+$/.test(a)).pop();
      if (!target) return fail(`${cmd}: missing operand`);
      const file = instance.files.get(resolve(target));
      if (!file) return fail(`${cmd}: ${target}: No such file or directory`);
      const lines = file.content.split('\n');
      return out((cmd === 'head' ? lines.slice(0, count) : lines.slice(-count)).join('\n'));
    }

    case 'wc': {
      const target = args.filter((a) => !a.startsWith('-')).pop();
      if (!target) return fail('wc: missing operand');
      const file = instance.files.get(resolve(target));
      if (!file) return fail(`wc: ${target}: No such file or directory`);
      const lines = file.content.split('\n').length;
      const words = file.content.split(/\s+/).filter(Boolean).length;
      return out(`${lines} ${words} ${Buffer.byteLength(file.content)} ${target}`);
    }

    case 'grep': {
      const pattern = args.find((a) => !a.startsWith('-'));
      const target = args.filter((a) => !a.startsWith('-')).slice(1);
      if (!pattern) return fail('grep: missing pattern');
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'i');
      } catch {
        return fail(`grep: invalid pattern: ${pattern}`);
      }
      const searchKeys = target.length
        ? target.map((t) => resolve(t))
        : [...instance.files.keys()].filter((k) => !instance.files.get(k)?.isDirectory);

      const hits: string[] = [];
      for (const key of searchKeys) {
        const file = instance.files.get(key);
        if (!file || file.isDirectory) continue;
        file.content.split('\n').forEach((line, i) => {
          if (regex.test(line)) hits.push(`${key}:${i + 1}:${line.trim()}`);
        });
      }
      return hits.length ? out(hits.join('\n')) : { stdout: '', stderr: '', exitCode: 1 };
    }

    case 'find': {
      const base = args.find((a) => !a.startsWith('-')) ?? '.';
      const prefix = base === '.' ? cwdRel : resolveLoose(cwdRel, base);
      if (prefix === null) return fail(`find: ${base}: Permission denied`);
      const matches = [...instance.files.keys()]
        .filter((k) => k !== '' && (prefix === '' || k.startsWith(prefix)))
        .sort();
      return out(matches.map((m) => `./${m}`).join('\n'));
    }

    case 'mkdir': {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target) return fail('mkdir: missing operand');
      const key = resolve(target);
      instance.files.set(key, {
        content: '',
        isDirectory: true,
        modifiedAt: new Date(),
        mode: 0o755,
      });
      return out('');
    }

    case 'touch': {
      if (!args[0]) return fail('touch: missing operand');
      const key = resolve(args[0]);
      const existing = instance.files.get(key);
      instance.files.set(key, {
        content: existing?.content ?? '',
        isDirectory: false,
        modifiedAt: new Date(),
        mode: 0o644,
      });
      return out('');
    }

    case 'rm': {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target) return fail('rm: missing operand');
      const recursive = args.some((a) => /^-[a-zA-Z]*r/i.test(a));
      const key = resolve(target);
      const file = instance.files.get(key);
      const hasChildren = [...instance.files.keys()].some((k) => k.startsWith(`${key}/`));
      if (!file && !hasChildren) return fail(`rm: cannot remove '${target}': No such file`);
      if (hasChildren && !recursive) {
        return fail(`rm: cannot remove '${target}': Is a directory`);
      }
      for (const existing of [...instance.files.keys()]) {
        if (existing === key || existing.startsWith(`${key}/`)) instance.files.delete(existing);
      }
      return out('');
    }

    case 'mv':
    case 'cp': {
      const [from, to] = args.filter((a) => !a.startsWith('-'));
      if (!from || !to) return fail(`${cmd}: missing file operand`);
      const fromKey = resolve(from);
      const toKey = resolve(to);
      const file = instance.files.get(fromKey);
      if (!file) return fail(`${cmd}: cannot stat '${from}': No such file or directory`);
      instance.files.set(toKey, { ...file, modifiedAt: new Date() });
      if (cmd === 'mv') instance.files.delete(fromKey);
      return out('');
    }

    case 'git':
      return simulateGit(instance, args);

    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun':
      return simulatePackageManager(cmd, args);

    case 'node':
      return out(args.length ? `[simulated] executed ${args[0]}` : 'v22.14.0');

    case 'python':
    case 'python3':
      return out(args.length ? `[simulated] executed ${args.join(' ')}` : 'Python 3.12.7');

    case 'pip':
    case 'pip3':
      return out(
        args[0] === 'install'
          ? `Collecting ${args.slice(1).join(' ')}\nSuccessfully installed ${args.slice(1).join(' ')} [simulated]`
          : 'pip 24.2',
      );

    case 'curl':
    case 'wget':
      return fail(
        `${cmd}: network access is disabled in the demo sandbox. Connect a real sandbox provider to reach the internet.`,
      );

    case 'docker':
      return fail(
        'docker: not available in the demo sandbox. Install the Docker plugin on a Pro plan to use rootless containers.',
      );

    case 'sudo':
      return fail('sudo: this incident will not be reported — the demo sandbox has no root.');

    default:
      return fail(`${cmd}: command not found`);
  }
}

function simulateGit(instance: MockInstance, args: string[]): ShellResult {
  const sub = args[0];
  switch (sub) {
    case undefined:
    case 'status':
      return out(
        [
          'On branch main',
          "Your branch is up to date with 'origin/main'.",
          '',
          'Changes not staged for commit:',
          '  (use "git add <file>..." to update what will be committed)',
          '\tmodified:   README.md',
          '',
          'no changes added to commit (use "git add" and/or "git commit -a")',
        ].join('\n'),
      );
    case 'log':
      return out(
        [
          'commit 7f3c1a9e4b2d8c5f1a0e6d3b9c8a7f5e2d1c0b9a',
          'Author: Karo Agent <agent@karo.dev>',
          `Date:   ${new Date(Date.now() - 3_600_000).toUTCString()}`,
          '',
          '    Scaffold project structure',
          '',
          'commit 2b8d4f6a1c9e3705d8f2a6b4c1e9d7f3a5b2c8e0',
          'Author: Karo Agent <agent@karo.dev>',
          `Date:   ${new Date(Date.now() - 86_400_000).toUTCString()}`,
          '',
          '    Initial commit',
        ].join('\n'),
      );
    case 'branch':
      return out('* main\n  develop');
    case 'diff':
      return out(
        [
          'diff --git a/README.md b/README.md',
          'index 3f8a1c2..9d4e7b1 100644',
          '--- a/README.md',
          '+++ b/README.md',
          '@@ -1,3 +1,4 @@',
          ' # Workspace',
          ' ',
          '+Updated by the Karo agent.',
        ].join('\n'),
      );
    case 'add':
      return out('');
    case 'commit': {
      const messageIndex = args.indexOf('-m');
      const message = messageIndex >= 0 ? (args[messageIndex + 1] ?? 'update') : 'update';
      instance.history.push(`git commit -m ${message}`);
      return out(
        `[main ${randomSha()}] ${message.replace(/^["']|["']$/g, '')}\n 1 file changed`,
      );
    }
    case 'push':
      return fail('git: pushing is disabled in the demo sandbox.');
    default:
      return out(`git ${sub}: [simulated]`);
  }
}

function simulatePackageManager(cmd: string, args: string[]): ShellResult {
  const sub = args[0];
  if (sub === 'install' || sub === 'i' || sub === 'add' || sub === 'ci') {
    const packages = args.slice(1).filter((a) => !a.startsWith('-'));
    return out(
      [
        packages.length
          ? `added ${packages.length} package${packages.length === 1 ? '' : 's'} in 2s`
          : 'up to date, audited 412 packages in 1s',
        '',
        'found 0 vulnerabilities',
        '[simulated]',
      ].join('\n'),
    );
  }
  if (sub === 'run' || sub === 'test' || sub === 'exec' || sub === 'x') {
    const script = sub === 'test' ? 'test' : (args[1] ?? '');
    if (script === 'build') {
      return out(
        [
          `> ${cmd} run build`,
          '',
          '   ▲ Next.js 16.2.12',
          '',
          '   Creating an optimized production build ...',
          ' ✓ Compiled successfully in 4.1s',
          ' ✓ Generating static pages (4/4)',
          '',
          'Route (app)                    Size  First Load JS',
          '┌ ○ /                        1.8 kB         96 kB',
          '└ ○ /_not-found                142 B         88 kB',
          '',
          '[simulated build]',
        ].join('\n'),
      );
    }
    if (script === 'test') {
      return out(
        [
          ' RUN  v4.1.10',
          '',
          ' ✓ tests/example.test.ts (3 tests) 12ms',
          '',
          ' Test Files  1 passed (1)',
          '      Tests  3 passed (3)',
          '   Duration  412ms',
          '',
          '[simulated]',
        ].join('\n'),
      );
    }
    if (script === 'dev') {
      return out(
        [
          `> ${cmd} run dev`,
          '',
          '   ▲ Next.js 16.2.12',
          '   - Local:   http://localhost:3000',
          '',
          ' ✓ Ready in 1.2s',
          '',
          'Dev server is running. Open the Preview tab. [simulated]',
        ].join('\n'),
      );
    }
    return out(`> ${cmd} run ${script}\n\n[simulated] script completed`);
  }
  return out(`${cmd} ${args.join(' ')}: [simulated]`);
}

/* ------------------------------------------------------------------ *
 *  Terminal input queues
 * ------------------------------------------------------------------ */

type Queue = {
  push(chunk: TerminalChunk): void;
  next(): Promise<TerminalChunk | null>;
  close(): void;
};

const queues = new Map<string, Queue>();

function queueFor(sandboxId: string, sessionId: string): Queue {
  const key = `${sandboxId}:${sessionId}`;
  let queue = queues.get(key);
  if (queue) return queue;

  const buffer: TerminalChunk[] = [];
  let resolver: ((chunk: TerminalChunk | null) => void) | null = null;
  let closed = false;

  queue = {
    push(chunk) {
      if (closed) return;
      if (resolver) {
        const r = resolver;
        resolver = null;
        r(chunk);
      } else {
        buffer.push(chunk);
      }
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

function releaseQueue(sandboxId: string, sessionId: string) {
  const key = `${sandboxId}:${sessionId}`;
  queues.get(key)?.close();
  queues.delete(key);
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

function out(stdout: string): ShellResult {
  return { stdout: stdout ? `${stdout}\n` : '', stderr: '', exitCode: 0 };
}

function fail(stderr: string, exitCode = 1): ShellResult {
  return { stdout: '', stderr: `${stderr}\n`, exitCode };
}

function prompt(instance: MockInstance): string {
  const short = instance.cwd.replace(WORKSPACE_ROOT, '~');
  return `\x1b[38;5;79mkaro\x1b[0m:\x1b[38;5;180m${short}\x1b[0m$ `;
}

function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

function relativeCwd(instance: MockInstance): string {
  if (instance.cwd === WORKSPACE_ROOT) return '';
  return instance.cwd.slice(WORKSPACE_ROOT.length + 1);
}

function joinPath(base: string, segment: string): string {
  if (!base) return segment;
  return `${base}/${segment}`;
}

/** Throws on traversal — used where a bad path is a hard error. */
function safeKey(path: string): string {
  return normalizeWorkspacePath(path);
}

/** Returns null on traversal, '' for the workspace root. */
function safeKeyLoose(path: string): string | null {
  const trimmed = path.replace(/^\/+/, '');
  if (trimmed === '' || path === WORKSPACE_ROOT) return '';
  try {
    return normalizeWorkspacePath(path);
  } catch {
    return null;
  }
}

function resolveLoose(cwd: string, target: string): string | null {
  if (target.startsWith('/')) return safeKeyLoose(target);
  return safeKeyLoose(joinPath(cwd, target));
}

function hasDirectory(instance: MockInstance, key: string): boolean {
  if (key === '') return true;
  const entry = instance.files.get(key);
  if (entry?.isDirectory) return true;
  return [...instance.files.keys()].some((k) => k.startsWith(`${key}/`));
}

function listDirect(instance: MockInstance, prefix: string): FileEntry[] {
  const seen = new Map<string, FileEntry>();
  for (const [key, file] of instance.files) {
    if (key === '') continue;
    if (prefix && !key.startsWith(`${prefix}/`)) continue;
    const relative = prefix ? key.slice(prefix.length + 1) : key;
    const [head, ...rest] = relative.split('/');
    if (!head || seen.has(head)) continue;
    seen.set(head, {
      path: prefix ? `${prefix}/${head}` : head,
      name: head,
      isDirectory: rest.length > 0 || file.isDirectory,
      sizeBytes: rest.length > 0 ? 0 : Buffer.byteLength(file.content),
      modifiedAt: file.modifiedAt,
    });
  }
  return [...seen.values()].sort(
    (a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name),
  );
}

function writeInto(
  files: Map<string, MockFile>,
  path: string,
  content: string,
  now: Date,
): void {
  const key = normalizeWorkspacePath(path);
  const segments = key.split('/');
  for (let i = 1; i < segments.length; i += 1) {
    const dir = segments.slice(0, i).join('/');
    if (!files.has(dir)) {
      files.set(dir, { content: '', isDirectory: true, modifiedAt: now, mode: 0o755 });
    }
  }
  files.set(key, { content, isDirectory: false, modifiedAt: now, mode: 0o644 });
}

function decodeInput(file: FileInput): string {
  return file.encoding === 'base64'
    ? Buffer.from(file.content, 'base64').toString('utf8')
    : file.content;
}

function tokenizeCommand(input: string): string[] {
  return input.match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t) ?? [];
}

function randomSha(): string {
  return Array.from(
    { length: 7 },
    () => '0123456789abcdef'[Math.floor(Math.random() * 16)],
  ).join('');
}

function delay(ms: number): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.KARO_MOCK_INSTANT === '1') {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Test helper — clears all simulated instances. */
export function __resetMockSandboxes(): void {
  instances.clear();
  queues.clear();
}
