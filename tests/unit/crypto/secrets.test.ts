import { describe, expect, it } from 'vitest';

import {
  constantTimeEqual,
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  fingerprint,
  last4,
  maskSecret,
  redactKnownValues,
  REDACTED,
  redactSecrets,
  redactText,
  sha256,
  tryDecryptSecret,
} from '@/lib/crypto/secrets';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value', () => {
    const secret = 'sk-live-abcdef1234567890';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces a different ciphertext every time — the IV is random', () => {
    const a = encryptSecret('same input');
    const b = encryptSecret('same input');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('writes a versioned envelope so the algorithm can be rotated later', () => {
    const parts = encryptSecret('x').split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('never leaves the plaintext visible in the envelope', () => {
    const envelope = encryptSecret('super-secret-value');
    expect(envelope).not.toContain('super-secret-value');
  });

  it('round-trips unicode and long values', () => {
    const unicode = 'ключ-🔐-日本語';
    expect(decryptSecret(encryptSecret(unicode))).toBe(unicode);
    const long = 'a'.repeat(20_000);
    expect(decryptSecret(encryptSecret(long))).toBe(long);
  });

  it('rejects a tampered ciphertext — GCM authenticates it', () => {
    const envelope = encryptSecret('important');
    const [v, iv, tag, data] = envelope.split(':');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    const tampered = [v, iv, tag, flipped.toString('base64')].join(':');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects a malformed envelope', () => {
    expect(() => decryptSecret('not-an-envelope')).toThrow('Malformed secret envelope');
    expect(() => decryptSecret('v2:a:b:c')).toThrow('Malformed secret envelope');
  });

  it('tryDecryptSecret returns null instead of throwing', () => {
    expect(tryDecryptSecret('garbage')).toBeNull();
    expect(tryDecryptSecret(null)).toBeNull();
    expect(tryDecryptSecret(undefined)).toBeNull();
    expect(tryDecryptSecret(encryptSecret('ok'))).toBe('ok');
  });

  it('round-trips structured data', () => {
    const value = { token: 'abc', nested: { list: [1, 2, 3] } };
    expect(decryptJson<typeof value>(encryptJson(value))).toEqual(value);
  });
});

describe('fingerprint', () => {
  it('is stable for the same input', () => {
    expect(fingerprint('sk-abc')).toBe(fingerprint('sk-abc'));
  });

  it('differs for different inputs', () => {
    expect(fingerprint('sk-abc')).not.toBe(fingerprint('sk-abd'));
  });

  it('does not reveal the input', () => {
    const fp = fingerprint('sk-live-verysecret');
    expect(fp).not.toContain('verysecret');
    expect(fp).toHaveLength(32);
  });
});

describe('constantTimeEqual', () => {
  it('matches identical strings', () => {
    expect(constantTimeEqual('token-abc', 'token-abc')).toBe(true);
  });

  it('rejects different strings, including different lengths', () => {
    expect(constantTimeEqual('token-abc', 'token-abd')).toBe(false);
    expect(constantTimeEqual('short', 'much-longer-value')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});

describe('masking', () => {
  it('shows only the last four characters', () => {
    expect(last4('sk-live-1234567890abcd')).toBe('abcd');
    expect(last4('ab')).toBe('ab');
  });

  it('masks the middle of a key for display', () => {
    const masked = maskSecret('sk-live-1234567890abcd');
    expect(masked.startsWith('sk-')).toBe(true);
    expect(masked.endsWith('abcd')).toBe(true);
    expect(masked).not.toContain('1234567890');
  });

  it('fully masks a short value rather than revealing most of it', () => {
    expect(maskSecret('abc123')).toBe('••••••••');
  });
});

describe('redactText', () => {
  const cases: Array<[string, string]> = [
    ['OpenAI-style key', 'Here is my key sk-proj-abcdefghijklmnop1234 ok'],
    ['Stripe secret', 'STRIPE=sk_live_51ABCdefGHIjklMNOpqrST'],
    ['Stripe webhook', 'whsec_abcdefghijklmnopqrstuvwx'],
    ['GitHub PAT', 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'],
    ['Slack token', 'xoxb-123456789012-abcdefghijklm'],
    ['AWS key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['Telegram bot token', '1234567890:AAFakeTokenValueThatIsLongEnough123456'],
  ];

  it.each(cases)('removes a %s', (_name, text) => {
    expect(redactText(text)).toContain(REDACTED);
  });

  it('removes a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactText(`Authorization: Bearer ${jwt}`)).toContain(REDACTED);
  });

  it('removes a private key block', () => {
    const key =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    expect(redactText(key)).toBe(REDACTED);
  });

  it('removes KEY=value shapes with a secret-looking name', () => {
    const redacted = redactText('DATABASE_PASSWORD=hunter2 OTHER=fine');
    expect(redacted).toContain(REDACTED);
    expect(redacted).not.toContain('hunter2');
    expect(redacted).toContain('OTHER=fine');
  });

  it('leaves ordinary text alone', () => {
    const text = 'Build succeeded in 4.1s. 3 tests passed.';
    expect(redactText(text)).toBe(text);
  });
});

describe('redactSecrets', () => {
  it('redacts by key name', () => {
    const result = redactSecrets({
      apiKey: 'sk-abc',
      password: 'hunter2',
      authorization: 'Bearer xyz',
      username: 'ada',
    });
    expect(result.apiKey).toBe(REDACTED);
    expect(result.password).toBe(REDACTED);
    expect(result.authorization).toBe(REDACTED);
    expect(result.username).toBe('ada');
  });

  it('recurses into nested objects and arrays', () => {
    const result = redactSecrets({
      outer: { inner: { secret: 'x' }, list: [{ token: 'y' }, { safe: 'z' }] },
    });
    expect(result.outer.inner.secret).toBe(REDACTED);
    expect(result.outer.list[0]!.token).toBe(REDACTED);
    expect(result.outer.list[1]!.safe).toBe('z');
  });

  it('redacts secret-shaped values even under an innocent key name', () => {
    const result = redactSecrets({ note: 'my key is sk-proj-abcdefghijklmnop1234' });
    expect(result.note).toContain(REDACTED);
  });

  it('handles null, undefined and primitives without throwing', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
  });

  it('stops at a depth limit rather than recursing forever', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(() => redactSecrets(deep)).not.toThrow();
  });
});

describe('redactKnownValues', () => {
  it('removes a configured secret wherever it appears in tool output', () => {
    const output = 'TELEGRAM_BOT_TOKEN=abcdef123456\nconnecting with abcdef123456 …';
    const cleaned = redactKnownValues(output, ['abcdef123456']);
    expect(cleaned).not.toContain('abcdef123456');
    expect(cleaned.split(REDACTED).length - 1).toBe(2);
  });

  it('ignores values too short to be secrets, to avoid mangling output', () => {
    expect(redactKnownValues('port 3000 is open', ['3000'])).toBe('port 3000 is open');
  });

  it('is a no-op with no known secrets', () => {
    expect(redactKnownValues('plain output', [])).toBe('plain output');
  });
});

describe('sha256', () => {
  it('produces a stable 64-character hex digest', () => {
    const digest = sha256('token');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('token')).toBe(digest);
    expect(sha256('token2')).not.toBe(digest);
  });
});
