/**
 * Applies pending SQL migrations from ./drizzle.
 * Run with `npm run db:migrate`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { loadScriptEnv } from './load-env';

loadScriptEnv();

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgresql://karo:karo@localhost:5432/karo';
  console.log(`▸ Migrating ${url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')}`);

  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  const started = Date.now();
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log(`✔ Migrations applied in ${Date.now() - started}ms`);

  await client.end();
}

main().catch((error) => {
  console.error('✖ Migration failed');
  console.error(error);
  process.exit(1);
});
