import { describe, expect, it } from 'vitest';

import { clientIpFromRequest } from '@/lib/rate-limit';

/**
 * The defect these lock down: `clientIpFromRequest` read the **left-most**
 * `x-forwarded-for` entry. A proxy *appends* the real address, so the left-most
 * value is whatever the client sent — meaning every IP-scoped rate limit,
 * including `auth.login`, could be reset by sending a fresh header per request.
 * That is unlimited password brute-forcing, and the forged address also reached
 * the audit log and the "active devices" list.
 */
function req(headers: Record<string, string>): Request {
  return new Request('https://karo.local/api/auth/login', { method: 'POST', headers });
}

function withHops<T>(hops: string | undefined, run: () => T): T {
  const previous = process.env.TRUST_PROXY_HOPS;
  if (hops === undefined) delete process.env.TRUST_PROXY_HOPS;
  else process.env.TRUST_PROXY_HOPS = hops;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = previous;
  }
}

describe('clientIpFromRequest', () => {
  it('ignores a client-forged prefix and takes the address the proxy appended', () => {
    const ip = withHops('1', () =>
      clientIpFromRequest(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })),
    );
    expect(ip).toBe('203.0.113.7');
    expect(ip).not.toBe('9.9.9.9');
  });

  it('gives a forging client the same bucket every time', () => {
    // The point of the fix: two requests with different forged prefixes must not
    // land in two different rate-limit buckets.
    const first = withHops('1', () =>
      clientIpFromRequest(req({ 'x-forwarded-for': 'aaa, 203.0.113.7' })),
    );
    const second = withHops('1', () =>
      clientIpFromRequest(req({ 'x-forwarded-for': 'bbb, 203.0.113.7' })),
    );
    expect(first).toBe(second);
  });

  it('walks further left as more proxies are trusted', () => {
    const chain = { 'x-forwarded-for': '198.51.100.1, 203.0.113.7, 10.0.0.5' };
    expect(withHops('1', () => clientIpFromRequest(req(chain)))).toBe('10.0.0.5');
    expect(withHops('2', () => clientIpFromRequest(req(chain)))).toBe('203.0.113.7');
    expect(withHops('3', () => clientIpFromRequest(req(chain)))).toBe('198.51.100.1');
  });

  it('trusts no forwarding header when nothing is in front of the app', () => {
    // With no proxy every forwarding header is attacker-controlled, so all
    // callers share one bucket rather than each minting their own.
    expect(
      withHops('0', () =>
        clientIpFromRequest(
          req({ 'x-forwarded-for': '9.9.9.9', 'cf-connecting-ip': '8.8.8.8' }),
        ),
      ),
    ).toBe('unknown');
  });

  it('defaults to trusting exactly one hop', () => {
    expect(
      withHops(undefined, () =>
        clientIpFromRequest(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })),
      ),
    ).toBe('203.0.113.7');
  });

  it('falls back to the left-most entry when the chain is shorter than configured', () => {
    // A misconfigured hop count must not produce `undefined`.
    expect(
      withHops('3', () => clientIpFromRequest(req({ 'x-forwarded-for': '203.0.113.7' }))),
    ).toBe('203.0.113.7');
  });

  it('returns a stable sentinel when no header is present at all', () => {
    expect(withHops('1', () => clientIpFromRequest(req({})))).toBe('unknown');
  });
});
