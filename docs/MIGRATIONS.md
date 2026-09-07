# Versioned PostgreSQL migrations

## Runtime contract

`pnpm db:migrate` loads `src/db/migrations/NNNN_name.sql` in version order.
`pnpm db` invokes the same runner before seeding. Neither command applies files
from `drizzle/`, and neither repeatedly executes the target `src/db/schema.sql`.

- `0001_initial_schema.sql` is the frozen, idempotent pre-feature schema. Existing
  matching tables and rows are retained; it does not infer or fix arbitrary schema drift.
- `0002_accounts_issuer.sql` adds the nullable Better Auth issuer column to older
  accounts tables without altering existing credentials, account identifiers or sessions.
- `0003_community_component_library.sql`, `0004_community_audit_events.sql`,
  `0005_component_attachment_contents.sql`, and `0006_evaluation_foundation.sql`
  retain main's community, attachment and durable queue/budget schema unchanged.
- `0007_runs_runtime_identity.sql` adds nullable `runtime_kind`, `adapter_version`,
  and `policy_version` on `runs`. New DAG runs record identity; existing rows stay
  unlabeled and are not backfilled as `dag` or `pi`.
- `0008_users_pi_runtime_access.sql` adds nullable `pi_runtime_access` on `users`
  (`applied` / `invited`) for the on-page Pi self-test invite flow.
- `0009_agent_build_drafts.sql` adds private Agent draft payload/mode constraints
  and exact source-version Fork provenance; no Agent execution or B3 is enabled.
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

## Pi/main historical reconciliation (integration review)

This release preserves main `04a53c8a400404a38d9c35240b4204a5ba9ed629` migrations
0001–0006 byte-for-byte. Canonical 0007–0009 contain the unchanged SQL bytes of
Pi `8b5d19faeada98748537c8f6a55a4143d21e1908` migrations 0003–0005. Original Pi
filenames/bytes are retained in `src/db/migrations/historical/pi-runtime-poc/`.
The golden SHA-256 identities and source commits are in `scripts/migration-history.ts`.

**No physical ledger rows are renamed, rewritten, deleted, or assigned new checksums.**
A fresh database or an exact main prefix uses canonical 0001–0009. Only an exact Pi
prefix beginning with the shared 0001–0002 and original `0003_runs_runtime_identity.sql`
selects the audited compatibility sequence:

| Physical Pi history version | Executed SQL identity |
| --- | --- |
| 0001–0005 | Original Pi names, checksums and timestamps remain unchanged |
| 0006_community_component_library.sql | Main original 0003 bytes, not previously applied in Pi |
| 0007_community_audit_events.sql | Main original 0004 bytes |
| 0008_component_attachment_contents.sql | Main original 0005 bytes |
| 0009_evaluation_foundation.sql | Main original 0006 bytes |
| 0010 and later | The common canonical forward sequence |

A partially applied Pi prefix (0003 only or through 0004) first executes its missing
Pi migration(s), then community → audit → attachments → EF. An already applied Agent
`ADD CONSTRAINT` is never replayed. A shared-only prefix (0001 or 0002) has not branched
and follows canonical main order. All histories remain exact prefixes of their selected
sequence, including subsequent releases. This is a permanent, explicit second historical
prefix—not an instruction to manually rename migration files or edit the ledger.

Selection, original ledger validation, reconciliation SQL and new ledger inserts run
under the existing pinned transaction and transaction advisory lock. Unknown/mixed
histories, gaps, changed names/checksums, unknown future entries and archived source
drift fail closed. Reconciliation refuses pre-created pending tables/columns rather
than adopting them through `IF NOT EXISTS`. Ordinary unledgered pre-versioning legacy
initialization remains supported. No automatic data deletion/backfill or production
operation is part of this integration.

`pnpm test:migrations` now includes the real PostgreSQL two-history matrix: every
historical prefix, canonical target-schema equality, physical ledger/data preservation,
concurrent migration, repeat, wrong/mixed/missing histories, pre-created objects and
transaction rollback across the entire reconciliation. Run only with an explicit local
throwaway `MIGRATION_TEST_DATABASE_URL`.


### Applied schema and reserved index names

The integration checks the actual public catalog against reviewed SHA-256 fingerprints
for all 16 nonempty prefixes of the two histories (shared 0001–0002 count once).
`historical/schema-fingerprints.json` is derived from the immutable SQL on PostgreSQL 17,
not from an application database. The real migration matrix recreates every prefix,
checks its fingerprint while upgrading, and compares the final target schema.
Columns/types/defaults/nullability, relation/RLS flags, constraints, indexes, user
triggers and policies are checked before pending SQL; the final 0009 catalog is also
checked before commit. A valid ledger does not excuse changed or missing schema.
Catalog display differences on another PostgreSQL major are fail-closed; qualify that
major through this matrix before rollout, never regenerate fingerprints against a
drifted application database to make an upgrade pass.

Pending community/EF/Pi table, column, and **index relation names** are reserved.
`CREATE [UNIQUE] INDEX IF NOT EXISTS` cannot silently adopt a same-name index on another
table (including `evaluation_jobs_one_active_user_idx` and
`evaluation_jobs_association_unique`). Such collisions abort the complete transaction;
original ledger rows and `applied_at` values remain untouched. Test faults include
both index collisions, a dropped Agent CHECK, changed type, and unexpected column.

Fingerprints cover the audited release through 0009, not arbitrary future schemas.
When adding 0010+, preserve both physical prefixes and add a reviewed schema-validation
strategy/fixtures for the new release; ledger prefix checking continues for later IDs.
Do not replay the Pi Agent CHECK or alias/rename physical ledger rows during rollout.
