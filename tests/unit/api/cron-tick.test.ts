import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncProviderCatalogs } from '@/lib/ai/catalog-sync';
import { applyDuePlanChanges } from '@/lib/billing/plan-changes';
import { sweepAutoTopups } from '@/lib/billing/auto-topup';
import { sweepIdleSandboxes } from '@/lib/sandbox/service';
import { sweepStaleWorkerCommands } from '@/lib/sandbox/worker-bus';
import { GET } from '@/app/api/cron/tick/route';

/**
 * The consolidated maintenance tick.
 *
 * Free hosting tiers cap how many cron entries a project may define, so the
 * periodic sweeps collapse into one endpoint. The contract under test: a
 * scheduler with only a bearer token gets every sweep run, one sweep failing
 * never stops the others, and the response says exactly which ones did —
 * with a 500 reserved for the single outcome worth paging on, everything
 * having failed.
 */

vi.mock('@/lib/ai/catalog-sync', () => ({ syncProviderCatalogs: vi.fn() }));
vi.mock('@/lib/billing/auto-topup', () => ({ sweepAutoTopups: vi.fn() }));
vi.mock('@/lib/billing/plan-changes', () => ({ applyDuePlanChanges: vi.fn() }));
vi.mock('@/lib/sandbox/service', () => ({ sweepIdleSandboxes: vi.fn() }));
vi.mock('@/lib/sandbox/worker-bus', () => ({ sweepStaleWorkerCommands: vi.fn() }));

// The route runs through defineHandler, whose audit step would write to the
// database; the tick's audit record is not what these tests are about.
vi.mock('@/lib/audit', () => ({
  AUDIT_ACTIONS: { cronTick: 'cron.tick' },
  recordAudit: vi.fn(async () => {}),
}));

const SECRET = 'cron-secret-value-for-tests';

/**
 * `defineHandler` reads `req.nextUrl` and awaits the route segment context,
 * so the call needs a NextRequest and a `params` promise, exactly what Next
 * itself passes.
 */
async function call(headers: Record<string, string> = {}): Promise<Response> {
  const request = new NextRequest('https://karo.test/api/cron/tick', {
    method: 'GET',
    headers,
  });
  return GET(request, { params: Promise.resolve({}) });
}

let original: string | undefined;

beforeEach(() => {
  original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  vi.mocked(sweepIdleSandboxes).mockResolvedValue({ slept: ['sbx_1'], destroyed: [] });
  vi.mocked(sweepAutoTopups).mockResolvedValue({
    considered: 2,
    charged: ['team_1'],
    failed: [],
  });
  vi.mocked(applyDuePlanChanges).mockResolvedValue({
    applied: ['sub_1'],
    dropped: [],
    failed: [],
  });
  vi.mocked(syncProviderCatalogs).mockResolvedValue({
    syncedProviders: 2,
    changes: [],
    errors: [],
    syncedAt: new Date(),
  });
  vi.mocked(sweepStaleWorkerCommands).mockResolvedValue({ reaped: 0 });
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
  vi.resetAllMocks();
});

describe('GET /api/cron/tick', () => {
  it('runs every sweep for a scheduler that sends only the bearer token', async () => {
    const response = await call({ authorization: `Bearer ${SECRET}` });
    const body = (await response.json()) as {
      ok: boolean;
      caller: string;
      jobs: { name: string; ok: boolean }[];
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.caller).toBe('scheduler');
    expect(body.jobs.map((job) => job.name)).toEqual([
      'sandbox-sweep',
      'billing-auto-topup',
      'billing-apply-pending',
      'catalog-sync',
      'worker-command-reaper',
    ]);
    expect(body.jobs.every((job) => job.ok)).toBe(true);
  });

  it('passes onlyConfigured to the catalogue sync so dormant providers stay quiet', async () => {
    await call({ authorization: `Bearer ${SECRET}` });

    expect(vi.mocked(syncProviderCatalogs)).toHaveBeenCalledWith({ onlyConfigured: true });
  });

  it('keeps the remaining sweeps running when one fails, and says which', async () => {
    vi.mocked(applyDuePlanChanges).mockRejectedValue(new Error('billing queue unreachable'));

    const response = await call({ authorization: `Bearer ${SECRET}` });
    const body = (await response.json()) as {
      ok: boolean;
      jobs: { name: string; ok: boolean; error?: string }[];
    };

    // One sweep down is a partial failure, not a platform outage — the tick
    // must not look like a page-worthy 500 to the scheduler.
    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.jobs.find((job) => job.name === 'billing-apply-pending')).toMatchObject({
      ok: false,
      error: 'billing queue unreachable',
    });
    expect(body.jobs.find((job) => job.name === 'sandbox-sweep')).toMatchObject({ ok: true });
  });

  it('returns 500 only when every sweep failed', async () => {
    vi.mocked(sweepIdleSandboxes).mockRejectedValue(new Error('db down'));
    vi.mocked(sweepAutoTopups).mockRejectedValue(new Error('db down'));
    vi.mocked(applyDuePlanChanges).mockRejectedValue(new Error('db down'));
    vi.mocked(syncProviderCatalogs).mockRejectedValue(new Error('db down'));
    vi.mocked(sweepStaleWorkerCommands).mockRejectedValue(new Error('db down'));

    const response = await call({ authorization: `Bearer ${SECRET}` });

    expect(response.status).toBe(500);
  });

  it('refuses a caller with neither a bearer token nor an admin session', async () => {
    delete process.env.CRON_SECRET;

    const response = await call();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
