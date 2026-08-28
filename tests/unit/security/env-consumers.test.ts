import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every configurable variable must be read by something.
 *
 * `AUTH_SECRET` was declared here, described as the session-cookie signing key,
 * documented as secret-manager material, and made a hard requirement for
 * production startup. Nothing read it. Sessions are random tokens stored as
 * SHA-256 digests, so no key signs them — meaning an operator who rotated
 * `AUTH_SECRET` to end every session ended none, and one who lacked it could not
 * deploy at all. `BYOS_TOKEN_SECRET` was the same, derived from it.
 *
 * A dead variable is not a tidiness problem. It is a control that lies about
 * what it does, and the security-shaped ones lie about security. This test makes
 * the next one fail here rather than in someone's threat model.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const ENV_FILE = join(ROOT, 'src', 'lib', 'env.ts');

/**
 * Variables whose only legitimate reader is `env.ts` itself, because they are
 * inputs to a value it derives rather than something the app consumes directly.
 * Each entry names what it feeds — an entry with no answer to that does not
 * belong here, it belongs deleted.
 */
const DERIVED_INSIDE_ENV: Record<string, string> = {
  KARO_DEMO_MODE: 'forces every provider to its mock; surfaces as DEMO_MODE',
  SANDBOX_PROVIDER: 'surfaces as RESOLVED_SANDBOX_PROVIDER',
  DOCKER_HOST: 'selects the Docker sandbox provider alongside DOCKER_SOCKET',
  AI_PROVIDER: 'resolved against configured credentials; surfaces as AI_PROVIDER',
  ENCRYPTION_KEY: 'validated here, then read through crypto/secrets.ts key()',
  NODE_ENV: 'gates the production requirements in this file',
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

describe('environment schema', () => {
  const envSource = readFileSync(ENV_FILE, 'utf8');

  // Only the zod schema object counts. The `ServerEnv` type below it repeats
  // some of those names and adds derived ones like `AI_PROVIDERS_CONFIGURED`,
  // which are outputs of this file rather than things an operator can set.
  const schemaBody = envSource.slice(
    envSource.indexOf('const serverSchema'),
    envSource.indexOf('export type ServerEnv'),
  );
  const schemaKeys = [
    // `z\b` rather than `z\.` because some entries wrap: `KEY: z\n  .enum(…)`.
    ...new Set(
      [...schemaBody.matchAll(/^ {2}([A-Z][A-Z0-9_]{2,}):\s*(?:z\b|int\(|bool\()/gm)].map(
        (m) => m[1]!,
      ),
    ),
  ];

  const files = sourceFiles(join(ROOT, 'src')).filter((f) => f !== ENV_FILE);
  const corpus = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('finds the schema', () => {
    expect(schemaKeys.length).toBeGreaterThan(20);
    expect(schemaKeys).toContain('DATABASE_URL');
  });

  it('has a consumer for every variable it accepts', () => {
    const orphans = schemaKeys.filter((key) => {
      if (key in DERIVED_INSIDE_ENV) return false;
      return !corpus.includes(`env.${key}`) && !corpus.includes(`process.env.${key}`);
    });

    expect(
      orphans,
      `These variables are parsed but nothing reads them. Either wire each one up or delete it — ` +
        `a setting that does nothing is a control that lies:\n  ${orphans.join('\n  ')}`,
    ).toEqual([]);
  });

  it('does not carry an exemption for a variable that no longer exists', () => {
    const stale = Object.keys(DERIVED_INSIDE_ENV).filter((key) => !schemaKeys.includes(key));
    expect(
      stale,
      `Exemptions left behind after the variable was removed: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('no longer accepts the secrets that were never read', () => {
    // Re-adding either without a reader would pass the orphan check only by way
    // of an exemption, which is exactly the argument this names as wrong.
    expect(schemaKeys).not.toContain('AUTH_SECRET');
    expect(schemaKeys).not.toContain('BYOS_TOKEN_SECRET');
  });
});
