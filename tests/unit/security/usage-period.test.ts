import { describe, expect, it } from 'vitest';

import { resolvePeriod } from '@/lib/usage/metering';

const DAY = 86_400_000;

/**
 * `resolvePeriod` used to fall through to the calendar month whenever the stored
 * subscription window had already ended — which is the normal state for the gap
 * between a renewal and the webhook that moves the dates forward. That minted a
 * brand-new `usage_periods` row, and therefore a **second full monthly
 * allowance**, at every renewal boundary.
 */
describe('resolvePeriod', () => {
  it('keeps a live subscription window exactly as stored', () => {
    const start = new Date(Date.now() - 5 * DAY);
    const end = new Date(Date.now() + 25 * DAY);
    expect(resolvePeriod(start, end)).toEqual({ periodStart: start, periodEnd: end });
  });

  it('rolls a lapsed window forward instead of granting a fresh allowance', () => {
    // One 30-day cycle stored, and we are 5 days into the *next* one.
    const start = new Date(Date.now() - 35 * DAY);
    const end = new Date(Date.now() - 5 * DAY);

    const period = resolvePeriod(start, end);

    // The window must be the next cycle of the same subscription, not a calendar
    // month — and it must contain now, so `ensurePeriod` reuses the same row for
    // the whole cycle.
    expect(period.periodStart.getTime()).toBe(end.getTime());
    expect(period.periodEnd.getTime()).toBe(end.getTime() + 30 * DAY);
    expect(period.periodStart.getTime()).toBeLessThanOrEqual(Date.now());
    expect(period.periodEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it('rolls forward by whole cycles when several have been missed', () => {
    const length = 30 * DAY;
    const start = new Date(Date.now() - 95 * DAY);
    const end = new Date(start.getTime() + length);

    const period = resolvePeriod(start, end);

    expect(period.periodEnd.getTime() - period.periodStart.getTime()).toBe(length);
    expect(period.periodStart.getTime()).toBeLessThanOrEqual(Date.now());
    expect(period.periodEnd.getTime()).toBeGreaterThan(Date.now());
    // Anchored to the subscription, so the offset is a whole number of cycles.
    expect((period.periodStart.getTime() - start.getTime()) % length).toBe(0);
  });

  it('is stable across calls, so the same row is reused', () => {
    const start = new Date(Date.now() - 35 * DAY);
    const end = new Date(Date.now() - 5 * DAY);
    expect(resolvePeriod(start, end).periodStart.getTime()).toBe(
      resolvePeriod(start, end).periodStart.getTime(),
    );
  });

  it('falls back to the calendar month with no subscription at all', () => {
    const period = resolvePeriod(null, null);
    expect(period.periodStart.getUTCDate()).toBe(1);
    expect(period.periodEnd.getUTCDate()).toBe(1);
    expect(period.periodEnd.getTime()).toBeGreaterThan(period.periodStart.getTime());
  });

  it('does not loop forever on a zero-length stored window', () => {
    const instant = new Date(Date.now() - DAY);
    const period = resolvePeriod(instant, instant);
    // Unusable input, so the calendar-month fallback applies.
    expect(period.periodStart.getUTCDate()).toBe(1);
  });
});
