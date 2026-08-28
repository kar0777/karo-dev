import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env', quiet: true });
config({ path: '.env.local', override: true, quiet: true });

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://karo:karo@localhost:5432/karo',
  },
  verbose: true,
  strict: true,
});
