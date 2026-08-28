import 'server-only';

/**
 * Every admin analytics screen is scoped to a trailing window. Keeping the
 * parsing here means the same `?days=` value means the same thing on the
 * overview, usage and cost pages — an operator comparing two tabs is never
 * comparing two different windows.
 */

export const PERIOD_OPTIONS = [7, 14, 30, 90] as const;

export type PeriodDays = (typeof PERIOD_OPTIONS)[number];

export const DEFAULT_PERIOD_DAYS: PeriodDays = 30;

export type Period = {
  days: PeriodDays;
  /** Inclusive start of the window, at midnight UTC. */
  from: Date;
  to: Date;
  /** The equally long window immediately before `from`, for deltas. */
  previousFrom: Date;
  label: string;
};

function isPeriodDays(value: number): value is PeriodDays {
  return (PERIOD_OPTIONS as readonly number[]).includes(value);
}

export function resolvePeriod(raw: string | string[] | undefined): Period {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(first ?? '', 10);
  const days: PeriodDays = isPeriodDays(parsed) ? parsed : DEFAULT_PERIOD_DAYS;

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const previousFrom = new Date(from.getTime() - days * 24 * 60 * 60 * 1000);

  return { days, from, to, previousFrom, label: `Last ${days} days` };
}

/** ISO `YYYY-MM-DD` keys for every day in the window, oldest first. */
export function dayKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  while (cursor.getTime() <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/** postgres returns bigint sums as strings; every aggregate goes through this. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
