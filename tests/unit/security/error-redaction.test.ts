import { describe, expect, it } from 'vitest';

import { describeUnknown, redact } from '@/lib/observability/report';

/**
 * Guards the scrub that runs before an error leaves the process.
 *
 * `ERROR_WEBHOOK_URL` points at a third party by definition — Slack, a
 * collector, someone's Lambda. A stack trace is one of the likeliest places for
 * a credential to surface, because the argument that caused the failure is
 * usually in it, and in this codebase those arguments include provider API keys,
 * BYOS worker tokens, session ids and connection strings.
 *
 * These cases are the specific shapes Karo actually handles. A regression here
 * is silent and only discovered by someone else reading your incident channel.
 */

describe('error report redaction', () => {
  it('strips bearer tokens out of a message', () => {
    const out = redact('Request failed: Authorization Bearer abcdef1234567890xyz');
    expect(out).not.toContain('abcdef1234567890xyz');
    expect(out).toContain('[redacted]');
  });

  it('strips provider key shapes', () => {
    for (const key of [
      'sk-proj-AbCdEf123456789012',
      'sk_live_51AbCdEfGhIjKlMn',
      'ghp_AbCdEf1234567890AbCdEf',
      'xoxb-1234567890-AbCdEfGh',
    ]) {
      const out = redact(`upstream rejected the credential ${key}`);
      expect(out, `${key} must not survive`).not.toContain(key);
    }
  });

  it("strips Karo's own opaque credentials", () => {
    const out = redact('no session for sess_01ABCDEFGHIJKLMNOPQRS and byos_01ABCDEFGHIJKLMNOP');
    expect(out).not.toContain('01ABCDEFGHIJKLMNOPQRS');
    expect(out).not.toContain('01ABCDEFGHIJKLMNOP');
    // The prefix is kept: knowing which kind of credential failed is useful.
    expect(out).toContain('sess_[redacted]');
    expect(out).toContain('byos_[redacted]');
  });

  it('strips the password out of a connection string', () => {
    const out = redact(
      'connect ECONNREFUSED postgresql://karo:sup3rs3cret@db.internal:5432/karo',
    );
    expect(out).not.toContain('sup3rs3cret');
    // The user and host survive, which is what makes the error diagnosable.
    expect(out).toContain('//karo:[redacted]@db.internal');
  });

  it('strips the password out of an SMTP URL', () => {
    const out = redact('relay refused smtps://apikey:SG.abcdef123456@smtp.example.com:465');
    expect(out).not.toContain('SG.abcdef123456');
  });

  it('strips secrets named in key=value form', () => {
    for (const pair of [
      'password=hunter2trustme',
      'api_key: AbCdEf123456',
      'ENCRYPTION_KEY=bm90LWEtcmVhbC1rZXk=',
      'access-token = zzzzzzzzzzzz',
    ]) {
      const out = redact(`config rejected: ${pair}`);
      expect(out, `${pair} must be scrubbed`).toContain('[redacted]');
    }
  });

  it('leaves ordinary diagnostic text alone', () => {
    const message = 'Cannot read properties of undefined (reading "slug") at line 42';
    expect(redact(message)).toBe(message);
  });
});

describe('describeUnknown', () => {
  it('keeps the message, name and stack of a real Error', () => {
    const error = new TypeError('bad shape');
    const described = describeUnknown(error);
    expect(described.message).toBe('bad shape');
    expect(described.name).toBe('TypeError');
    expect(described.stack).toContain('TypeError');
  });

  it('falls back to the name when an Error carries no message', () => {
    expect(describeUnknown(new Error()).message).toBe('Error');
  });

  it('handles a thrown string, which third-party code still does', () => {
    expect(describeUnknown('everything is fine').message).toBe('everything is fine');
  });

  it('handles an error-shaped plain object', () => {
    const described = describeUnknown({ message: 'from a rejected promise', name: 'Weird' });
    expect(described.message).toBe('from a rejected promise');
    expect(described.name).toBe('Weird');
  });

  it('never returns an empty message, whatever was thrown', () => {
    for (const thrown of [null, undefined, 0, false, [], {}, Symbol('x')]) {
      expect(describeUnknown(thrown).message.length).toBeGreaterThan(0);
    }
  });
});
