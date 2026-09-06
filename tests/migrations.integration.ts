// Explicit opt-in integration suite, excluded from tests/*.test.ts.
// MIGRATION_TEST_DATABASE_URL must name a disposable local PostgreSQL server
// whose role may CREATE DATABASE. Only a new UUID-named database is modified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadMigrations, parseMigration, runMigrations } from '../scripts/migration-runner.ts';
import type { MigrationDatabase } from '../scripts/migration-runner.ts';

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!testUrl) throw new Error('MIGRATION_TEST_DATABASE_URL is required; DATABASE_URL is never used.');
const target = new URL(testUrl);
if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('Migration integration tests require an explicit local PostgreSQL test server.');
}

test('disposable PostgreSQL: fresh, legacy, repeat, rollback, concurrency and preservation', {
  timeout: 180_000,
}, async () => {
  const { default: postgres } = await import('postgres');
  const databaseName = `agentforge_migration_test_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(testUrl, { max: 2, connect_timeout: 5 });
  let created = false;
  let sql: ReturnType<typeof postgres> | undefined;
  try {
    // Only create a new database. Never reset a schema on the supplied URL.
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const isolatedUrl = new URL(testUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    sql = postgres(isolatedUrl.toString(), { max: 5, connect_timeout: 5 });
    const connection = sql;
    const database: MigrationDatabase = {
      async transaction(work) {
        return connection.begin(async tx => work({
          async query(text, parameters = []) {
            return await tx.unsafe(text, parameters);
          },
        }));
      },
    };
    const migrations = await loadMigrations();
    await runMigrations(database, migrations);
    assert.equal((await runMigrations(database, migrations)).skipped, migrations.length);
    assert.equal((await sql`SELECT * FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'issuer'`).length, 1);
    assert.equal((await sql`SELECT * FROM information_schema.columns WHERE table_name = 'runs' AND column_name = 'runtime_kind'`).length, 1);
    assert.equal((await sql`SELECT * FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'pi_runtime_access'`).length, 1);
    assert.equal((await sql`SELECT * FROM information_schema.columns WHERE table_name = 'build_versions' AND column_name = 'agent_definition'`).length, 1);
    // Destructive reset is confined to the database created above.
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sql.unsafe(await readFile(new URL('./fixtures/migrations/legacy-schema.sql', import.meta.url), 'utf8'));
    await sql.unsafe(await readFile(new URL('./fixtures/migrations/legacy-data.sql', import.meta.url), 'utf8'));
    const snapshot = async () => {
      const results: Record<string, unknown> = {};
      for (const table of ['users', 'accounts', 'sessions', 'provider_credentials', 'builds', 'build_versions', 'runs', 'submissions']) {
        results[table] = await connection.unsafe(`SELECT to_jsonb(t) - 'issuer' - 'runtime_kind' - 'adapter_version' - 'policy_version' - 'pi_runtime_access' - 'mode' - 'agent_definition' - 'definition_digest' AS row FROM public.${table} t ORDER BY id`);
      }
      return JSON.stringify(results);
    };
    const before = await snapshot();
    const concurrent = await Promise.all([runMigrations(database, migrations), runMigrations(database, migrations)]);
    assert.deepEqual(concurrent.map(result => result.applied.length).sort(), [0, migrations.length]);
    assert.equal(await snapshot(), before);
    assert.equal((await runMigrations(database, migrations)).skipped, migrations.length);
    assert.equal(await snapshot(), before);
    const bad = parseMigration('0006_failure.sql', 'CREATE TABLE public.rollback_probe (id TEXT); SELECT 1/0;');
    await assert.rejects(runMigrations(database, [...migrations, bad]));
    assert.equal((await sql`SELECT to_regclass('public.rollback_probe') AS name`)[0].name, null);
    assert.equal((await sql`SELECT * FROM public.schema_migrations`).length, migrations.length);
    const good = parseMigration('0006_recovery.sql', 'CREATE TABLE public.rollback_probe (id TEXT);');
    assert.equal((await runMigrations(database, [...migrations, good])).applied.length, 1);
    await assert.rejects(runMigrations(database, [...migrations, parseMigration(good.name, 'SELECT 1;')]), /history mismatch/);
  } finally {
    try {
      await sql?.end({ timeout: 5 });
    } finally {
      try {
        if (created) await admin.unsafe(`DROP DATABASE "${databaseName}"`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    }
  }
});
