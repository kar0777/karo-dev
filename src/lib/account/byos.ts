import 'server-only';

import { sha256 } from '@/lib/crypto/secrets';
import { env } from '@/lib/env';
import { newToken } from '@/lib/ids';

/**
 * Bring-Your-Own-Server credentials.
 *
 * Two tokens, both stored as SHA-256 only:
 *
 *  · **Installation token** — single use, short lived. It is what the operator
 *    pastes into the install command, and the *only* moment Karo can show it.
 *    `POST /api/worker/register` burns it in exchange for the second token.
 *  · **Worker token** — long lived, sent as `Authorization: Bearer` on every
 *    poll, result, event and heartbeat. Rotating it invalidates the old one.
 *
 * Karo never holds an SSH key, an SSH password or an inbound port for the
 * user's machine: the worker dials out, so nothing about it is reachable from
 * here and there is no credential worth stealing from this database.
 *
 * The status vocabulary and its copy live in `./byos-shared`, which the
 * Settings Client Component imports directly — this module reads `env` and
 * hashes secrets, so it must never reach the browser bundle. The re-export
 * below keeps `@/lib/account/byos` a single import site for server callers.
 */

export {
  HEARTBEAT_STALE_MS,
  WORKER_STATUS_COPY,
  deriveWorkerStatus,
  toWorkerView,
  type WorkerLiveStatus,
  type WorkerView,
} from './byos-shared';

/** Long enough to walk to the server and paste a command, short enough to matter. */
export const INSTALL_TOKEN_TTL_MS = 60 * 60 * 1000;

export type MintedToken = {
  /** Plaintext. Returned to the caller exactly once and never persisted. */
  token: string;
  tokenHash: string;
};

export function mintInstallToken(): MintedToken & { expiresAt: Date } {
  const token = `kwi_${newToken(24)}`;
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + INSTALL_TOKEN_TTL_MS),
  };
}

export function mintWorkerToken(): MintedToken {
  const token = `kwt_${newToken(32)}`;
  return { token, tokenHash: sha256(token) };
}

export function hashWorkerToken(token: string): string {
  return sha256(token);
}

/**
 * The install one-liner. Kept here so the page, the dialog and the docs can
 * never drift into printing three different commands.
 *
 * It used to pipe `https://get.karo.dev/worker.sh` into a shell. That domain has
 * never existed, so the command every operator was told to paste on their server
 * failed at the first step. The agent now comes from this deployment's own
 * `/api/worker/install`, which is both reachable and one origin fewer to trust.
 *
 * It downloads and then runs, rather than piping into a shell: the agent is a
 * single auditable file, and asking someone to execute it on their own
 * infrastructure without a chance to read it first would undercut the point of
 * shipping it that way. `BYOS_INSTALL_SCRIPT_URL` still overrides, for an
 * operator who mirrors the agent somewhere of their own.
 */
export function buildInstallCommand(installToken: string): string {
  const appUrl = env.APP_URL.replace(/\/+$/, '');
  const mirrored = env.BYOS_INSTALL_SCRIPT_URL.trim();

  if (mirrored) {
    return `curl -fsSL ${mirrored} | sh -s -- --token ${installToken} --url ${appUrl}`;
  }

  return [
    `curl -fsSL ${appUrl}/api/worker/install -o karo-worker.mjs`,
    `node karo-worker.mjs --token ${installToken} --url ${appUrl}`,
  ].join(' && \\\n  ');
}
