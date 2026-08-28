import 'server-only';

import { createLogger } from '@/lib/logger';

/**
 * Error reporting.
 *
 * Karo logs plenty already — 31 call sites hand a caught failure to
 * `createLogger`. What was missing is everything *nobody caught*: a Server
 * Component that throws during render, a stream that dies mid-flight, and every
 * client-side crash, which until now went to `console.error` in the visitor's own
 * browser where no operator will ever read it.
 *
 * This module is the one place those converge, and it is deliberately
 * vendor-neutral. Nothing here imports an SDK:
 *
 *  · it always writes a structured log line, which is what a `docker compose
 *    logs` or a log shipper already collects;
 *  · it optionally POSTs a compact JSON payload to `ERROR_WEBHOOK_URL`, which is
 *    enough for Slack, Discord, Better Stack, an OTEL collector's HTTP receiver
 *    or a three-line Lambda.
 *
 * Choosing Sentry for someone who is going to sell this install is not our call,
 * and an SDK that hooks `process` globals is a poor thing to inherit. The seam is
 * `deliverToWebhook` — swap it for an SDK call and nothing else changes.
 */

const log = createLogger('error');

export type ErrorSource = 'server' | 'client';

export type ErrorReport = {
  /** Already-normalised message. Never an `Error` — see `describeUnknown`. */
  message: string;
  name?: string;
  stack?: string;
  source: ErrorSource;
  /** Request path or route pattern the failure belongs to. */
  path?: string;
  method?: string;
  /** Next.js error digest, which correlates a client boundary to a server log. */
  digest?: string;
  /** Populated only where the caller already knows it; never looked up here. */
  userId?: string;
  extra?: Record<string, unknown>;
};

/* ------------------------------------------------------------------ *
 *  Redaction
 *
 *  A stack trace is not a safe thing to forward. It routinely carries the
 *  argument that caused the failure, and in this codebase those arguments
 *  include provider API keys, BYOS worker tokens, session ids and
 *  connection strings. The webhook is a third party by definition, so the
 *  payload is scrubbed before it leaves the process — and scrubbed on the
 *  log path too, because logs get shipped and pasted into issues.
 * ------------------------------------------------------------------ */

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // Bearer/authorization headers echoed into a message.
  [/\b(bearer|token|authorization)\s+[\w.\-~+/]{8,}/gi, '$1 [redacted]'],
  // Provider key shapes: sk-…, sk_live_…, sk-proj-…, ghp_…, xoxb-…
  //
  // The optional middle segment is what makes `sk-proj-…` match. Without it the
  // pattern anchored straight onto the random tail, "proj" was too short to
  // satisfy the length floor, and OpenAI-style keys passed through untouched.
  [/\b(sk|pk|rk)[-_](?:[A-Za-z0-9]+[-_])?[A-Za-z0-9]{12,}/g, '[redacted-key]'],
  [/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/g, '[redacted-key]'],
  [/\bxox[bposa]-[A-Za-z0-9-]{10,}/g, '[redacted-key]'],
  // Karo's own opaque credentials share the `<prefix>_<base32ish>` shape.
  [/\b(sess|byos|kapi)_[A-Za-z0-9]{16,}/g, '$1_[redacted]'],
  // Anything with a password in a URL, including DATABASE_URL and SMTP_URL.
  [/\/\/([^:/@\s]+):[^@\s]+@/g, '//$1:[redacted]@'],
  // `key=value` where the key name admits it is a secret.
  [
    /\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|encryption[_-]?key)\b(\s*[=:]\s*)\S+/gi,
    '$1$2[redacted]',
  ],
];

/** Conservative: over-redacting a stack costs legibility, under-redacting leaks. */
export function redact(value: string): string {
  let out = value;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

/** Stacks can be enormous; a webhook body has to stay small enough to accept. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}… (${value.length} chars)`;
}

/**
 * Turns anything a `catch` can produce into a reportable shape.
 *
 * `JSON.stringify(new Error(...))` is `{}`, thrown strings are common in
 * third-party code, and a rejected promise can carry literally anything.
 */
export function describeUnknown(error: unknown): {
  message: string;
  name?: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      name: error.name,
      stack: error.stack,
    };
  }
  if (typeof error === 'string') return { message: error };
  if (error && typeof error === 'object') {
    const shape = error as { message?: unknown; name?: unknown; stack?: unknown };
    if (typeof shape.message === 'string') {
      return {
        message: shape.message,
        name: typeof shape.name === 'string' ? shape.name : undefined,
        stack: typeof shape.stack === 'string' ? shape.stack : undefined,
      };
    }
  }
  return { message: `Non-error thrown: ${Object.prototype.toString.call(error)}` };
}

/* ------------------------------------------------------------------ *
 *  Storm control
 *
 *  The normal shape of a production incident is not one error, it is the
 *  same error ten thousand times. Forwarding all of them buries the signal
 *  and, if the webhook is a chat channel, makes the channel unusable at
 *  exactly the moment people need it. Local logging is never suppressed —
 *  that is what the log level is for — but the webhook sees one message
 *  per fingerprint per window, carrying the suppressed count.
 * ------------------------------------------------------------------ */

const STORM_WINDOW_MS = 60_000;
const seen = new Map<string, { first: number; count: number }>();

function fingerprint(report: ErrorReport): string {
  // First stack frame is the useful discriminator; the whole stack is too
  // specific once line numbers shift between builds.
  const frame = report.stack?.split('\n')[1]?.trim() ?? '';
  return `${report.source}|${report.name ?? ''}|${report.message}|${frame}|${report.path ?? ''}`;
}

/** Returns how many were suppressed since the last delivery, or `null` to skip. */
function admit(report: ErrorReport): number | null {
  const key = fingerprint(report);
  const now = Date.now();
  const entry = seen.get(key);

  if (!entry || now - entry.first >= STORM_WINDOW_MS) {
    seen.set(key, { first: now, count: 0 });
    // Opportunistic sweep; this map must not grow without bound in a
    // process that stays up for weeks.
    if (seen.size > 500) {
      for (const [k, v] of seen) if (now - v.first >= STORM_WINDOW_MS) seen.delete(k);
    }
    return entry ? entry.count : 0;
  }

  entry.count += 1;
  return null;
}

/* ------------------------------------------------------------------ *
 *  Delivery
 * ------------------------------------------------------------------ */

const WEBHOOK_TIMEOUT_MS = 5_000;

async function deliverToWebhook(report: ErrorReport, suppressed: number): Promise<void> {
  // Read from `process.env` rather than the parsed env object: this is
  // optional infrastructure config, and a deployment that ships no errors
  // anywhere should not have to declare it.
  const url = process.env.ERROR_WEBHOOK_URL?.trim();
  if (!url) return;

  const payload = {
    service: process.env.APP_NAME ?? 'Karo',
    environment: process.env.NODE_ENV ?? 'development',
    source: report.source,
    name: report.name,
    message: truncate(redact(report.message), 1_000),
    stack: report.stack ? truncate(redact(report.stack), 4_000) : undefined,
    path: report.path,
    method: report.method,
    digest: report.digest,
    userId: report.userId,
    suppressedSince: suppressed || undefined,
    at: new Date().toISOString(),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      // No cookies, no cache, no redirects to somewhere unexpected.
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) {
      log.warn('The error webhook rejected a report', { status: response.status });
    }
  } catch (error) {
    // A failing error-reporter must never become the error. Logged at warn
    // so a permanently broken webhook is visible without being fatal.
    log.warn('Could not deliver an error report', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Records an error. Never throws, never rejects.
 *
 * Awaiting this is safe and cheap when no webhook is configured; with one it
 * costs at most `WEBHOOK_TIMEOUT_MS`. Callers on a request path should await it
 * anyway — a floating promise in a serverless runtime is a dropped report.
 */
export async function reportError(report: ErrorReport): Promise<void> {
  const context: Record<string, unknown> = {
    source: report.source,
    ...(report.name ? { name: report.name } : {}),
    ...(report.path ? { path: report.path } : {}),
    ...(report.method ? { method: report.method } : {}),
    ...(report.digest ? { digest: report.digest } : {}),
    ...(report.userId ? { userId: report.userId } : {}),
    ...(report.extra ?? {}),
  };
  if (report.stack) context.stack = truncate(redact(report.stack), 4_000);

  log.error(redact(report.message), context);

  const suppressed = admit(report);
  if (suppressed === null) return;

  await deliverToWebhook(report, suppressed);
}

/** Resets storm-control state. Tests only. */
export function __resetReportState(): void {
  seen.clear();
}
