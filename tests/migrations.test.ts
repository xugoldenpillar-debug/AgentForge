import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMigrations, parseMigration, runMigrations, runMigrationCommand } from '../scripts/migration-runner.ts';
import type { MigrationDatabase } from '../scripts/migration-runner.ts';

function fakeDatabase() {
  let rows: Record<string, unknown>[] = [];
  let statements: string[] = [];
  const events: string[] = [];
  const database: MigrationDatabase = {
    async transaction(work) {
      events.push('begin');
      const draft = structuredClone(rows);
      const pending: string[] = [];
      try {
        const result = await work({
          async query(sql, parameters = []) {
            events.push(sql);
            if (sql.startsWith('SELECT version')) return structuredClone(draft);
            if (sql === 'FAIL') throw new Error('Injected migration failure');
            if (sql.startsWith('INSERT INTO public.schema_migrations')) {
              const [version, name, checksum] = parameters;
              draft.push({ version, name, checksum });
            } else {
              pending.push(sql);
            }
            return [];
          },
        });
        rows = draft;
        statements = [...statements, ...pending];
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
  };
  return { database, events, rows: () => rows, statements: () => statements };
}

const first = parseMigration('0001_first.sql', 'SELECT 1;');
const second = parseMigration('0002_second.sql', 'SELECT 2;');

test('migration files are frozen, ordered and checksummed independently of target schema', async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.map(migration => migration.version), ['0001', '0002', '0003', '0004']);
  assert.match(migrations[0].sql, /CREATE TABLE IF NOT EXISTS "provider_credentials"/);
  assert.match(migrations[1].sql, /ADD COLUMN IF NOT EXISTS issuer TEXT/);
  assert.match(migrations[2].sql, /ADD COLUMN IF NOT EXISTS runtime_kind TEXT/);
  assert.equal(first.checksum.length, 64);
  assert.notEqual(first.checksum, parseMigration(first.name, `${first.sql}\n`).checksum);
});

test('loader rejects malformed SQL filenames and empty directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentforge-migrations-'));
  const url = pathToFileURL(`${directory}/`);
  try {
    await assert.rejects(loadMigrations(url), /No migrations/);
    await writeFile(join(directory, 'bad.sql'), 'SELECT 1;');
    await assert.rejects(loadMigrations(url), /Invalid migration/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sorts before executing and takes a transaction lock before ledger creation', async () => {
  const fake = fakeDatabase();
  assert.deepEqual(await runMigrations(fake.database, [second, first]), {
    applied: [first.name, second.name], skipped: 0,
  });
  assert.ok(fake.events.indexOf(first.sql) < fake.events.indexOf(second.sql));
  assert.ok(fake.events.findIndex(event => event.includes('pg_advisory_xact_lock')) <
    fake.events.findIndex(event => event.startsWith('CREATE TABLE')));
  assert.equal(fake.events[0], 'begin');
  assert.equal(fake.events.at(-1), 'commit');
  assert.equal(fake.rows()[0].checksum, first.checksum);
});

test('second run skips all applied SQL without duplicating ledger entries', async () => {
  const fake = fakeDatabase();
  await runMigrations(fake.database, [first, second]);
  assert.deepEqual(await runMigrations(fake.database, [first, second]), { applied: [], skipped: 2 });
  assert.equal(fake.events.filter(event => event === first.sql).length, 1);
  assert.equal(fake.rows().length, 2);
});

test('rejects duplicate versions and invalid metadata before opening transaction', async () => {
  const fake = fakeDatabase();
  await assert.rejects(runMigrations(fake.database, [first, first]), /Duplicate/);
  await assert.rejects(runMigrations(fake.database, [{ ...first, checksum: 'bad' }]), /metadata/);
  assert.deepEqual(fake.events, []);
});

test('history verification fails closed for changed, missing, renamed or inserted files', async () => {
  const fake = fakeDatabase();
  await runMigrations(fake.database, [second]);
  for (const migrations of [
    [parseMigration(second.name, 'SELECT 3;')],
    [first],
    [parseMigration('0002_renamed.sql', second.sql)],
    [first, second],
  ]) {
    await assert.rejects(runMigrations(fake.database, migrations), /history mismatch/);
  }
  assert.equal(fake.rows().length, 1);
  assert.equal(fake.events.filter(event => event === first.sql).length, 0);
});

test('failure rolls back SQL and ledger together; retry can succeed', async () => {
  const fake = fakeDatabase();
  await assert.rejects(runMigrations(fake.database, [first, parseMigration(second.name, 'FAIL')]), /Injected/);
  assert.deepEqual(fake.rows(), []);
  assert.deepEqual(fake.statements(), []);
  assert.equal(fake.events.at(-1), 'rollback');
  await runMigrations(fake.database, [first, second]);
  assert.equal(fake.rows().length, 2);
});

test('legacy fixtures lack issuer and retain auth, credentials and ranked history', async () => {
  const schema = await readFile(new URL('./fixtures/migrations/legacy-schema.sql', import.meta.url), 'utf8');
  const data = await readFile(new URL('./fixtures/migrations/legacy-data.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(schema, /"issuer"/);
  assert.doesNotMatch(schema, /schema_migrations|gateway_config|provenance/);
  for (const table of ['accounts', 'sessions', 'provider_credentials', 'runs', 'submissions']) {
    assert.ok(data.includes(`INSERT INTO ${table} `));
  }
});


test('Phase 0 frozen baseline equals target without ledger and legacy plus issuer', async () => {
  const migrations = await loadMigrations();
  const target = await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
  const ledgerMarker = '-- Runner-owned history.';
  assert.equal(target.split(ledgerMarker).length, 2);
  const baseline = migrations[0].sql.trim();
  const targetHead = target.split(ledgerMarker)[0];
  assert.match(targetHead, /"runtime_kind" TEXT/);
  assert.match(targetHead, /"pi_runtime_access" TEXT/);
  assert.equal(baseline.includes('runtime_kind'), false);
  assert.equal(baseline.includes('pi_runtime_access'), false);
  assert.equal(
    targetHead
      .replace(/\n  "runtime_kind" TEXT,\n  "adapter_version" TEXT,\n  "policy_version" TEXT,/, '')
      .replace(/,\n  "pi_runtime_access" TEXT/, '')
      .trim(),
    baseline
  );
  const legacy = await readFile(new URL('./fixtures/migrations/legacy-schema.sql', import.meta.url), 'utf8');
  assert.equal(migrations[0].sql.replace('  "issuer" TEXT,\n', ''), legacy);
  const alter = migrations[1].sql.replace(/^--.*$/gm, '').trim();
  assert.equal(alter, 'ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS issuer TEXT;');
  assert.match(migrations[2].sql, /ADD COLUMN IF NOT EXISTS runtime_kind TEXT/);
  assert.match(migrations[3].sql, /ADD COLUMN IF NOT EXISTS pi_runtime_access TEXT/);
});

test('rejects transaction control before opening a transaction, even in conservative guard contexts', async () => {
  for (const text of ['BEGIN;', 'COMMIT;', 'ROLLBACK;', 'END;', 'ABORT;',
    'START /* split */ TRANSACTION;', 'SAVEPOINT x;', 'RELEASE x;',
    "PREPARE TRANSACTION 'x';", 'SELECT 1; cOmMiT;',
    '-- COMMIT in a comment', "SELECT 'BEGIN';"]) {
    assert.throws(() => parseMigration('0003_control.sql', text), /Transaction control/);
  }
  const fake = fakeDatabase();
  await assert.rejects(runMigrations(fake.database, [{ ...first, sql: 'COMMIT;' }]), /Transaction control/);
  assert.deepEqual(fake.events, []);
});

test('command preserves failure and suppresses secret-bearing errors including cleanup', async () => {
  const messages: string[] = [];
  const calls: string[] = [];
  const ok = await runMigrationCommand(
    async () => { calls.push('load'); throw new Error('secret://user:password@host'); },
    async () => { calls.push('cleanup'); throw new Error('DATABASE_URL password'); },
    message => messages.push(message),
  );
  assert.equal(ok, false);
  assert.deepEqual(calls, ['load', 'cleanup']);
  assert.match(messages[0], /migration failed/);
  assert.match(messages[1], /cleanup failed/);
  assert.doesNotMatch(messages.join(' '), /secret:\/\/|password|DATABASE_URL/);
});

test('CLI cleanup does not initialize a database after load fails', async () => {
  const entrypoint = await readFile(new URL('../scripts/migrate.ts', import.meta.url), 'utf8');
  assert.match(entrypoint, /await openedSql\?\.end\(\)/);
  assert.doesNotMatch(entrypoint, /database\(\)\.sql\.end/);
  const messages: string[] = [];
  assert.equal(await runMigrationCommand(async () => {}, async () => {}, message => messages.push(message)), true);
  assert.deepEqual(messages, []);
});
