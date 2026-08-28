import { defineHandler } from '@/lib/api/handler';
import { json } from '@/lib/api/responses';
import { checkEmailTransport } from '@/lib/auth/email';
import { pingDatabase } from '@/lib/db';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { getProvider } from '@/lib/sandbox';
import { getRedis, redisAvailable } from '@/lib/redis';

/**
 * `GET /api/health` — the liveness/readiness probe.
 *
 * Unauthenticated and unthrottled, because a load balancer must be able to
 * reach it while the app is rejecting everything else. That constraint decides
 * what may appear in the body: **names of things, never addresses of things**.
 * No connection strings, no hostnames, no upstream error text — a failed
 * database ping reports `ok: false` and a latency, and the actual reason goes
 * to the server log where it is already available to operators.
 *
 * Returns 503 when the database is unreachable so an orchestrator takes the
 * instance out of rotation; a degraded optional dependency (Redis) is still 200,
 * because Karo is designed to run correctly without it.
 */

export const dynamic = 'force-dynamic';

const log = createLogger('api:health');

const APP_VERSION = process.env.npm_package_version ?? '1.0.0';

/**
 * Classifies a failed ping into a reason safe for an unauthenticated body.
 * The raw error message names hosts, users and ports; the class names only
 * the problem, which is what a dashboard or an operator on the far side of a
 * status page needs to route the incident.
 */
function dbFailureReason(message: string): string {
  const m = message.toLowerCase();
  if (/enotfound|eai_again|getaddrinfo/.test(m)) return 'dns';
  if (/etimedout|timeout|timed out/.test(m)) return 'timeout';
  if (/econnrefused/.test(m)) {
    return /127\.0\.0\.1|localhost|\[::1\]/.test(m)
      ? 'econnrefused-localhost'
      : 'econnrefused-remote';
  }
  if (/28p01|password authentication|authentication failed|role .* does not exist/.test(m)) {
    return 'auth';
  }
  if (/ssl|tls|certificate/.test(m)) return 'tls';
  if (/3d000|database .* does not exist/.test(m)) return 'database-missing';
  if (/53300|too many connections/.test(m)) return 'connection-limit';
  return 'unknown';
}

export const GET = defineHandler({ auth: 'none', csrf: false, rateLimit: false }, async () => {
  const database = await pingDatabase();

  // The failure detail stays server-side: it routinely contains the host and
  // port of the database, which an unauthenticated probe must never reveal.
  if (!database.ok) log.error('Database ping failed', { error: database.error });

  const sandboxProvider = getProvider(env.RESOLVED_SANDBOX_PROVIDER);
  let sandboxReachable = false;
  try {
    sandboxReachable = await sandboxProvider.isAvailable();
  } catch {
    sandboxReachable = false;
  }

  // Result is cached for minutes inside the check — see SMTP_VERIFY_TTL_MS —
  // because this route is polled by the container healthcheck.
  const email = await checkEmailTransport();

  const status = !database.ok ? 'down' : sandboxReachable && email.ok ? 'ok' : 'degraded';

  return json(
    {
      status,
      version: APP_VERSION,
      demoMode: env.DEMO_MODE,
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
      db: {
        ok: database.ok,
        latencyMs: database.latencyMs,
        ...(database.ok ? {} : { reason: dbFailureReason(database.error ?? '') }),
      },
      redis: {
        // `memory` is a valid, supported configuration — not a failure.
        backend: getRedis().backend,
        connected: redisAvailable(),
        required: false,
      },
      email: {
        // `console` is the demo/dev transport and always "ok"; the name is the
        // useful signal, since a production install on `console` cannot deliver
        // a verification link to anyone but the operator.
        transport: email.transport,
        ok: email.ok,
        ...(email.reason ? { reason: email.reason } : {}),
      },
      providers: {
        ai: env.AI_PROVIDER,
        billing: env.BILLING_PROVIDER,
        sandbox: sandboxProvider.key,
        sandboxDisplayName: sandboxProvider.displayName,
        sandboxReachable,
      },
    },
    { status: database.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
});
