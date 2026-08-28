import { lookup } from 'node:dns/promises';

import { ForbiddenError, TimeoutError, ValidationError } from '@/lib/api/errors';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';

/**
 * Outbound request guard (SSRF).
 *
 * Karo fetches URLs users control: MCP server endpoints, catalogue URLs, git
 * remotes, webhook targets. Without a guard, `http://169.254.169.254/latest/`
 * turns the web tier into a credential dispenser.
 *
 * What this module blocks: non-HTTP schemes, credentials embedded in the URL,
 * private / loopback / link-local / unique-local / multicast literals in both
 * IPv4 and IPv6, `.local` and `.internal` names, the cloud metadata endpoints,
 * and ports outside a small allow-list.
 *
 * The literal checks are not enough on their own, and for a long time they were
 * all there was. `assertSafeOutboundUrl` inspects `url.hostname` as *text*: a
 * name is never resolved, so `http://localtest.me/` — a public DNS record whose
 * A record is `127.0.0.1`, and there are many such names — walked straight past
 * every one of them while the literal `http://127.0.0.1/` was correctly refused.
 * Proven against MCP's connection test and the API-key verifier, both of which
 * reached a listener on loopback and reported success. `assertSafeOutboundTarget`
 * closes that by resolving the name and judging the addresses it actually gets.
 *
 * What it still does not attempt: DNS re-binding. Resolving the name here and
 * then handing the *name* to `fetch` leaves a TOCTOU window that only a
 * pinned-IP connection can close, and the platform `fetch` gives no hook for
 * one. Karo mitigates it at the network layer instead — the sandbox Docker
 * network is created `internal`, and the web tier has no route to the metadata
 * service or to RFC1918 space in production.
 */

const log = createLogger('ssrf');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Ports a legitimate integration actually listens on. Everything else (SSH,
 * SMTP, Redis, Postgres, Docker, Elasticsearch, …) is a pivot target.
 */
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

const BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.cluster.local',
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/** Well-known cloud metadata endpoints, checked before the range rules. */
const METADATA_ADDRESSES = new Set(['169.254.169.254', '169.254.170.2', 'fd00:ec2::254']);

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 *  Address classification
 * ------------------------------------------------------------------ */

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a = 0, b = 0, c = 0, d = 0] = octets;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC6598
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;

  return false;
}

/**
 * Expands any IPv6 literal to its eight 16-bit groups.
 *
 * Textual matching is not good enough here: `new URL()` rewrites
 * `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, so a guard that greps for
 * a dotted quad waves the metadata service straight through. Everything below
 * therefore decides on numbers.
 */
function expandIpv6(raw: string): number[] | null {
  let host = raw.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  host = host.split('%')[0] ?? ''; // drop any zone index
  if (host === '') return null;

  // Rewrite a trailing dotted quad into the two hex groups it stands for, so
  // the rest of the parser only ever sees canonical hextets.
  const lastColon = host.lastIndexOf(':');
  const tail = host.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = parseIpv4(tail);
    if (!octets) return null;
    const high = (((octets[0] ?? 0) << 8) | (octets[1] ?? 0)).toString(16);
    const low = (((octets[2] ?? 0) << 8) | (octets[3] ?? 0)).toString(16);
    host = `${host.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColon = host.indexOf('::');
  let head: string[];
  let rest: string[];

  if (doubleColon === -1) {
    head = host.split(':');
    rest = [];
  } else {
    head = host
      .slice(0, doubleColon)
      .split(':')
      .filter((p) => p !== '');
    rest = host
      .slice(doubleColon + 2)
      .split(':')
      .filter((p) => p !== '');
  }

  const groups = [...head, ...rest];
  if (groups.length > 8) return null;

  const toNumber = (part: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    return Number.parseInt(part, 16);
  };

  const headNums: number[] = [];
  for (const part of head) {
    const n = toNumber(part);
    if (n === null) return null;
    headNums.push(n);
  }

  const restNums: number[] = [];
  for (const part of rest) {
    const n = toNumber(part);
    if (n === null) return null;
    restNums.push(n);
  }

  if (doubleColon === -1) {
    if (headNums.length !== 8) return null;
    return headNums;
  }

  const fill = 8 - headNums.length - restNums.length;
  if (fill < 0) return null;
  return [...headNums, ...Array<number>(fill).fill(0), ...restNums];
}

/** Reads two 16-bit groups back out as a dotted-quad octet list. */
function embeddedIpv4(high: number, low: number): number[] {
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
}

function isPrivateIpv6(raw: string): boolean {
  const g = expandIpv6(raw);
  // Unparseable literals are rejected rather than trusted.
  if (!g) return true;

  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;

  const topSixZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  if (topSixZero && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1

  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible, deprecated).
  if (topSixZero && (g5 === 0xffff || g5 === 0)) {
    return isPrivateIpv4(embeddedIpv4(g6, g7));
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local (incl. fd00:ec2::254)
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard

  // Tunnelling prefixes can carry a private IPv4 payload to the same effect.
  if (g0 === 0x2002) return isPrivateIpv4(embeddedIpv4(g1, g2)); // 6to4
  if (g0 === 0x0064 && g1 === 0xff9b) return isPrivateIpv4(embeddedIpv4(g6, g7)); // NAT64

  return false;
}

function looksLikeIpv6(host: string): boolean {
  return host.includes(':');
}

/** Extra hosts an operator has explicitly vouched for. */
function allowedHosts(): Set<string> {
  const raw = env.OUTBOUND_ALLOWED_HOSTS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function blocked(reason: string, url: string): ForbiddenError {
  log.warn('Blocked an outbound request', { reason, url });
  return new ForbiddenError(`Outbound request blocked: ${reason}`, {
    title: 'That address is not reachable',
    description:
      'Karo only calls public HTTP(S) endpoints. Private, loopback and cloud-metadata addresses are blocked to protect the platform. Use a publicly resolvable URL.',
    details: { reason },
  });
}

/* ------------------------------------------------------------------ *
 *  Assertion
 * ------------------------------------------------------------------ */

/**
 * Validates a user-supplied URL for outbound use. Returns the parsed URL so the
 * caller works with the normalised value rather than the raw string.
 */
export function assertSafeOutboundUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : new URL(input.toString());
  } catch {
    throw new ValidationError('That is not a valid URL.', [
      { path: 'url', message: 'Enter a full URL including https://', code: 'invalid_url' },
    ]);
  }

  const raw = url.toString();

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw blocked(`unsupported protocol "${url.protocol.replace(':', '')}"`, raw);
  }

  // `https://user:pass@host` is the classic way to smuggle a target past a
  // naive allow-list check, and no legitimate integration needs it.
  if (url.username || url.password) {
    throw blocked('credentials embedded in the URL', raw);
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) throw blocked('missing host', raw);

  // An operator vouching for a host vouches for its port too — that is the
  // whole point of the escape hatch (a self-hosted MCP server on :7000).
  if (allowedHosts().has(hostname)) return url;

  if (METADATA_ADDRESSES.has(hostname.replace(/^\[|\]$/g, ''))) {
    throw blocked('cloud metadata endpoint', raw);
  }
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw blocked(`reserved hostname "${hostname}"`, raw);
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw blocked('internal network hostname', raw);
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isPrivateIpv4(ipv4)) {
    throw blocked('private or reserved IPv4 address', raw);
  }
  if (looksLikeIpv6(hostname) && isPrivateIpv6(hostname)) {
    throw blocked('private or reserved IPv6 address', raw);
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) {
    throw blocked(`port ${port} is not allowed`, raw);
  }

  return url;
}

/**
 * Everything `assertSafeOutboundUrl` checks, plus the addresses the hostname
 * actually resolves to.
 *
 * This is the check that belongs in front of a real request. The synchronous
 * one stays for form validation, where blocking on DNS would be wrong and a
 * structural verdict is what the field needs.
 *
 * `all: true` matters: a name with several A records passes only if **every**
 * one of them is public, so an attacker cannot hide a loopback address behind a
 * public one and rely on which the resolver hands back first.
 *
 * A name that does not resolve is left alone rather than refused — that is a
 * connection error to report as such, not a security verdict, and pretending
 * otherwise would make every transient DNS failure look like an attack.
 */
export async function assertSafeOutboundTarget(input: string | URL): Promise<URL> {
  const url = assertSafeOutboundUrl(input);
  const hostname = url.hostname.toLowerCase();

  // Literals were already judged above, and asking the resolver about them
  // would only be a slower way to get the same answer.
  if (parseIpv4(hostname) || looksLikeIpv6(hostname)) return url;
  if (allowedHosts().has(hostname)) return url;

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return url;
  }

  for (const { address, family } of addresses) {
    const ipv4 = family === 4 ? parseIpv4(address) : null;
    if (ipv4 && isPrivateIpv4(ipv4)) {
      throw blocked(
        `"${hostname}" resolves to the private or reserved address ${address}`,
        url.toString(),
      );
    }
    if (family === 6 && isPrivateIpv6(address)) {
      throw blocked(
        `"${hostname}" resolves to the private or reserved address ${address}`,
        url.toString(),
      );
    }
    if (METADATA_ADDRESSES.has(address)) {
      throw blocked(`"${hostname}" resolves to a cloud metadata endpoint`, url.toString());
    }
  }

  return url;
}

/** Non-throwing variant for validation UIs. */
export function isSafeOutboundUrl(input: string | URL): boolean {
  try {
    assertSafeOutboundUrl(input);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 *  Guarded fetch
 * ------------------------------------------------------------------ */

export type SafeFetchOptions = Omit<RequestInit, 'redirect' | 'signal'> & {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal | null;
};

/**
 * `fetch` with the guard applied to the initial URL *and to every redirect
 * hop* — an allowed host that 302s to `169.254.169.254` is the whole point of
 * `redirect: 'manual'` here. Also enforces a hard timeout and a body cap.
 */
export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = REQUEST_TIMEOUT_MS,
    maxBytes = MAX_RESPONSE_BYTES,
    maxRedirects = MAX_REDIRECTS,
    signal,
    ...init
  } = options;

  let target = await assertSafeOutboundTarget(input);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response: Response | null = null;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    try {
      response = await fetch(target, { ...init, redirect: 'manual', signal: abortSignal });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ) {
        throw new TimeoutError(`Request to ${target.host} timed out after ${timeoutMs} ms.`);
      }
      throw error;
    }

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) break;

    const location = response.headers.get('location');
    if (!location) break;

    if (hop === maxRedirects) {
      throw blocked(`more than ${maxRedirects} redirects`, target.toString());
    }

    // Drain the redirect body so the socket can be reused.
    await response.body?.cancel().catch(() => {});
    // Each hop is re-resolved too: a redirect to a name pointing at loopback
    // is the same attack with one extra step.
    target = await assertSafeOutboundTarget(new URL(location, target));
  }

  if (!response) throw new TimeoutError('The outbound request produced no response.');

  return capBody(response, maxBytes);
}

/**
 * Rewraps the response with a size-limited body. A hostile endpoint answering
 * with an endless stream would otherwise exhaust the server's memory.
 */
function capBody(response: Response, maxBytes: number): Response {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ValidationError(
      `The response is larger than the ${Math.round(maxBytes / 1024)} KB limit.`,
      [{ path: 'response', message: 'Response too large', code: 'response_too_large' }],
      {
        title: 'Response too large',
        description:
          'Karo stopped reading this endpoint because it returned more data than allowed.',
      },
    );
  }

  if (!response.body) return response;

  let read = 0;
  const limited = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        read += chunk.byteLength;
        if (read > maxBytes) {
          controller.error(new Error(`Response exceeded ${maxBytes} bytes and was cut off.`));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  return new Response(limited, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Convenience: guarded fetch that parses JSON, with the same body cap. */
export async function safeFetchJson<T>(
  input: string | URL,
  options: SafeFetchOptions = {},
): Promise<T> {
  const response = await safeFetch(input, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
  });

  if (!response.ok) {
    throw new ValidationError(
      `The endpoint answered with HTTP ${response.status}.`,
      [{ path: 'url', message: `HTTP ${response.status}`, code: 'upstream_error' }],
      {
        title: 'The endpoint rejected the request',
        description:
          'Karo reached the URL but it did not return a success response. Check the address and any required headers.',
      },
    );
  }

  return (await response.json()) as T;
}
