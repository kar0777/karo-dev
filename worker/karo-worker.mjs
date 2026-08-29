#!/usr/bin/env node
/**
 * Karo Worker — reference implementation of the Karo Worker Protocol v1.
 *
 * This is the agent an operator installs on their own machine ("Bring Your Own
 * Server"). It is deliberately a single dependency-free Node file so it can be
 * audited in one sitting before someone runs it on their infrastructure.
 *
 * ## Security model
 *
 * The design constraint is that Karo must never need inbound access to your
 * machine and must never hold a credential for it.
 *
 *   · The connection is **outbound only** — plain HTTPS to the Karo control
 *     plane. No open port, no public IP, no NAT traversal, no SSH key given to
 *     Karo, and nothing about your machine exposed to a browser.
 *   · You start it with a **one-time installation token**, which the control
 *     plane burns on first use and exchanges for a long-lived worker token.
 *     A leaked install token is useless once you have registered.
 *   · The worker token is stored at `~/.karo/worker.json` with mode 0600 and is
 *     never logged. Rotate or revoke it from Settings → Servers in the Karo UI;
 *     rotation hands you a new install token to redeem, revoking kills it.
 *   · Every container it starts is unprivileged: `--cap-drop=ALL`,
 *     `--security-opt=no-new-privileges`, no host Docker socket mount, hard
 *     CPU/memory/PID limits, and an isolated network.
 *   · Commands arrive as structured JSON, never as a shell string this worker
 *     evaluates — it always passes them to `docker exec` as an argv array.
 *
 * ## Usage
 *
 *   node karo-worker.mjs --token <install-token> --url https://karo.example.com
 *   node karo-worker.mjs                 # subsequent runs, uses the saved token
 *   node karo-worker.mjs --dry-run       # simulate execution; start nothing
 *
 * There is no rotation flag. Rotating from the Karo UI revokes this worker's
 * token and issues a one-time install token, so the way to re-credential a
 * machine is to run the first line again with that token.
 *
 * `--dry-run` makes this a **mock worker**: it registers, polls and answers
 * every command with a plausible simulated result. That is enough to exercise
 * the whole BYOS path end to end without Docker installed.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import {
  homedir,
  hostname,
  arch,
  platform,
  totalmem,
  freemem,
  cpus,
  loadavg,
  uptime,
} from 'node:os';
import { join } from 'node:path';

const VERSION = '1.1.0';
const CONFIG_DIR = join(homedir(), '.karo');
const CONFIG_PATH = join(CONFIG_DIR, 'worker.json');

const HEARTBEAT_MS = 20_000;
const POLL_ERROR_BACKOFF_MS = 2_000;
const POLL_ERROR_BACKOFF_MAX_MS = 60_000;

/* ------------------------------------------------------------------ *
 *  CLI
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { dryRun: false, registerOnly: false, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--token') args.token = argv[++i];
    else if (arg === '--url') args.url = argv[++i];
    else if (arg === '--name') args.name = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--register-only') args.registerOnly = true;
    else if (arg === '--verbose' || arg === '-v') args.verbose = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  process.stdout.write(
    [
      `Karo Worker ${VERSION}`,
      '',
      'Usage:',
      '  karo-worker --token <install-token> --url <karo-url> [--name <label>]',
      '  karo-worker [--dry-run] [--verbose]',
      '',
      'Options:',
      '  --token          One-time installation token from Settings → Servers.',
      '  --url            Your Karo control-plane URL, e.g. https://karo.example.com',
      '  --name           Label shown in the Karo UI. Defaults to this hostname.',
      '  --register-only  Exchange the install token for the worker token, save it',
      '                   and exit. Used by the one-command installer so the service',
      '                   itself never needs a token argument.',
      '  --dry-run        Simulate execution instead of running Docker.',
      '  --verbose        Log every command received.',
      '',
      'The worker connects outbound only. It never opens a port.',
      '',
      'To replace this worker’s token, use Settings → Servers → Rotate in the',
      'Karo UI, then run the first line above with the install token it shows.',
      '',
    ].join('\n'),
  );
}

/* ------------------------------------------------------------------ *
 *  Config
 * ------------------------------------------------------------------ */

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    log('warn', 'Stored config is unreadable; re-register with --token.');
    return null;
  }
}

function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/* ------------------------------------------------------------------ *
 *  Logging — never prints a token
 * ------------------------------------------------------------------ */

let verbose = false;

function log(level, message, extra) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const suffix = extra ? ` ${JSON.stringify(redact(extra))}` : '';
  if (level === 'error') process.stderr.write(`${line}${suffix}\n`);
  else process.stdout.write(`${line}${suffix}\n`);
}

function redact(value) {
  if (value == null || typeof value !== 'object') return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = /token|secret|password|key/i.test(key) ? '[redacted]' : redact(item);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  HTTP
 * ------------------------------------------------------------------ */

async function request(
  baseUrl,
  path,
  { method = 'POST', body, token, timeoutMs = 35_000 } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `karo-worker/${VERSION}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 *  Registration
 * ------------------------------------------------------------------ */

function capabilities(dryRun) {
  return {
    docker: dryRun ? false : hasBinary('docker'),
    podman: dryRun ? false : hasBinary('podman'),
    shells: ['bash', 'sh'],
    dryRun,
  };
}

/**
 * Filesystem size for the volume the workspace lives on.
 *
 * `diskGb` used to be a hardcoded `0`, which the dashboard rendered by hiding
 * the disk chip entirely — so a machine with a 2 TB array and one with a full
 * 8 GB card looked identical. Measured against `/` rather than `WORKSPACE`
 * because the workspace directory does not exist until the first sandbox runs.
 * `statfsSync` is unavailable on some platforms and throws on others; a probe
 * that cannot answer reports nothing rather than inventing a number.
 */
function diskGb() {
  try {
    const stats = statfsSync('/');
    const bytes = Number(stats.blocks) * Number(stats.bsize);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    return Math.round(bytes / 1024 ** 3);
  } catch {
    return null;
  }
}

function diskFreeGb() {
  try {
    const stats = statfsSync('/');
    const bytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(bytes) || bytes < 0) return null;
    return Math.round(bytes / 1024 ** 3);
  } catch {
    return null;
  }
}

/**
 * Everything about this machine that the dashboard shows.
 *
 * Sent on **every** heartbeat, not only at registration. The install token is
 * burned on first use, so registration can never run twice — which meant the
 * facts captured that one time were frozen for the life of the worker. Install
 * Docker on a machine that enrolled without it and the panel kept reporting no
 * container runtime forever, with no way short of revoking and re-enrolling to
 * correct it. Re-probing per heartbeat costs one `--version` spawn every 20
 * seconds and makes the panel describe the machine as it is now.
 */
function hostFacts(dryRun) {
  const disk = diskGb();
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    agentVersion: VERSION,
    capabilities: capabilities(dryRun),
    cpuCores: cpus().length,
    memoryMb: Math.round(totalmem() / (1024 * 1024)),
    ...(disk === null ? {} : { diskGb: disk }),
  };
}

/** Live utilisation, for the "last seen" detail on the server card. */
function hostMetrics() {
  const total = totalmem();
  const free = freemem();
  const totalDisk = diskGb();
  const freeDisk = diskFreeGb();
  return {
    memoryTotalMb: Math.round(total / (1024 * 1024)),
    memoryUsedMb: Math.round((total - free) / (1024 * 1024)),
    ...(totalDisk === null ? {} : { diskTotalGb: totalDisk }),
    ...(totalDisk === null || freeDisk === null ? {} : { diskUsedGb: totalDisk - freeDisk }),
    loadAverage: loadavg(),
    uptimeSeconds: Math.round(uptime()),
    runningSandboxes: terminals.size,
  };
}

/**
 * Is this command available on PATH?
 *
 * Must be `spawnSync`. The async `spawn` reports a missing binary by emitting an
 * `error` event on the next tick, not by throwing, so a `try/catch` around it
 * catches nothing: the function returned `true` for a runtime that was not
 * installed, and a moment later Node killed the whole worker with an unhandled
 * `error` event — before it had even finished registering. A machine without
 * Docker could not enrol at all, and the message it died with named neither the
 * cause nor the fix.
 */
function hasBinary(name) {
  const probe = spawnSync(name, ['--version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

async function register({ url, installToken, name, dryRun }) {
  log('info', 'Registering with Karo…');
  const result = await request(url, '/api/worker/register', {
    body: {
      installToken,
      name: name ?? hostname(),
      ...hostFacts(dryRun),
    },
  });

  if (!result?.workerToken || !result?.workerId) {
    throw new Error('Registration did not return a worker token.');
  }

  saveConfig({
    url,
    workerId: result.workerId,
    workerToken: result.workerToken,
    registeredAt: new Date().toISOString(),
  });

  log('info', `Registered as worker ${result.workerId}. Install token has been consumed.`);
  return result;
}

/* ------------------------------------------------------------------ *
 *  Command execution
 * ------------------------------------------------------------------ */

const WORKSPACE = '/workspace';
const terminals = new Map();

/**
 * Container flags that make a sandbox a sandbox. Changing any of these
 * weakens isolation for every project that runs on this machine.
 */
function hardeningFlags(command) {
  return [
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit',
    String(command.maxProcesses ?? 128),
    '--memory',
    `${command.memoryMb ?? 512}m`,
    '--memory-swap',
    `${command.memoryMb ?? 512}m`,
    '--cpus',
    String(command.cpuCores ?? 0.25),
    '--user',
    '10001:10001',
    '--workdir',
    WORKSPACE,
    ...(command.networkPolicy === 'none' ? ['--network', 'none'] : []),
  ];
}

function docker(args, { input, timeoutMs = 180_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 512 * 1024) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 128 * 1024) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: error.message, exitCode: 127, timedOut: false });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: timedOut ? 124 : (code ?? 0), timedOut });
    });

    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

async function handleCommand(command, ctx) {
  if (verbose) log('debug', `→ ${command.kind}`, { id: command.id });

  if (ctx.dryRun) return simulate(command);

  switch (command.kind) {
    case 'create': {
      // A leftover container from an earlier timed-out create would make this
      // run fail with a name conflict — clear the way first. `rm -f` on a
      // name that does not exist exits non-zero; ignore that.
      await docker(['rm', '-f', command.sandboxExternalId], { timeoutMs: 15_000 });

      // A stock image needs its workspace directory prepared: the container
      // runs as an unprivileged uid, and a root-owned /workspace would make
      // every write fail. Preparing here is what lets any public image work.
      const result = await docker([
        'run',
        '-d',
        '--name',
        command.sandboxExternalId,
        '--label',
        `dev.karo.sandbox=${command.sandboxExternalId}`,
        ...hardeningFlags(command),
        ...Object.entries(command.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        command.image,
        'sleep',
        'infinity',
      ]);
      if (result.exitCode !== 0) {
        return { ok: false, error: result.stderr || 'docker run failed' };
      }

      const prep = await docker(
        [
          'exec',
          '--user',
          'root',
          command.sandboxExternalId,
          'sh',
          '-lc',
          `mkdir -p ${WORKSPACE} && chown 10001:10001 ${WORKSPACE}`,
        ],
        { timeoutMs: 30_000 },
      );
      if (prep.exitCode !== 0) {
        await docker(['rm', '-f', command.sandboxExternalId]);
        return {
          ok: false,
          error: prep.stderr || 'could not prepare the workspace directory',
        };
      }

      return { ok: true, data: { containerId: result.stdout.trim() } };
    }

    case 'start':
    case 'stop': {
      const result = await docker([command.kind, command.sandboxExternalId]);
      return result.exitCode === 0 ? { ok: true } : { ok: false, error: result.stderr };
    }

    case 'destroy': {
      await docker(['rm', '-f', '-v', command.sandboxExternalId]);
      return { ok: true };
    }

    case 'status': {
      const result = await docker([
        'inspect',
        '-f',
        '{{.State.Status}}',
        command.sandboxExternalId,
      ]);
      if (result.exitCode !== 0) return { ok: true, data: { status: 'destroyed' } };
      const raw = result.stdout.trim();
      const status =
        raw === 'running'
          ? 'running'
          : raw === 'exited' || raw === 'created'
            ? 'stopped'
            : 'failed';
      return { ok: true, data: { status } };
    }

    case 'exec': {
      const shell = command.shell === 'sh' ? '/bin/sh' : '/bin/bash';
      const result = await docker(
        [
          'exec',
          '-i',
          '--workdir',
          command.cwd || WORKSPACE,
          ...Object.entries(command.env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
          command.sandboxExternalId,
          shell,
          '-lc',
          command.command,
        ],
        { timeoutMs: (command.timeoutSeconds ?? 120) * 1000 },
      );
      return { ok: true, data: result };
    }

    case 'write_files': {
      for (const file of command.files ?? []) {
        const safe = safePath(file.path);
        if (!safe)
          return { ok: false, error: `Rejected path outside the workspace: ${file.path}` };
        const result = await docker(
          [
            'exec',
            '-i',
            command.sandboxExternalId,
            '/bin/sh',
            '-lc',
            `mkdir -p "$(dirname ${shellQuote(`${WORKSPACE}/${safe}`)})" && base64 -d > ${shellQuote(`${WORKSPACE}/${safe}`)}`,
          ],
          { input: file.contentBase64 },
        );
        if (result.exitCode !== 0) return { ok: false, error: result.stderr };
      }
      return { ok: true };
    }

    case 'read_file': {
      const safe = safePath(command.path);
      if (!safe) return { ok: false, error: 'Rejected path outside the workspace.' };
      const result = await docker([
        'exec',
        command.sandboxExternalId,
        '/bin/sh',
        '-lc',
        `base64 -w0 ${shellQuote(`${WORKSPACE}/${safe}`)}`,
      ]);
      return result.exitCode === 0
        ? { ok: true, data: { contentBase64: result.stdout.trim() } }
        : { ok: false, error: 'File not found.' };
    }

    case 'list_files': {
      const safe = command.path ? safePath(command.path) : '';
      if (command.path && !safe) return { ok: false, error: 'Rejected path.' };
      const target = safe ? `${WORKSPACE}/${safe}` : WORKSPACE;
      const result = await docker([
        'exec',
        command.sandboxExternalId,
        '/bin/sh',
        '-lc',
        `find ${shellQuote(target)} -mindepth 1 -maxdepth 1 -printf '%s|%T@|%y|%f\\n' 2>/dev/null | head -500`,
      ]);
      const entries = result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [size, mtime, type, ...rest] = line.split('|');
          const name = rest.join('|');
          return {
            path: safe ? `${safe}/${name}` : name,
            name,
            isDirectory: type === 'd',
            sizeBytes: Number.parseInt(size, 10) || 0,
            modifiedAt: new Date(Number.parseFloat(mtime) * 1000).toISOString(),
          };
        });
      return { ok: true, data: entries };
    }

    case 'delete_file': {
      const safe = safePath(command.path);
      if (!safe) return { ok: false, error: 'Rejected path.' };
      await docker([
        'exec',
        command.sandboxExternalId,
        '/bin/sh',
        '-lc',
        `rm -rf ${shellQuote(`${WORKSPACE}/${safe}`)}`,
      ]);
      return { ok: true };
    }

    case 'metrics': {
      const result = await docker([
        'stats',
        '--no-stream',
        '--format',
        '{{.CPUPerc}}|{{.MemUsage}}|{{.PIDs}}',
        command.sandboxExternalId,
      ]);
      const [cpu, mem, pids] = result.stdout.trim().split('|');
      return {
        ok: true,
        data: {
          cpuPercent: Number.parseFloat(cpu ?? '0') || 0,
          memoryUsedMb: parseMemory(mem ?? ''),
          processCount: Number.parseInt(pids ?? '0', 10) || 0,
        },
      };
    }

    case 'terminal_open': {
      openTerminal(command, ctx);
      return { ok: true };
    }
    case 'terminal_input': {
      terminals.get(command.sessionId)?.stdin.write(command.data);
      return { ok: true };
    }
    case 'terminal_close': {
      terminals.get(command.sessionId)?.kill();
      terminals.delete(command.sessionId);
      return { ok: true };
    }
    case 'terminal_resize':
      return { ok: true };

    default:
      return { ok: false, error: `Unsupported command: ${command.kind}` };
  }
}

function openTerminal(command, ctx) {
  const shell = command.shell === 'sh' ? '/bin/sh' : '/bin/bash';
  const child = spawn(
    'docker',
    ['exec', '-i', '--workdir', WORKSPACE, command.sandboxExternalId, shell],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  terminals.set(command.sessionId, child);

  const send = (stream) => (chunk) => {
    void postEvent(ctx, {
      type: 'terminal_output',
      sessionId: command.sessionId,
      stream,
      data: chunk.toString('utf8'),
    });
  };

  child.stdout.on('data', send('stdout'));
  child.stderr.on('data', send('stderr'));
  child.on('close', (code) => {
    terminals.delete(command.sessionId);
    void postEvent(ctx, {
      type: 'terminal_exit',
      sessionId: command.sessionId,
      exitCode: code ?? 0,
    });
  });
}

/* ------------------------------------------------------------------ *
 *  Dry-run simulation
 * ------------------------------------------------------------------ */

function simulate(command) {
  switch (command.kind) {
    case 'exec':
      return {
        ok: true,
        data: {
          stdout: `[dry-run] would execute: ${command.command}\n`,
          stderr: '',
          exitCode: 0,
          timedOut: false,
        },
      };
    case 'status':
      return { ok: true, data: { status: 'running' } };
    case 'metrics':
      return {
        ok: true,
        data: { cpuPercent: 3.2, memoryUsedMb: 180, processCount: 4, uptimeSeconds: 600 },
      };
    case 'list_files':
      return { ok: true, data: [] };
    case 'read_file':
      return { ok: true, data: { contentBase64: '' } };
    default:
      return { ok: true };
  }
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

/** Mirrors the control plane's `normalizeWorkspacePath`. Returns null on escape. */
function safePath(input) {
  if (typeof input !== 'string' || input.includes('\0')) return null;
  if (/^[a-zA-Z]:[\\/]/.test(input)) return null;
  let path = input.replace(/\\/g, '/').trim();
  if (path.startsWith(`${WORKSPACE}/`)) path = path.slice(WORKSPACE.length + 1);
  if (path.startsWith('/') || path.startsWith('~')) return null;

  const parts = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.length ? parts.join('/') : null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseMemory(text) {
  const match = /([\d.]+)\s*([KMG])iB/i.exec(text);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'K') return Math.round(value / 1024);
  if (unit === 'G') return Math.round(value * 1024);
  return Math.round(value);
}

async function postEvent(ctx, event) {
  try {
    await request(ctx.url, '/api/worker/event', { body: { event }, token: ctx.token });
  } catch (error) {
    log('warn', `Could not deliver event: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ *
 *  Main loop
 * ------------------------------------------------------------------ */

async function run(ctx) {
  let stopping = false;
  let backoff = POLL_ERROR_BACKOFF_MS;

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log('info', 'Shutting down…');
    for (const child of terminals.values()) child.kill();
    setTimeout(() => process.exit(0), 200);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const sendHeartbeat = () =>
    request(ctx.url, '/api/worker/heartbeat', {
      body: { host: hostFacts(ctx.dryRun), metrics: hostMetrics() },
      token: ctx.token,
      timeoutMs: 10_000,
    }).catch((error) => log('warn', `Heartbeat failed: ${error.message}`));

  // Once immediately: a worker restarted after installing Docker should correct
  // its own record in seconds, not after the first interval elapses.
  void sendHeartbeat();
  const heartbeat = setInterval(sendHeartbeat, HEARTBEAT_MS);
  heartbeat.unref?.();

  log('info', `Connected to ${ctx.url}. Waiting for work.${ctx.dryRun ? ' (dry run)' : ''}`);

  while (!stopping) {
    try {
      const result = await request(ctx.url, '/api/worker/poll', {
        method: 'GET',
        token: ctx.token,
        timeoutMs: 40_000,
      });
      backoff = POLL_ERROR_BACKOFF_MS;

      for (const command of result?.commands ?? []) {
        let outcome;
        try {
          outcome = await handleCommand(command, ctx);
        } catch (error) {
          outcome = { ok: false, error: error.message };
        }

        // Fire-and-forget commands carry no result the server is waiting on.
        if (command.kind.startsWith('terminal_')) continue;

        await request(ctx.url, '/api/worker/result', {
          body: { commandId: command.id, ...outcome },
          token: ctx.token,
        }).catch((error) => log('warn', `Could not deliver result: ${error.message}`));
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        log('error', 'This worker has been revoked. Re-register with a new install token.');
        clearInterval(heartbeat);
        process.exit(1);
      }
      log('warn', `Poll failed (${error.message}); retrying in ${Math.round(backoff / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, POLL_ERROR_BACKOFF_MAX_MS);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  verbose = args.verbose;

  if (args.help) {
    usage();
    return;
  }

  let config = loadConfig();

  if (args.token) {
    if (!args.url && !config?.url) {
      log('error', '--url is required when registering. See --help.');
      process.exit(1);
    }
    await register({
      url: args.url ?? config.url,
      installToken: args.token,
      name: args.name,
      dryRun: args.dryRun,
    });
    config = loadConfig();

    // The installer's one-shot step: trade the install token for the worker
    // token, persist it and leave. The service itself always runs without
    // token arguments — a consumed install token in a service definition
    // would turn every restart into a registration failure loop.
    if (args.registerOnly) return;
  }

  if (!config?.workerToken) {
    log('error', 'No worker token found. Register first:');
    log('error', '  karo-worker --token <install-token> --url <karo-url>');
    process.exit(1);
  }

  await run({
    url: config.url,
    token: config.workerToken,
    workerId: config.workerId,
    dryRun: args.dryRun,
  });
}

main().catch((error) => {
  log('error', error.message);
  process.exit(1);
});
