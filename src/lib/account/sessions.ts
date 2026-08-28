import type { Session } from '@/lib/db/schema';

/**
 * Turns a session row into something a person recognises.
 *
 * No user-agent parsing library: the list only has to answer "is this me, or
 * should I revoke it?", and a browser plus an OS plus an IP answers that. The
 * matching is deliberately coarse and order-sensitive (Edge announces itself as
 * Chrome, Chrome announces itself as Safari).
 */

export type SessionView = {
  id: string;
  browser: string;
  os: string;
  deviceLabel: string;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

const BROWSERS: Array<[RegExp, string]> = [
  [/\bEdg[A-Z]?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bYaBrowser\//, 'Yandex Browser'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
  [/\bcurl\//, 'curl'],
  [/\bPostmanRuntime\//, 'Postman'],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/Windows NT 10\.0/, 'Windows'],
  [/Windows NT/, 'Windows'],
  [/\bAndroid\b/, 'Android'],
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

function match(list: Array<[RegExp, string]>, value: string, fallback: string): string {
  for (const [pattern, label] of list) {
    if (pattern.test(value)) return label;
  }
  return fallback;
}

export function describeSession(session: Session, currentSessionId: string): SessionView {
  const agent = session.userAgent ?? '';
  const browser = agent ? match(BROWSERS, agent, 'Unknown browser') : 'Unknown browser';
  const os = agent ? match(SYSTEMS, agent, 'Unknown system') : 'Unknown system';

  return {
    id: session.id,
    browser,
    os,
    deviceLabel: agent ? `${browser} on ${os}` : 'Unrecognised client',
    ipAddress: session.ipAddress,
    lastUsedAt: session.lastUsedAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    isCurrent: session.id === currentSessionId,
  };
}
