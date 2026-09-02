import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Karo uses prefixed, sortable, URL-safe identifiers. The prefix makes IDs
 * self-describing in logs and audit trails ("which table is `sbx_...`?") and
 * makes it impossible to accidentally pass a project ID where a sandbox ID is
 * expected during code review.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, no i/l/o/u

export const ID_PREFIX = {
  user: 'usr',
  account: 'acc',
  session: 'ses',
  team: 'team',
  teamMember: 'tmb',
  invitation: 'inv',
  project: 'prj',
  projectFile: 'pfl',
  conversation: 'cnv',
  message: 'msg',
  attachment: 'att',
  agentRun: 'run',
  toolCall: 'tc',
  sandbox: 'sbx',
  sandboxSession: 'sbs',
  terminalSession: 'trm',
  provider: 'prv',
  model: 'mdl',
  modelPrice: 'mpr',
  userApiKey: 'uak',
  mcpServer: 'mcp',
  mcpTool: 'mct',
  skill: 'skl',
  installedSkill: 'isk',
  plugin: 'plg',
  installedPlugin: 'ipl',
  plan: 'pln',
  subscription: 'sub',
  paygBalance: 'bal',
  topup: 'top',
  usageEvent: 'uev',
  usageReservation: 'ures',
  computeEvent: 'cev',
  invoice: 'inv2',
  auditEvent: 'aud',
  notification: 'ntf',
  adminSetting: 'set',
  worker: 'wkr',
  incident: 'inc',
  task: 'tsk',
  coupon: 'cpn',
  couponRedemption: 'cpr',
  cliTool: 'clt',
  cliInstall: 'cli',
} as const;

export type IdPrefixKey = keyof typeof ID_PREFIX;
export type IdPrefixValue = (typeof ID_PREFIX)[IdPrefixKey];

/**
 * Accepts either the table name (`'projectFile'`) or the literal prefix
 * (`'pfl'`). Call sites read better with the table name; internal code that
 * already holds a prefix does not have to reverse-map it.
 */
export type IdPrefix = IdPrefixKey | IdPrefixValue;

function randomChars(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/**
 * Time-prefixed random ID: `<prefix>_<10 char time><12 char random>`.
 * Lexicographic order matches creation order, which keeps btree indexes tight.
 */
export function newId(prefix: IdPrefix): string {
  const resolved = (ID_PREFIX as Record<string, string>)[prefix] ?? prefix;
  let time = Date.now();
  let timePart = '';
  for (let i = 0; i < 10; i += 1) {
    timePart = ALPHABET[time % ALPHABET.length] + timePart;
    time = Math.floor(time / ALPHABET.length);
  }
  return `${resolved}_${timePart}${randomChars(12)}`;
}

/** Opaque high-entropy token (session tokens, install tokens, API keys). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Human-readable short code, e.g. for invitations. */
export function newShortCode(length = 8): string {
  return randomChars(length).toUpperCase();
}

export function newUuid(): string {
  return randomUUID();
}

export function hasPrefix(id: string, prefix: IdPrefix): boolean {
  const resolved = (ID_PREFIX as Record<string, string>)[prefix] ?? prefix;
  return id.startsWith(`${resolved}_`);
}
