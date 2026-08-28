import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ *
 *  Formatting
 * ------------------------------------------------------------------ */

const NBSP = ' ';

/** `1234567` → `1.23M`. Used everywhere token counts appear. */
export function formatCompactNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  const units = [
    { v: 1e12, s: 'T' },
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' },
  ];
  for (const u of units) {
    if (abs >= u.v) {
      const scaled = value / u.v;
      const fixed = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(digits);
      return `${Number.parseFloat(fixed)}${u.s}`;
    }
  }
  return String(value);
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

/**
 * Money is stored as integer micro-USD (1e-6 USD) everywhere in Karo so that
 * per-token costs never lose precision. This renders it for humans.
 */
export function formatMicroUsd(
  microUsd: number,
  opts: { precise?: boolean; sign?: boolean } = {},
): string {
  if (!Number.isFinite(microUsd)) return '—';
  const usd = microUsd / 1_000_000;
  const abs = Math.abs(usd);
  let digits: number;
  if (opts.precise) digits = abs < 0.01 ? 6 : 4;
  else if (abs === 0) digits = 2;
  else if (abs < 0.01) digits = 4;
  else digits = 2;

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits > 2 ? 2 : digits,
    maximumFractionDigits: digits,
  }).format(usd);

  if (opts.sign && usd > 0) return `+${formatted}`;
  return formatted;
}

export function formatUsdCents(cents: number): string {
  return formatMicroUsd(cents * 10_000);
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : digits)}${NBSP}${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m${NBSP}${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h${NBSP}${rm}m`;
  const d = Math.floor(h / 24);
  return `${d}d${NBSP}${h % 24}h`;
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}${NBSP}min`;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}${NBSP}h`;
}

export function formatRelativeTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  const diff = d.getTime() - Date.now();
  const absSec = Math.abs(diff) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const table: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 3600],
    ['hour', 86400],
    ['day', 604800],
    ['week', 2629800],
    ['month', 31557600],
  ];
  let prev = 1;
  for (const [unit, limit] of table) {
    if (absSec < limit) return rtf.format(Math.round(diff / 1000 / prev), unit);
    prev = limit;
  }
  return rtf.format(Math.round(diff / 1000 / 31557600), 'year');
}

export function formatDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function formatDate(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(d);
}

export function formatPercent(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/* ------------------------------------------------------------------ *
 *  Small helpers
 * ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function groupBy<T, K extends string | number>(
  items: readonly T[],
  key: (item: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}

export function sumBy<T>(items: readonly T[], value: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += value(item);
  return total;
}

export function uniqueBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Case-insensitive subsequence match — powers the slash-command palette. */
export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) qi += 1;
  }
  return qi === q.length;
}

/**
 * Ranks a fuzzy match. Higher is better; `-1` means no match.
 * Prefix matches and word-boundary hits rank above scattered matches.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;

  let score = 0;
  let qi = 0;
  let lastIndex = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] !== q[qi]) continue;
    score += 10;
    if (lastIndex === ti - 1) score += 8; // consecutive
    if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' || t[ti - 1] === '/') score += 12;
    lastIndex = ti;
    qi += 1;
  }
  if (qi < q.length) return -1;
  return score - t.length * 0.2;
}

export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** Detects the platform for rendering ⌘ vs Ctrl in shortcut hints. */
export function isAppleDevice(): boolean {
  if (!isBrowser()) return false;
  return /Mac|iPhone|iPad|iPod/.test(window.navigator.platform ?? '');
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
