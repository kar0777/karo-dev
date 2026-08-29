/**
 * Upserts the provider registry (PROVIDER_SEEDS) into the `providers` table —
 * nothing else. Run with `npm run db:providers`.
 *
 * Models, plans, prices and everything else the full seed manages are NOT
 * touched: this exists so a deployment can gain a new provider (and therefore
 * Admin → Models sync, the BYOK key dialog and catalogue discovery for it)
 * from CI after each push, without the operator re-running the whole seed —
 * which would be the alternative, and which an operator rightly hesitates to
 * point at a database holding real accounts.
 *
 * Enabled providers the seeds no longer know about are left alone, not
 * disabled: removing a descriptor is a code decision, and a hosted install
 * should not lose its configured providers behind its back.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { PROVIDER_SEEDS } from './seed-data/models';
import { providers } from './schema';
import { ID_PREFIX, newId } from '../ids';
import { loadScriptEnv } from './load-env';

loadScriptEnv();

async function main() {
  const url = process.env.DATABASE_URL ?? 'postgresql://karo:karo@localhost:5432/karo';
  console.log(`▸ Syncing providers to ${url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')}`);

  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);

  const started = Date.now();
  let inserted = 0;
  let updated = 0;

  for (const seed of PROVIDER_SEEDS) {
    const result = await db
      .insert(providers)
      .values({
        ...seed,
        id: newId(ID_PREFIX.provider),
        baseUrl: seed.baseUrl ?? null,
      })
      .onConflictDoUpdate({
        target: providers.key,
        set: {
          name: seed.name,
          kind: seed.kind ?? 'model',
          baseUrl: seed.baseUrl ?? null,
          catalogUrl: seed.catalogUrl ?? null,
          isEnabled: true,
          metadata: seed.metadata ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ createdAt: providers.createdAt, updatedAt: providers.updatedAt });

    // `createdAt === updatedAt` only on the row this statement created.
    const row = result[0];
    if (row && row.createdAt.getTime() === row.updatedAt.getTime()) inserted += 1;
    else updated += 1;
  }

  console.log(
    `✔ Providers synced in ${Date.now() - started}ms: ${inserted} added, ${updated} verified`,
  );

  await client.end();
}

main().catch((error) => {
  console.error('✖ Provider sync failed');
  console.error(error);
  process.exit(1);
});
