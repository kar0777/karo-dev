import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authorizeCronOrAdmin, hasCronSecret } from '@/lib/api/cron-auth';

/**
 * Cron endpoint authorisation.
 *
 * These endpoints are the only trigger for behaviour the product sells — idle
 * sandboxes going to sleep, balances refilling, scheduled downgrades landing —
 * and every one of them was originally written so that the scheduler it exists
 * for could not call it. The blanket CSRF check ran first, and `curl` sends no
 * `Origin`, no `Referer` and no session token, so the cron line printed in each
 * route's own doc comment returned 403.
 *
 * The scheduler path must therefore be provable without a browser: a correct
 * bearer token is accepted on its own, and nothing else is.
 */

const SECRET = 'cron-secret-value-for-tests';

function post(headers: Record<string, string> = {}): Request {
  return new Request('https://karo.test/api/cron/billing/auto-topup', {
    method: 'POST',
    headers,
  });
}

let original: string | undefined;

beforeEach(() => {
  original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe('hasCronSecret', () => {
  it('accepts the exact bearer token', () => {
    expect(hasCronSecret(post({ authorization: `Bearer ${SECRET}` }))).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    const wrong = 'x'.repeat(SECRET.length);
    expect(wrong).toHaveLength(SECRET.length);
    expect(hasCronSecret(post({ authorization: `Bearer ${wrong}` }))).toBe(false);
  });

  it('rejects a token that is merely a prefix, despite the length guard', () => {
    expect(hasCronSecret(post({ authorization: `Bearer ${SECRET.slice(0, 8)}` }))).toBe(false);
  });

  it('rejects a token with trailing padding', () => {
    expect(hasCronSecret(post({ authorization: `Bearer ${SECRET}extra` }))).toBe(false);
  });

  it('rejects the raw secret without the Bearer scheme', () => {
    expect(hasCronSecret(post({ authorization: SECRET }))).toBe(false);
  });

  it('rejects a request with no authorization header at all', () => {
    expect(hasCronSecret(post())).toBe(false);
  });

  it('rejects every caller when CRON_SECRET is unset, rather than accepting an empty token', () => {
    delete process.env.CRON_SECRET;
    expect(hasCronSecret(post({ authorization: 'Bearer ' }))).toBe(false);
    expect(hasCronSecret(post({ authorization: 'Bearer undefined' }))).toBe(false);
    expect(hasCronSecret(post())).toBe(false);
  });
});

describe('authorizeCronOrAdmin', () => {
  it('admits a scheduler that sends nothing but the bearer token', async () => {
    // The regression, stated as an assertion: no Origin, no Referer, no session
    // and no CSRF header — exactly what `curl` sends — must still get through.
    await expect(
      authorizeCronOrAdmin(post({ authorization: `Bearer ${SECRET}` })),
    ).resolves.toBe('scheduler');
  });

  it('does not fall through to the browser path on a correct token', async () => {
    // If the scheduler branch ever stops short-circuiting, this call reaches
    // assertCsrf/requireApiPlatformAdmin and throws instead of returning.
    const outcome = await authorizeCronOrAdmin(
      post({ authorization: `Bearer ${SECRET}`, 'user-agent': 'curl/8.6.0' }),
    );
    expect(outcome).toBe('scheduler');
  });

  it('refuses a browser-shaped request that carries no proof at all', async () => {
    await expect(authorizeCronOrAdmin(post())).rejects.toThrow();
  });

  it('refuses a cross-site POST that guesses the endpoint', async () => {
    await expect(
      authorizeCronOrAdmin(post({ origin: 'https://evil.example' })),
    ).rejects.toThrow();
  });
});
