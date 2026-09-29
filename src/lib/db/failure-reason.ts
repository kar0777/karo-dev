/**
 * Classifies a failed database ping into a reason that is safe for an
 * unauthenticated body.
 *
 * The raw error message names hosts, users and ports; the class names only the
 * problem, which is what a dashboard or an operator on the far side of a status
 * page needs to route the incident. Lives outside the route handler so it can be
 * unit-tested (Next route modules may only export handlers).
 */
export function dbFailureReason(message: string): string {
  const m = message.toLowerCase();
  // Serverless Postgres hosts (Neon etc.) refuse connections when a free plan is
  // exhausted or a project/endpoint is suspended or removed. Checked first: the
  // messages often also contain words like "connection" that match nothing else,
  // and before this class existed they were all reported as "unknown".
  if (/quota|exceeded|over the (?:limit|quota)|usage limit|billing/.test(m)) return 'quota';
  if (
    /suspend|endpoint is disabled|endpoint .* (?:disabled|not found)|project .* (?:deleted|not found)/.test(
      m,
    )
  ) {
    return 'suspended';
  }
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
