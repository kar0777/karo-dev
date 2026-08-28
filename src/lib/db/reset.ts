/**
 * Drops and recreates the public schema, then re-applies migrations.
 * Destructive — refuses to run against NODE_ENV=production.
 *
 * Run with `npm run db:reset`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { loadScriptEnv } from './load-env';

loadScriptEnv();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset is disabled when NODE_ENV=production');
  }

  const url = process.env.DATABASE_URL ?? 'postgresql://karo:karo@localhost:5432/karo';
  const client = postgres(url, { max: 1, onnotice: () => {} });

  console.log('▸ Dropping schema public …');
  await client.unsafe('drop schema if exists public cascade; create schema public;');
  await client.unsafe('drop schema if exists drizzle cascade;');

  console.log('▸ Re-applying migrations …');
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });

  console.log('✔ Database reset. Run `npm run db:seed` next.');
  await client.end();
}

main().catch((error) => {
  console.error('✖ Reset failed');
  console.error(error);
  process.exit(1);
});
