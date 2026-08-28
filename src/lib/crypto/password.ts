import 'server-only';

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Re-exported so the many server callers that expect the policy here keep
// working. Client code must import '@/lib/crypto/password-policy' directly —
// reaching it through this module would drag scrypt into the browser bundle,
// and the `server-only` above now turns that into a build error rather than a
// crash on hydration.
export { MIN_PASSWORD_LENGTH, scorePassword, type PasswordStrength } from './password-policy';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt password hashing.
 *
 * Chosen over bcrypt because it is memory-hard, and over argon2 because it ships
 * in Node's standard library — no native module to compile on Windows/Alpine,
 * which matters for a product that has to `npm install` cleanly everywhere.
 *
 * Parameters follow the OWASP 2024 baseline: N=2^16, r=8, p=1 (~64 MiB).
 * Format: `scrypt$N$r$p$<salt-b64>$<hash-b64>`
 */
const PARAMS = { N: 2 ** 16, r: 8, p: 1, keylen: 64 } as const;
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAXMEM,
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    const N = Number.parseInt(nRaw, 10);
    const r = Number.parseInt(rRaw, 10);
    const p = Number.parseInt(pRaw, 10);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(
      password.normalize('NFKC'),
      Buffer.from(saltB64, 'base64'),
      expected.length,
      { N, r, p, maxmem: MAXMEM },
    );
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash uses weaker parameters than the current baseline. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number.parseInt(parts[1]!, 10) < PARAMS.N;
}
