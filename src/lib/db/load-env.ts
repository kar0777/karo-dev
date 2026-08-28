/**
 * Env loading for the standalone database scripts (migrate / seed / reset).
 *
 * These run outside Next, so they load the dotenv files themselves. `.env.local`
 * has to win over `.env`, which needs `override: true` — but that flag also
 * overrides variables set on the command line, so
 *
 *     DATABASE_URL=…/karo_test npm run db:reset
 *
 * silently ignored the argument and operated on the *development* database
 * instead. For a script whose whole job is to drop and recreate tables, picking
 * the wrong database because the caller was explicit is the worst possible
 * failure. So an explicitly exported variable is captured first and restored
 * afterwards: shell beats `.env.local` beats `.env`.
 */
import { config } from 'dotenv';

/** Variables a caller may legitimately override per-invocation. */
const CLI_OVERRIDABLE = ['DATABASE_URL'] as const;

export function loadScriptEnv(): void {
  const fromShell = new Map<string, string>();
  for (const key of CLI_OVERRIDABLE) {
    const value = process.env[key];
    if (value !== undefined && value !== '') fromShell.set(key, value);
  }

  config({ path: '.env', quiet: true });
  config({ path: '.env.local', override: true, quiet: true });

  for (const [key, value] of fromShell) process.env[key] = value;
}
