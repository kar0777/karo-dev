-- ==================================================================== --
--  Karo — PostgreSQL bootstrap
--
--  Mounted at /docker-entrypoint-initdb.d/ by docker-compose.yml. It runs
--  exactly once, against an empty data directory, before Postgres starts
--  accepting external connections.
--
--  Everything here is idempotent, so it is also safe to run by hand
--  against an existing database:
--
--      psql "$DATABASE_URL" -f docker/postgres/init.sql
--
--  Extensions must exist BEFORE `npm run db:push` / `npm run db:migrate`,
--  because the generated DDL references them.
-- ==================================================================== --

\echo 'Karo: installing required PostgreSQL extensions...'

-- ------------------------------------------------------------------ --
--  pg_trgm — trigram indexes
--
--  Backs chat and file search. Karo searches `messages.content`,
--  `conversations.title`, `project_files.path` and the skill/plugin
--  catalogue with substring and fuzzy predicates; a plain B-tree cannot
--  serve `ILIKE '%term%'`, but a GIN index over trigrams can. It also
--  provides similarity() for the "did you mean" ordering on the command
--  palette.
-- ------------------------------------------------------------------ --
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------------ --
--  pgcrypto — gen_random_bytes / digest / crypt
--
--  The application generates ids and hashes in Node (see lib/crypto),
--  so this is not on the hot path. It earns its place for the things
--  that must happen inside the database: seeding and repair scripts that
--  need a random token without a round trip, and `digest()` in ad-hoc
--  admin queries that verify a stored SHA-256 token hash without ever
--  materialising the plaintext.
-- ------------------------------------------------------------------ --
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------ --
--  citext — intentionally NOT installed.
--
--  Case-insensitive email lookup is already handled by expression
--  indexes in the Drizzle schema:
--
--      uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)
--      index('invitations_email_idx').on(sql`lower(${t.email})`)
--
--  That approach keeps the column a plain `text` — which means it
--  round-trips through drizzle-kit, postgres.js and every dump/restore
--  tool without a custom type mapping, and keeps the comparison rule
--  visible in the schema instead of hidden in a column type. Adding
--  citext on top would give two competing sources of truth for the same
--  invariant. If you enable it later, drop the lower() indexes first.
--
--  CREATE EXTENSION IF NOT EXISTS citext;   -- not required by Karo
-- ------------------------------------------------------------------ --

-- ------------------------------------------------------------------ --
--  Defaults for this database
--
--  Karo stores every timestamp as timestamptz and never writes naive
--  local time; pinning UTC removes any dependence on the container's TZ.
-- ------------------------------------------------------------------ --
DO $$
BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
    -- Cheap insurance against a runaway analytics query wedging a
    -- connection forever. Individual statements can raise it locally.
    EXECUTE format(
        'ALTER DATABASE %I SET statement_timeout TO %L',
        current_database(),
        '60s'
    );
    EXECUTE format(
        'ALTER DATABASE %I SET idle_in_transaction_session_timeout TO %L',
        current_database(),
        '60s'
    );
END
$$;

\echo 'Karo: extensions ready (pg_trgm, pgcrypto).'
