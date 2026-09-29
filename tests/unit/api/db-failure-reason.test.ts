import { describe, expect, it } from 'vitest';

import { dbFailureReason } from '@/lib/db/failure-reason';

describe('dbFailureReason', () => {
  it.each([
    ['getaddrinfo ENOTFOUND ep-x.neon.tech', 'dns'],
    ['connect ETIMEDOUT 1.2.3.4:5432', 'timeout'],
    ['connect ECONNREFUSED 127.0.0.1:5432', 'econnrefused-localhost'],
    ['connect ECONNREFUSED 10.0.0.5:5432', 'econnrefused-remote'],
    ['password authentication failed for user "x"', 'auth'],
    ['SSL connection is required', 'tls'],
    ['database "karo" does not exist', 'database-missing'],
    ['sorry, too many clients (53300)', 'connection-limit'],
    ['Your account or project has exceeded the compute time quota', 'quota'],
    ['The endpoint is disabled', 'suspended'],
    ['project is suspended', 'suspended'],
    ['something completely different', 'unknown'],
  ])('%s -> %s', (message, expected) => {
    expect(dbFailureReason(message)).toBe(expected);
  });

  it('never echoes the raw message', () => {
    expect(dbFailureReason('connect ECONNREFUSED secret-host.internal:5432')).not.toContain(
      'secret-host',
    );
  });
});
