/**
 * One-off: catalogue discovery using the operator's own BYOK keys.
 *
 * The platform has no model keys of its own on this install — they live as the
 * admin's personal entries. This script decrypts those entries (the operator's
 * ENCRYPTION_KEY must be in the environment), runs the same sync the admin
 * button runs, prunes the alias rows discovery picks up from resellers, and
 * prices + enables the models whose tariff is known. Unknown arrivals stay
 * disabled for the operator to price in Admin → Models.
 *
 * Run: ENCRYPTION_KEY=… DATABASE_URL=… npx tsx --tsconfig ./tsconfig.scripts.json scripts/discover-now.ts
 */
import postgres from 'postgres';

import { syncProviderCatalogs, type ByokCredential } from '@/lib/ai/catalog-sync';
import { decryptSecret } from '@/lib/crypto/secrets';
import { MODEL_PRICE_SEEDS } from '@/lib/db/seed-data/models';

const url = process.env.DATABASE_URL;
const encryptionKey = process.env.ENCRYPTION_KEY;
if (!url || !encryptionKey) {
  console.error('✖ DATABASE_URL and ENCRYPTION_KEY are both required');
  process.exit(1);
}

/** Reseller routing aliases: never catalogue entries. */
const ALIAS_DENYLIST = new Set([
  'default',
  'coding',
  'default-anthropic',
  'coding-anthropic',
  'kimi-k2.5',
  'kimi-k2.5-anthropic',
]);

/** Tariffs for arrivals whose provider publishes no prices. */
const KNOWN_PRICES: Record<string, { in: number; out: number; cached: number; write: number }> = {
  'kimi-k3-anthropic': { in: 3_000_000, out: 15_000_000, cached: 300_000, write: 3_750_000 },
  'kimi-k3': { in: 3_000_000, out: 15_000_000, cached: 300_000, write: 3_750_000 },
  'kimi-k2.6-anthropic': { in: 650_000, out: 3_410_000, cached: 650_000, write: 650_000 },
  'kimi-k2.6': { in: 650_000, out: 3_410_000, cached: 650_000, write: 650_000 },
  'zai-org/GLM-5.3': { in: 900_000, out: 2_800_000, cached: 900_000, write: 900_000 },
  'zai-org/GLM-5.3-Flash': { in: 100_000, out: 400_000, cached: 100_000, write: 100_000 },
  'glm-5.3': { in: 1_120_000, out: 3_520_000, cached: 112_000, write: 1_400_000 },
  'tencent/HY4-Preview': { in: 700_000, out: 2_800_000, cached: 700_000, write: 700_000 },
  'Qwen/Qwen3.8-Max': { in: 1_100_000, out: 4_400_000, cached: 1_100_000, write: 1_100_000 },
  'Qwen/Qwen3.8-Flash': { in: 30_000, out: 130_000, cached: 30_000, write: 30_000 },
  'Qwen/Qwen3.8-Flash-Next': { in: 30_000, out: 130_000, cached: 30_000, write: 30_000 },
  'Qwen/Qwen3.8-27B': { in: 150_000, out: 600_000, cached: 150_000, write: 150_000 },
};

async function main() {
  const client = postgres(url!, { max: 1 });
  await client`select 1`;

  const keyRows = await client`
    select provider_key, key_ciphertext, base_url
    from user_api_keys where is_active = true`;
  const credentials = new Map<string, ByokCredential>();
  for (const row of keyRows) {
    if (credentials.has(row.provider_key)) continue;
    try {
      credentials.set(row.provider_key, {
        apiKey: decryptSecret(row.key_ciphertext),
        baseUrl: row.base_url ?? undefined,
      });
      console.log(`▸ credential for ${row.provider_key}: ok`);
    } catch {
      console.log(`▸ credential for ${row.provider_key}: unreadable (skipped)`);
    }
  }

  const result = await syncProviderCatalogs({ byokCredentials: credentials });
  console.log(
    `▸ sync: ${result.changes.length} changes across ${result.syncedProviders} providers, ${result.errors.length} errors`,
  );
  for (const error of result.errors) console.log(`  ! ${error.provider}: ${error.message}`);

  const added = result.changes.filter((change) => change.kind === 'added');
  for (const change of added) console.log(`  + ${change.slug} (${change.detail})`);

  // Prune alias rows discovery imported.
  for (const slug of ALIAS_DENYLIST) {
    await client`delete from model_prices where model_id in (select id from models where slug = ${slug})`;
    await client`delete from models where slug = ${slug}`;
  }

  // Price and enable everything with a known tariff.
  let priced = 0;
  for (const change of added) {
    if (ALIAS_DENYLIST.has(change.slug)) continue;
    const known = KNOWN_PRICES[change.slug];
    const seeded = MODEL_PRICE_SEEDS[change.slug];
    const tariff = known ?? seeded;
    if (!tariff) continue;
    const prices = {
      inputMicroUsdPerMtok: tariff.in ?? tariff.inputMicroUsdPerMtok,
      outputMicroUsdPerMtok: tariff.out ?? tariff.outputMicroUsdPerMtok,
      cachedInputMicroUsdPerMtok: tariff.cached ?? tariff.cachedInputMicroUsdPerMtok,
      cacheWriteMicroUsdPerMtok: tariff.write ?? tariff.cacheWriteMicroUsdPerMtok,
    };
    await client`
      update model_prices set
        input_micro_usd_per_mtok = ${prices.inputMicroUsdPerMtok},
        output_micro_usd_per_mtok = ${prices.outputMicroUsdPerMtok},
        cached_input_micro_usd_per_mtok = ${prices.cachedInputMicroUsdPerMtok},
        cache_write_micro_usd_per_mtok = ${prices.cacheWriteMicroUsdPerMtok},
        source = 'catalog-sync-price'
      where model_id in (select id from models where slug = ${change.slug})
        and effective_to is null`;
    await client`update models set is_enabled = true where slug = ${change.slug}`;
    priced += 1;
    console.log(`  $ ${change.slug}: priced and enabled`);
  }

  const stillUnpriced = added
    .filter((c) => !ALIAS_DENYLIST.has(c.slug))
    .filter((c) => !KNOWN_PRICES[c.slug] && !MODEL_PRICE_SEEDS[c.slug])
    .map((c) => c.slug);
  if (stillUnpriced.length) {
    console.log(`▸ waiting for a tariff in Admin → Models: ${stillUnpriced.join(', ')}`);
  }
  console.log(`✔ done — ${priced} model(s) priced and enabled`);

  await client.end();
}

main().catch((error) => {
  console.error('✖ discovery failed');
  console.error(error);
  process.exit(1);
});
