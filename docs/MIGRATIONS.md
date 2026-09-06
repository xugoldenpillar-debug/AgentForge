# Versioned PostgreSQL migrations

## Runtime contract

`pnpm db:migrate` loads `src/db/migrations/NNNN_name.sql` in version order.
`pnpm db` invokes the same runner before seeding. Neither command applies files
from `drizzle/`, and neither repeatedly executes the target `src/db/schema.sql`.

- `0001_initial_schema.sql` is the frozen, idempotent pre-feature schema. Existing
  matching tables and rows are retained; it does not infer or fix arbitrary schema drift.
- `0002_accounts_issuer.sql` adds the nullable Better Auth issuer column to older
  accounts tables without altering existing credentials, account identifiers or sessions.
- `schema_migrations` records version, filename, SHA-256 checksum and application time.
  The runner rejects missing, renamed, edited, or retroactively inserted applied files.
- A pinned postgres.js transaction takes `pg_advisory_xact_lock` before creating or
  reading the ledger. All pending DDL and ledger entries commit together, or roll back
  together. The pool remains multi-connection; no handwritten pooled BEGIN/COMMIT.
- The runner pins the `public` search path and uses a 30-second lock timeout. An
  incompatible database or lock timeout fails startup rather than silently seeding.

The ledger is infrastructure-only: it is deliberately absent from the game repository
registry, user DTOs and application seed. No application-facing trust lane, ranking,
credential API or Verified execution capability is enabled by these migrations.

## Adding a migration

1. Append a uniquely numbered SQL file; never rewrite an applied file.
2. Update `src/db/schema.sql` and `src/db/schema.ts` to describe the resulting target.
3. Add old-structure fixtures and fresh/upgrade/repeat/preservation tests.
4. Execute the isolated PostgreSQL matrix and registration/login smoke before rollout.
5. Record compatibility and recovery steps with actual verification evidence.

Do not insert transaction-control statements into migration SQL. The runner uses a
conservative keyword guard, including comments, string literals and procedural bodies;
avoid these reserved transaction words in migration text. This is reviewed repository
SQL, not an arbitrary SQL sandbox. DDL runs inside the runner transaction. Operations such as concurrent index creation that cannot execute
in that transaction require a separately reviewed migration strategy, not disabling
atomicity or bypassing history validation.

## Tests

Dependency-free tests (an in-memory transaction double, **not PostgreSQL**):

```sh
node --experimental-strip-types --test tests/migrations.test.ts
```

Real PostgreSQL tests require an explicit **local test server** and a role with
`CREATE DATABASE`. Set `MIGRATION_TEST_DATABASE_URL` securely, then run:

```sh
pnpm test:migrations
```

The script refuses a missing URL and non-loopback hosts. It never falls back to
`DATABASE_URL`. It creates a unique `agentforge_migration_test_<uuid>` database,
uses that database for fresh and synthetic legacy fixtures, and drops only that
new database in cleanup. A legacy-schema reset occurs only inside the newly created
database. No application database or existing schema is reset. If the test process
is forcibly killed, manually inspect the exact test database before cleanup; do not
use wildcard deletion.

The real matrix checks fresh initialization, repeated execution, legacy auth and
credential/result preservation, concurrent migration startup, DDL rollback and
checksum mismatch rejection. Synthetic accounts are not a substitute for Better Auth
registration/login: `pnpm db`, a running Next.js test server and `pnpm test:smoke`
are still separate integration gates. CI is configured to run the migration matrix
before initializing its disposable application database; configuration alone is not
evidence of a successful CI run.

## Rollout and recovery

Back up an existing database through the operator's approved procedure before applying
upgrades. This change adds metadata and one nullable column; it does not perform the
Phase 2 Legacy Archive backfill, delete old results or promote any result to Verified.

On migration failure the pending batch rolls back. Restore original migration files
when history differs, or append a reviewed corrective migration. Do not delete ledger
rows to suppress errors. Code rollback leaves additive schema and history intact;
an older runner release may refuse a newer ledger, so prefer a compatible forward fix.
