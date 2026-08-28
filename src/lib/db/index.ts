import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';
import * as schema from './schema';

/**
 * A single postgres.js pool per process. Next.js hot-reloads modules in dev,
 * so the client is stashed on `globalThis` to avoid exhausting connections.
 */
const globalForDb = globalThis as unknown as {
  __karoSql?: ReturnType<typeof postgres>;
};

function createClient() {
  return postgres(env.DATABASE_URL, {
    max: env.DATABASE_MAX_CONNECTIONS,
    ssl: env.DATABASE_SSL ? 'require' : undefined,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 15,
    onnotice: () => {},
    transform: { undefined: null },
  });
}

export const sql = globalForDb.__karoSql ?? createClient();
if (env.NODE_ENV !== 'production') globalForDb.__karoSql = sql;

export const db = drizzle(sql, { schema, casing: 'snake_case' });

export type Database = typeof db;
export { schema };
export * from './schema';

/** Cheap liveness probe used by `/api/health` and the admin dashboard. */
export async function pingDatabase(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    await sql`select 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
