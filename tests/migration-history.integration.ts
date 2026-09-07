import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { loadMigrations, parseMigration, runMigrations } from '../scripts/migration-runner.ts';
import { PI_HISTORICAL_NAMES, selectMigrationHistory } from '../scripts/migration-history.ts';
import type { MigrationDatabase } from '../scripts/migration-runner.ts';

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!testUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) {
  throw new Error('Explicit local MIGRATION_TEST_DATABASE_URL required.');
}

async function isolated(work: (sql: ReturnType<typeof postgres>, db: MigrationDatabase) => Promise<void>) {
  const admin = postgres(testUrl!, { max: 2, onnotice: () => {} });
  const name = `pi_merge_${randomUUID().replaceAll('-', '')}`;
  let sql: ReturnType<typeof postgres> | undefined;
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(testUrl!);
    url.pathname = `/${name}`;
    sql = postgres(url.toString(), { max: 6, onnotice: () => {} });
    const connection = sql;
    await work(connection, { transaction: work => connection.begin(async tx => work({
      query: async (statement, values = []) => tx.unsafe(statement, values),
    })) });
  } finally {
    await sql?.end({ timeout: 5 });
    if (created) await admin.unsafe(`DROP DATABASE "${name}"`);
    await admin.end({ timeout: 5 });
  }
}

async function schema(sql: ReturnType<typeof postgres>) {
  const columns = await sql`SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name <> 'schema_migrations'
    ORDER BY table_name, column_name`;
  const constraints = await sql`SELECT c.relname, p.conname, pg_get_constraintdef(p.oid) AS definition
    FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname <> 'schema_migrations' ORDER BY c.relname,p.conname`;
  const indexes = await sql`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename <> 'schema_migrations' ORDER BY tablename,indexname`;
  return JSON.stringify({ columns, constraints, indexes });
}

test('golden main/Pi partial histories converge with unchanged data and physical provenance', {timeout: 180000}, async () => {
  const canonical = await loadMigrations();
  const pi = [...canonical.slice(0, 2), ...PI_HISTORICAL_NAMES.map((name, i) => parseMigration(name, canonical[i + 6].sql))];
  let canonicalSchema = '';
  await isolated(async (sql, db) => {
    await runMigrations(db, canonical);
    canonicalSchema = await schema(sql);
  });
  await isolated(async (sql) => {
    await sql.unsafe(await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
    assert.equal(await schema(sql), canonicalSchema, 'target schema snapshot must equal the versioned upgrade');
  });
  const reconciledPi = await selectMigrationHistory(canonical, pi.slice(0, 3).map(({version, name, checksum}) => ({version, name, checksum})));
  for (const history of [[], ...Array.from({length: 9}, (_, i) => canonical.slice(0, i + 1)), ...[3, 4, 5, 6, 7, 8, 9].map(n => reconciledPi.slice(0, n))]) {
    await isolated(async (sql, db) => {
      if (history.length === 9 && history[2].name === PI_HISTORICAL_NAMES[0]) {
        // Simulate a completed physical Pi lineage, not a different canonical
        // release supplied to the production runner.
        await runMigrations(db, history.slice(0, 8));
        await sql.begin(async tx => {
          const last = history[8];
          await tx.unsafe(last.sql);
          await tx`INSERT INTO schema_migrations(version,name,checksum)
            VALUES (${last.version},${last.name},${last.checksum})`;
        });
      } else if (history.length) await runMigrations(db, history);
      const original = history.length ? await sql`SELECT * FROM schema_migrations ORDER BY version` : [];
      if (history.length) await sql.unsafe(await readFile(new URL('./fixtures/migrations/legacy-data.sql', import.meta.url), 'utf8'));
      const snapshot = async () => history.length ? JSON.stringify(await sql`SELECT id, email, name FROM users ORDER BY id`) : '';
      const before = await snapshot();
      const results = await Promise.all([runMigrations(db, canonical), runMigrations(db, canonical)]);
      assert.equal(results.reduce((n, r) => n + r.applied.length, 0), canonical.length - history.length);
      assert.equal(await snapshot(), before);
      assert.deepEqual((await sql`SELECT * FROM schema_migrations ORDER BY version`).slice(0, history.length), [...original]);
      assert.equal(await schema(sql), canonicalSchema);
      assert.equal((await runMigrations(db, canonical)).skipped, canonical.length);
      const ledger = await sql`SELECT * FROM schema_migrations ORDER BY version`;
      const bad = parseMigration('0010_failure.sql', 'CREATE TABLE rollback_probe(id TEXT); SELECT 1/0;');
      await assert.rejects(runMigrations(db, [...canonical, bad]));
      assert.equal((await sql`SELECT to_regclass('public.rollback_probe') AS object`)[0].object, null);
      assert.deepEqual(await sql`SELECT * FROM schema_migrations ORDER BY version`, ledger);
    });
  }
  // Failure while reconciling a Pi prefix must roll back all missing schemas and new history.
  await isolated(async (sql, db) => {
    await runMigrations(db, pi);
    const before = await schema(sql);
    const ledger = await sql`SELECT * FROM schema_migrations ORDER BY version`;
    await assert.rejects(runMigrations(db, [...canonical, parseMigration('0010_failure.sql', 'SELECT 1/0;')]));
    assert.equal(await schema(sql), before);
    assert.deepEqual(await sql`SELECT * FROM schema_migrations ORDER BY version`, ledger);
    await runMigrations(db, canonical);
  });
});

test('Pi compatibility rejects unknown, mixed, missing, checksum-drift and precreated objects', {timeout: 90000}, async () => {
  const canonical = await loadMigrations();
  const pi = [...canonical.slice(0, 2), ...PI_HISTORICAL_NAMES.map((name, i) => parseMigration(name, canonical[i + 6].sql))];
  const mutations = [
    "UPDATE schema_migrations SET checksum = repeat('0',64) WHERE version='0004'",
    "UPDATE schema_migrations SET name = '0004_community_audit_events.sql' WHERE version='0004'",
    "DELETE FROM schema_migrations WHERE version='0002'",
    "INSERT INTO schema_migrations(version,name,checksum) VALUES ('0006','0006_unknown.sql',repeat('0',64))",
    'CREATE TABLE components(id TEXT)',
  ];
  for (const mutation of mutations) {
    await isolated(async (sql, db) => {
      await runMigrations(db, pi);
      // Fault injection is limited to this newly created throwaway test database.
      await sql.unsafe(mutation);
      const before = await schema(sql);
      const ledger = await sql`SELECT * FROM schema_migrations ORDER BY version`;
      await assert.rejects(runMigrations(db, canonical), /history mismatch/);
      assert.equal(await schema(sql), before);
      assert.deepEqual(await sql`SELECT * FROM schema_migrations ORDER BY version`, ledger);
    });
  }
});


test('known ledger cannot mask applied schema drift or EF unique-index collisions', {timeout: 90000}, async () => {
  const canonical = await loadMigrations();
  const pi = [...canonical.slice(0, 2), ...PI_HISTORICAL_NAMES.map((name, i) => parseMigration(name, canonical[i + 6].sql))];
  for (const mutation of [
    'CREATE UNIQUE INDEX evaluation_jobs_one_active_user_idx ON users(email)',
    'CREATE UNIQUE INDEX evaluation_jobs_association_unique ON users(email)',
    'ALTER TABLE build_versions DROP CONSTRAINT build_versions_mode_payload',
    'ALTER TABLE runs ALTER COLUMN runtime_kind TYPE varchar(10)',
    'ALTER TABLE users ADD COLUMN unexpected_column TEXT',
  ]) {
    await isolated(async (sql, db) => {
      await runMigrations(db, pi);
      await sql.unsafe(mutation);
      const before = await schema(sql);
      const ledger = await sql`SELECT * FROM schema_migrations ORDER BY version`;
      await assert.rejects(runMigrations(db, canonical), /schema drift|pre-created reconciliation index/);
      assert.equal(await schema(sql), before);
      assert.deepEqual(await sql`SELECT * FROM schema_migrations ORDER BY version`, ledger);
      assert.equal((await sql`SELECT to_regclass('public.evaluation_jobs') AS object`)[0].object, null);
      assert.equal((await sql`SELECT to_regclass('public.components') AS object`)[0].object, null);
    });
  }
});
