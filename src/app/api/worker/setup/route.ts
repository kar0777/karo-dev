import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { defineHandler } from '@/lib/api/handler';
import { env } from '@/lib/env';

/**
 * Serves the one-command enrolment script for a user's own server.
 *
 * The reference install command used to be "download the agent, run it in the
 * foreground" — which tied the worker to the SSH session that installed it and
 * left every operator to improvise persistence (pm2, nohup, a unit file) on
 * their own, usually as root or not at all. This script does the whole
 * enrolment instead: agent into ~/.karo, one-shot token exchange, then a
 * service that survives terminal close and reboots — a systemd *user* unit on
 * Linux, a LaunchAgent on macOS, nohup + @reboot cron as the fallback. No step
 * needs root, because the whole design is outbound-only.
 *
 * The app URL is baked in as the default for `--url`, so the command the UI
 * shows carries exactly one argument: the token.
 *
 * Deliberately unauthenticated, like /api/worker/install: the script is the
 * published reference installer, carries no secret, and is meant to be read
 * before it is run. The token is what grants access and is minted separately,
 * per machine, and expires.
 */
export const GET = defineHandler({ auth: 'none', rateLimit: 'api.default' }, async () => {
  const source = await readFile(join(process.cwd(), 'worker', 'setup.sh'), 'utf8');
  const appUrl = env.APP_URL.replace(/\/+$/, '');

  return new Response(source.replaceAll('__KARO_APP_URL__', appUrl), {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'content-disposition': 'inline; filename="karo-setup.sh"',
      // The installer must match the deployment it enrols against; a cached
      // copy could point a new machine at a stale control plane.
      'cache-control': 'no-store',
    },
  });
});
