import { describe, expect, it } from 'vitest';

import { databaseSsl } from '@/lib/db/ssl';

/**
 * The TLS decision has to survive a connection string pasted without its
 * query string: managed hosts refuse plaintext, and the failure surfaces as
 * a generic ping error on `/api/health`. Local dev URLs must stay plaintext.
 */
describe('databaseSsl', () => {
  it('upgrades a managed host pasted without a query string to TLS', () => {
    expect(databaseSsl('postgresql://user:pass@ep-x-pooler.c-4.us-east-2.aws.neon.tech/neondb')).toBe(
      'require',
    );
  });

  it('keeps localhost plaintext', () => {
    expect(databaseSsl('postgresql://karo:karo@localhost:5432/karo')).toBeUndefined();
    expect(databaseSsl('postgresql://karo:karo@127.0.0.1:5432/karo')).toBeUndefined();
  });

  it('keeps private-network hosts plaintext (dev databases on a LAN/VM)', () => {
    expect(databaseSsl('postgresql://karo:karo@172.22.141.215:5433/karo_test')).toBeUndefined();
    expect(databaseSsl('postgresql://karo:karo@10.0.0.5:5432/karo')).toBeUndefined();
    expect(databaseSsl('postgresql://karo:karo@192.168.1.10:5432/karo')).toBeUndefined();
    expect(databaseSsl('postgresql://karo:karo@postgres.internal:5432/karo')).toBeUndefined();
  });

  it('respects an explicit sslmode in the URL', () => {
    expect(
      databaseSsl('postgresql://user:pass@neon.example/neondb?sslmode=require'),
    ).toBe('require');
    expect(
      databaseSsl('postgresql://user:pass@neon.example/neondb?sslmode=disable'),
    ).toBeUndefined();
  });

  it('survives a value that is not a URL', () => {
    expect(databaseSsl('')).toBeUndefined();
    expect(databaseSsl('not a connection string')).toBeUndefined();
  });
});
