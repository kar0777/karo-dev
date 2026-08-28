/**
 * Decides whether the Postgres connection must use TLS.
 *
 * postgres.js only turns TLS on when the connection string asks for it
 * (`?sslmode=require`), so a URL pasted without its query string silently
 * downgrades to plaintext — and every managed host (Neon, Supabase, RDS)
 * refuses plaintext with "connection is insecure". That failure reaches
 * `/api/health` as a generic ping error, indistinguishable from a database
 * outage until someone reads the raw log. The default is therefore fixed
 * here: local and private-network hosts stay plaintext, anything public is
 * upgraded to `sslmode=require` unless the URL explicitly opts out via
 * `sslmode=disable`. `DATABASE_SSL=true` still forces TLS for every host,
 * including localhost.
 */
export function databaseSsl(url: string): 'require' | undefined {
  if (/sslmode=disable/i.test(url)) return undefined;
  if (/sslmode=(?:require|verify-ca|verify-full)|ssl=true/i.test(url)) return 'require';
  try {
    const { hostname } = new URL(url);
    return isPlainHost(hostname) ? undefined : 'require';
  } catch {
    return undefined;
  }
}

/** A local or private-network host: plaintext sockets are the norm here, and
 *  no managed provider's TLS requirement can bite. */
function isPlainHost(hostname: string): boolean {
  if (/^(?:localhost|127\.0\.0\.1|::1|\[::1\])$/.test(hostname)) return true;
  if (/^(?:10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(hostname)) return true;
  if (/\.(?:local|internal|lan)$/.test(hostname)) return true;
  return false;
}
