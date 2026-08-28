import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetEnvCache } from '@/lib/env';

/**
 * Guards the outbound mail transport.
 *
 * The property worth protecting is not "mail gets sent" — it is that a failure
 * to send never degrades into writing the message to the server log. Verification
 * and password-reset links are single-use credentials, and a log line is the one
 * artefact that reliably ends up in an aggregator and in support threads. The
 * transport used to do exactly that fallback, so these tests exist to stop it
 * coming back.
 *
 * The second property is that mail misconfiguration is caught at boot rather
 * than at the first customer sign-up.
 */

const ORIGINAL = { ...process.env };

/**
 * The transport caches a pooled connection keyed by URL, and `env` caches the
 * parsed environment. Both have to be dropped between cases or the first case
 * decides the outcome of the rest.
 */
async function freshEmailModule() {
  __resetEnvCache();
  const mod = await import('@/lib/auth/email');
  mod.closeEmailTransport();
  return mod;
}

describe('outbound email transport', () => {
  beforeEach(() => {
    __resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    // NODE_ENV is typed read-only, so the production cases go through
    // `vi.stubEnv`; restoring the object above does not undo that.
    vi.unstubAllEnvs();
    __resetEnvCache();
  });

  describe('console transport', () => {
    it('reports delivery and surfaces the action link for the operator', async () => {
      process.env.EMAIL_TRANSPORT = 'console';
      const { sendEmail } = await freshEmailModule();

      const result = await sendEmail({
        to: 'a@b.test',
        subject: 'Confirm your email',
        text: 'https://example.test/verify?token=abc',
        html: '<p>x</p>',
      });

      expect(result).toMatchObject({ delivered: true, transport: 'console' });
    });

    it('is always considered healthy — it has nothing to reach', async () => {
      process.env.EMAIL_TRANSPORT = 'console';
      const { checkEmailTransport } = await freshEmailModule();

      expect(await checkEmailTransport()).toEqual({ transport: 'console', ok: true });
    });
  });

  describe('smtp transport', () => {
    it('rejects when SMTP_URL is missing instead of logging the link', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp';
      delete process.env.SMTP_URL;
      const { sendEmail } = await freshEmailModule();

      await expect(
        sendEmail({ to: 'a@b.test', subject: 's', text: 't', html: '<p>x</p>' }),
      ).rejects.toThrow(/SMTP_URL/);
    });

    it('rejects when the relay is unreachable instead of falling back', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp';
      // Port 1 is closed on every sane host, so this is a connection failure
      // rather than a configuration one.
      process.env.SMTP_URL = 'smtp://user:pass@127.0.0.1:1';
      const { sendEmail } = await freshEmailModule();

      await expect(
        sendEmail({ to: 'a@b.test', subject: 's', text: 't', html: '<p>x</p>' }),
      ).rejects.toThrow();
    });
  });

  describe('health reporting', () => {
    it('distinguishes "not configured" from "unreachable"', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp';
      delete process.env.SMTP_URL;
      const missing = await freshEmailModule();
      expect(await missing.checkEmailTransport()).toEqual({
        transport: 'smtp',
        ok: false,
        reason: 'not configured',
      });

      process.env.SMTP_URL = 'smtp://user:pass@127.0.0.1:1';
      const unreachable = await freshEmailModule();
      expect(await unreachable.checkEmailTransport()).toEqual({
        transport: 'smtp',
        ok: false,
        reason: 'relay unreachable',
      });
    });

    it('never puts the relay host or credentials in the reason', async () => {
      process.env.EMAIL_TRANSPORT = 'smtp';
      process.env.SMTP_URL = 'smtp://secret-user:secret-pass@mail.internal.test:1';
      const { checkEmailTransport } = await freshEmailModule();

      const status = await checkEmailTransport();
      const reason = status.reason ?? '';
      expect(reason).not.toContain('secret-user');
      expect(reason).not.toContain('secret-pass');
      expect(reason).not.toContain('mail.internal.test');
    });
  });

  describe('boot-time configuration checks', () => {
    it('refuses to start a production process on smtp without SMTP_URL', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      process.env.EMAIL_TRANSPORT = 'smtp';
      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
      delete process.env.SMTP_URL;
      // The production checks are skipped during `next build` on purpose.
      delete process.env.NEXT_PHASE;
      __resetEnvCache();

      const { assertEnv } = await import('@/lib/env');
      expect(() => assertEnv()).toThrow(/SMTP_URL/);
    });

    it('still builds with an empty environment — the build has no secrets', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      process.env.NEXT_PHASE = 'phase-production-build';
      process.env.EMAIL_TRANSPORT = 'smtp';
      delete process.env.SMTP_URL;
      delete process.env.ENCRYPTION_KEY;
      __resetEnvCache();

      const { assertEnv } = await import('@/lib/env');
      expect(() => assertEnv()).not.toThrow();
    });
  });
});
