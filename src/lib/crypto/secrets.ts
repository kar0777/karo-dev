import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { env } from '@/lib/env';

/**
 * Envelope format: `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>`
 *
 * AES-256-GCM with a random 12-byte IV per record. The version prefix lets us
 * rotate the algorithm later without a destructive migration: `decrypt` can
 * dispatch on it while `encrypt` always writes the newest version.
 */
const VERSION = 'v1';
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.ENCRYPTION_KEY;

  // Accept raw base64 (preferred) or any passphrase, normalised to 32 bytes.
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    buf = Buffer.from(raw, 'utf8');
  }
  if (buf.length !== 32) {
    buf = createHash('sha256').update(raw, 'utf8').digest();
  }
  cachedKey = buf;
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed secret envelope');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Returns null instead of throwing — used when rendering possibly-stale rows. */
export function tryDecryptSecret(envelope: string | null | undefined): string | null {
  if (!envelope) return null;
  try {
    return decryptSecret(envelope);
  } catch {
    return null;
  }
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(envelope: string): T {
  return JSON.parse(decryptSecret(envelope)) as T;
}

/* ------------------------------------------------------------------ *
 *  Hashing & comparison
 * ------------------------------------------------------------------ */

/** SHA-256 hex. Used for session/invite/worker token lookups. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Stable, non-reversible fingerprint of a credential. Lets us detect "you
 * already added this key" without ever comparing plaintext.
 */
export function fingerprint(input: string): string {
  return createHmac('sha256', key()).update(input, 'utf8').digest('hex').slice(0, 32);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length is not a timing oracle.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function last4(secret: string): string {
  return secret.length <= 4 ? secret : secret.slice(-4);
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 3)}${'•'.repeat(8)}${secret.slice(-4)}`;
}

/* ------------------------------------------------------------------ *
 *  Redaction
 * ------------------------------------------------------------------ */

const SECRET_KEY_PATTERN =
  /^(.*(password|passwd|secret|token|api[-_]?key|apikey|authorization|auth|credential|private[-_]?key|session|cookie|bearer|access[-_]?key|client[-_]?secret|encryption).*)$/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-compatible keys
  /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/g, // Stripe secret keys
  /\bwhsec_[A-Za-z0-9]{16,}\b/g, // Stripe webhook secrets
  /\bghp_[A-Za-z0-9]{20,}\b/g, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\b\d{9,10}:AA[A-Za-z0-9_-]{30,}\b/g, // Telegram bot token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export const REDACTED = '[redacted]';

/**
 * Removes credential-looking substrings from free text. Applied to every audit
 * log entry, every tool result surfaced to the model, and every server log line.
 */
export function redactText(input: string): string {
  let out = input;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  // `KEY=value` and `KEY: value` shapes with a secret-looking name.
  out = out.replace(
    /\b([A-Z0-9_]{0,32}(?:PASSWORD|SECRET|TOKEN|API_KEY|APIKEY|CREDENTIAL|PRIVATE_KEY))\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    (_m, name: string) => `${name}=${REDACTED}`,
  );
  return out;
}

/** Deep-redacts an object graph by key name and by value shape. */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as unknown as T;
  if (value == null) return value;

  if (typeof value === 'string') return redactText(value) as unknown as T;
  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactSecrets(v, depth + 1);
    }
  }
  return out as unknown as T;
}

/**
 * Redacts a specific set of known secret values wherever they appear.
 * Used before returning sandbox/tool output to the model, so an injected
 * `env | grep` can never exfiltrate a configured credential.
 */
export function redactKnownValues(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    out = out.split(secret).join(REDACTED);
  }
  return out;
}
