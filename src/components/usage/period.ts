/**
 * Period selection shared by the usage page (Server Component), the header
 * controls (Client Component) and the CSV export link. Pure functions only —
 * no `server-only`, no `use client`, so both sides can import it.
 */

export type UsageRangeKey = '7' | '30' | '90' | 'period';

export const USAGE_RANGE_OPTIONS: ReadonlyArray<{
  value: UsageRangeKey;
  label: string;
  title: string;
}> = [
  { value: '7', label: '7d', title: 'Last 7 days' },
  { value: '30', label: '30d', title: 'Last 30 days' },
  { value: '90', label: '90d', title: 'Last 90 days' },
  { value: 'period', label: 'Period', title: 'Current billing period' },
];

const KEYS = new Set<string>(['7', '30', '90', 'period']);

export function parseRangeKey(raw: string | string[] | undefined): UsageRangeKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && KEYS.has(value) ? (value as UsageRangeKey) : '30';
}

/** Start of the selected window, normalised to midnight UTC for `7|30|90`. */
export function rangeStart(
  key: UsageRangeKey,
  periodStart: Date,
  now: Date = new Date(),
): Date {
  if (key === 'period') return periodStart;
  const days = Number.parseInt(key, 10);
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

export function rangeDescription(key: UsageRangeKey, periodEndIso: string): string {
  if (key === 'period') {
    const end = new Date(periodEndIso);
    const label = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(end);
    return `Current billing period, renews ${label}`;
  }
  return `Last ${key} days`;
}
