import { redactSecrets } from '@/lib/crypto/secrets';
import { env } from '@/lib/env';

/**
 * Structured logging.
 *
 * Two shapes, one API:
 *  · **production** — one JSON object per line, so a log shipper can index it
 *    without a grok pattern and a stack trace never spans lines;
 *  · **development** — a short coloured line, because a human is reading it.
 *
 * Every context object passes through `redactSecrets()` first. That is the
 * single most valuable property of this module: a stray
 * `logger.info('req', { headers })` can never leak an Authorization header
 * into a log aggregator.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Derives a logger with a nested scope, e.g. `api` → `api:sandbox`. */
  child(scope: string): Logger;
  readonly scope: string;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Built at runtime so the source file stays free of raw control bytes. */
const ESC = String.fromCharCode(27);

const ANSI = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  grey: `${ESC}[90m`,
  red: `${ESC}[31m`,
  yellow: `${ESC}[33m`,
  cyan: `${ESC}[36m`,
  magenta: `${ESC}[35m`,
} as const;

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: ANSI.grey,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.red,
};

const LEVEL_TAG: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

function threshold(): number {
  return LEVEL_WEIGHT[env.LOG_LEVEL] ?? LEVEL_WEIGHT.info;
}

function isProduction(): boolean {
  return env.NODE_ENV === 'production';
}

/** Named `colorEnabled`, not `useColor` — a `use*` name reads as a React hook. */
function colorEnabled(): boolean {
  if (isProduction()) return false;
  if (process.env.NO_COLOR) return false;
  // `isTTY` is undefined when output is piped to a file or a CI collector.
  return Boolean(process.stdout && process.stdout.isTTY);
}

/**
 * Errors are not plain objects — `message` and `stack` are non-enumerable, so
 * `JSON.stringify(err)` yields `{}`. Normalise them (and anything nesting them)
 * before redaction so the redactor actually sees the strings.
 */
function normalise(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value == null) return value;

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };
    if (!isProduction() && value.stack) out.stack = value.stack;
    if (value.cause !== undefined) out.cause = normalise(value.cause, depth + 1);
    for (const key of Object.keys(value)) {
      if (key === 'name' || key === 'message' || key === 'stack') continue;
      out[key] = normalise((value as unknown as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (value instanceof Set) return Array.from(value.values());
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (Array.isArray(value)) return value.map((v) => normalise(v, depth + 1));

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalise(v, depth + 1);
    }
    return out;
  }

  return value;
}

function prepare(context: LogContext | undefined): Record<string, unknown> | null {
  if (!context) return null;
  const normalised = normalise(context) as Record<string, unknown>;
  const redacted = redactSecrets(normalised);
  return Object.keys(redacted).length > 0 ? redacted : null;
}

function stringifySafe(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[circular]';
        seen.add(val);
      }
      return val;
    });
  } catch {
    return '"[unserialisable]"';
  }
}

function formatDevValue(value: unknown): string {
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return stringifySafe(value);
}

function write(level: LogLevel, line: string): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug') console.debug(line);
  else console.info(line);
}

function emit(level: LogLevel, scope: string, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < threshold()) return;

  const prepared = prepare(context);
  const now = new Date();

  if (isProduction()) {
    write(
      level,
      stringifySafe({
        ts: now.toISOString(),
        level,
        scope,
        msg: message,
        ...(prepared ?? {}),
      }),
    );
    return;
  }

  const colored = colorEnabled();
  const paint = (code: string, text: string) =>
    colored ? `${code}${text}${ANSI.reset}` : text;

  const parts = [
    paint(ANSI.grey, now.toISOString().slice(11, 23)),
    paint(LEVEL_COLOR[level], LEVEL_TAG[level]),
    paint(ANSI.magenta, `[${scope}]`),
    colored && level === 'error' ? paint(ANSI.bold, message) : message,
  ];

  if (prepared) {
    const pairs = Object.entries(prepared)
      .map(([k, v]) => `${paint(ANSI.dim, `${k}=`)}${formatDevValue(v)}`)
      .join(' ');
    if (pairs) parts.push(pairs);
  }

  write(level, parts.join(' '));
}

export function createLogger(scope: string): Logger {
  return {
    scope,
    debug: (message, context) => emit('debug', scope, message, context),
    info: (message, context) => emit('info', scope, message, context),
    warn: (message, context) => emit('warn', scope, message, context),
    error: (message, context) => emit('error', scope, message, context),
    child: (childScope) => createLogger(`${scope}:${childScope}`),
  };
}

/** The root logger. Prefer `createLogger('scope')` inside a module. */
export const logger: Logger = createLogger('karo');

/** True when a message at this level would actually be written. */
export function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= threshold();
}
