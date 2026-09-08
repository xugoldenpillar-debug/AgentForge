import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMigrations, parseMigration, runMigrations, runMigrationCommand } from '../scripts/migration-runner.ts';
import type { MigrationDatabase } from '../scripts/migration-runner.ts';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { artifacts } from '../src/db/schema.ts';

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
  assert.deepEqual(migrations.map(migration => migration.version), ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015', '0016', '0017']);
  assert.match(migrations[0].sql, /CREATE TABLE IF NOT EXISTS "provider_credentials"/);
  assert.match(migrations[1].sql, /ADD COLUMN IF NOT EXISTS issuer TEXT/);
  assert.match(migrations[2].sql, /CREATE TABLE IF NOT EXISTS "components"/);
  assert.match(migrations[2].sql, /CREATE TABLE IF NOT EXISTS "component_test_runs"/);
  assert.match(migrations[3].sql, /CREATE TABLE IF NOT EXISTS "community_audit_events"/);
  assert.match(migrations[4].sql, /CREATE TABLE IF NOT EXISTS "component_attachment_contents"/);
  assert.match(migrations[4].sql, /octet_length\("content"\) <= 262144/);
  assert.match(migrations[5].sql, /CREATE TABLE IF NOT EXISTS public\.evaluation_jobs/);
  assert.match(migrations[9].sql, /CREATE TABLE IF NOT EXISTS public\.environment_templates/);
  assert.match(migrations[9].sql, /CREATE TABLE IF NOT EXISTS public\.artifact_bundles/);
  assert.match(migrations[9].sql, /CREATE TABLE IF NOT EXISTS public\.artifacts/);
  assert.equal(migrations[10].name, '0011_artifact_arena_showcase.sql');
  assert.match(migrations[10].sql, /CREATE TABLE IF NOT EXISTS public\.work_publications/);
  assert.match(migrations[10].sql, /CREATE TABLE IF NOT EXISTS public\.showcase_entries/);
  assert.match(migrations[10].sql, /CREATE TABLE IF NOT EXISTS public\.showcase_ballots/);
  assert.match(migrations[10].sql, /CREATE TABLE IF NOT EXISTS public\.showcase_votes/);
  assert.match(migrations[10].sql, /showcase_entries_active_owner_partition_unique/);
  assert.match(migrations[14].sql, /ADD COLUMN IF NOT EXISTS artifact_bundle_id TEXT/);
  assert.match(migrations[14].sql, /CREATE TABLE IF NOT EXISTS public\.work_likes/);
  assert.match(migrations[15].sql, /ADD COLUMN IF NOT EXISTS animation_challenge_id TEXT/);
  assert.match(migrations[15].sql, /ADD COLUMN IF NOT EXISTS animation_challenge_version_id TEXT/);
  assert.match(migrations[15].sql, /ADD CONSTRAINT builds_target_check CHECK/);
  assert.match(migrations[16].sql, /DROP CONSTRAINT IF EXISTS evaluation_jobs_check/);
  assert.equal(first.checksum.length, 64);
  assert.notEqual(first.checksum, parseMigration(first.name, `${first.sql}\n`).checksum);
});

test('Artifact Arena Drizzle checks preserve the migration regex semantics', () => {
  const dialect = new PgDialect();
  const checks = getTableConfig(artifacts).checks
    .map(check => dialect.sqlToQuery(check.value).sql);
  const findCheck = (column: string) => checks.find(check => check.includes(`\"artifacts\".\"${column}\"`));
  const pathCheck = findCheck('path');
  const storageKeyCheck = findCheck('storage_key');
  const objectVersionCheck = findCheck('object_version');
  assert.ok(pathCheck);
  assert.ok(storageKeyCheck);
  assert.ok(objectVersionCheck);
  assert.ok(pathCheck.includes('|\\\\\\\\|'), pathCheck);
  assert.ok(pathCheck.includes('(^|/)\\\\.\\\\.?(/|$)'), pathCheck);
  assert.ok(storageKeyCheck.includes('|\\\\\\\\|'), storageKeyCheck);
  assert.ok(objectVersionCheck.includes('|\\.\\.)'), objectVersionCheck);
  assert.ok(!objectVersionCheck.includes('|..)'), objectVersionCheck);
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


test('versioned migrations match the fresh schema phases and preserve legacy upgrades', async () => {
  const migrations = await loadMigrations();
  const target = await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
  const communityMarker = '-- Community component library data foundation.';
  const foundationMarker = '-- Durable evaluation foundation.';
  const artifactMarker = '-- Artifact Arena foundation. Immutable version rows keep execution and object references auditable.';
  const ledgerMarker = '-- Runner-owned history.';
  const showcaseMarker = '-- Durable Artifact Arena showcase and pairwise voting records.';
  const [baseline, communityAndAfter] = target.split(communityMarker);
  assert.ok(communityAndAfter, 'fresh schema must include the community foundation phase');
  const [communityAndFoundation, artifactAndAfter] = communityAndAfter.split(artifactMarker);
  assert.ok(artifactAndAfter, 'fresh schema must include the Artifact Arena foundation phase');
  const [artifactAndLedger, ledgerAndAfter] = artifactAndAfter.split(ledgerMarker);
  assert.ok(ledgerAndAfter, 'fresh schema must include the runner-owned history phase');
  const [artifact, showcaseAndAfter] = artifactAndLedger.split(showcaseMarker);
  assert.ok(showcaseAndAfter, 'fresh schema must include the showcase foundation phase');
  const [showcase] = showcaseAndAfter.split(ledgerMarker);
  const [, foundationAndAfter] = communityAndFoundation.split(foundationMarker);
  assert.ok(foundationAndAfter, 'fresh schema must include the evaluation foundation phase');
  const [foundation] = foundationAndAfter.split(artifactMarker);
  const protocolColumn = `
  "protocol" TEXT NOT NULL DEFAULT 'openai-chat' CHECK (protocol IN ('openai-chat', 'openai-responses', 'anthropic-messages', 'google-generative-ai')),`;
  assert.ok(baseline.includes(protocolColumn));
  assert.match(migrations[12].sql, /ADD COLUMN IF NOT EXISTS protocol TEXT NOT NULL DEFAULT 'openai-chat'/);
  const animationCatalog = /\n-- Additive catalog only\. Does not enable execution or create simulated activity\.[\s\S]*?\n(?=CREATE TABLE IF NOT EXISTS "builds")/;
  assert.match(baseline, animationCatalog);
  const legacyBaseline = baseline.replace(animationCatalog, '\n')
    .replace(protocolColumn, '')
    .replace(/\n  "runtime_kind" TEXT,\n  "adapter_version" TEXT,\n  "policy_version" TEXT,/, '')
    .replace(/,\n  "pi_runtime_access" TEXT/, '')
    .replace(/\n  "mode" TEXT NOT NULL DEFAULT 'workflow',\n  "agent_definition" JSONB,\n  "definition_digest" TEXT,/, '')
    .replace(/,\n  CONSTRAINT build_versions_mode_payload CHECK \([\s\S]*?\n  \)/, '')
    .replace(/\n  "source_version_id" TEXT REFERENCES "build_versions"\("id"\),/, '')
    .replace('  "problem_id" TEXT REFERENCES "problems"("id") ON DELETE CASCADE,\n  "animation_challenge_id" TEXT REFERENCES "animation_challenges"("id") ON DELETE RESTRICT,',
      '  "problem_id" TEXT NOT NULL REFERENCES "problems"("id") ON DELETE CASCADE,')
    .replace(/,\n  CONSTRAINT builds_target_check CHECK \([\s\S]*?\n  \)/, '')
    .replace(/\n  "animation_challenge_version_id" TEXT REFERENCES "animation_challenge_versions"\("id"\) ON DELETE RESTRICT,/, '')
    .replace(/\nCREATE INDEX IF NOT EXISTS builds_animation_challenge_idx[\s\S]*?WHERE animation_challenge_version_id IS NOT NULL;\n/, '\n');
  assert.equal(migrations[0].sql.trim(), legacyBaseline.trim());
  const freshFoundation = foundation.replace(/^\s*Upgrades are applied by the versioned runner\.\s*/, '')
    .replaceAll(", 'creation'", '')
    .replace(", 'creation-run'", '')
    .replace('  CONSTRAINT evaluation_jobs_association_check CHECK (', '  CHECK (')
    .replace("\n    OR (purpose = 'creation' AND association_kind = 'creation-run' AND competitive_run_id IS NULL AND association_visibility IS NULL)", '');
  assert.equal(migrations[5].sql.trim(), freshFoundation.trim());
  const legacyArtifact = artifact
    .replace(/\n  challenge_version_id TEXT REFERENCES public\.animation_challenge_versions\(id\) ON DELETE RESTRICT,/, '')
    .replace(/\n  artifact_bundle_id TEXT,/, '')
    .replace(/\nCREATE INDEX IF NOT EXISTS creation_runs_challenge_version_idx[^;]+;/, '')
    .replace(/\nALTER TABLE public\.creation_runs[\s\S]*?ON public\.creation_runs\(artifact_bundle_id\) WHERE artifact_bundle_id IS NOT NULL;\n/, '');
  const legacyShowcase = showcase.replace(/\nCREATE TABLE IF NOT EXISTS public\.work_likes \([\s\S]*?work_likes_publication_idx ON public\.work_likes\(publication_id, created_at DESC\);\n/, '');
  assert.equal(migrations[9].sql.trim(), `${artifactMarker}${legacyArtifact}`.trim());
  assert.equal(migrations[10].sql.trim(), `${showcaseMarker}${legacyShowcase}`.trim());
  const legacy = await readFile(new URL('./fixtures/migrations/legacy-schema.sql', import.meta.url), 'utf8');
  assert.equal(migrations[0].sql.replace('  "issuer" TEXT,\n', ''), legacy);
  const alter = migrations[1].sql.replace(/^--.*$/gm, '').trim();
  assert.equal(alter, 'ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS issuer TEXT;');
  assert.match(migrations[2].sql, /CREATE TABLE IF NOT EXISTS "components"/);
  assert.doesNotMatch(migrations[2].sql, /ALTER TABLE public\.(users|builds|runs)/);
});

test('community migration is additive, repeatable and preserves existing rows', async () => {
  const migration = (await loadMigrations()).find(item => item.version === '0003');
  assert(migration);
  assert.doesNotMatch(migration.sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE /i);
  for (const table of [
    'components', 'component_versions', 'component_attachments',
    'component_test_suites', 'component_test_suite_versions', 'component_test_runs',
    'publication_requests', 'publication_reviews', 'component_releases',
    'component_usage_references', 'extension_applications',
  ]) {
    assert.match(migration.sql, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }
  const fake = fakeDatabase();
  const legacyRow = { version: '0001', name: first.name, checksum: first.checksum, legacy: true };
  fake.rows().push(legacyRow);
  await runMigrations(fake.database, [first, migration]);
  assert.equal(fake.rows().filter(row => row.legacy).length, 1);
  await runMigrations(fake.database, [first, migration]);
  assert.equal(fake.rows().filter(row => row.legacy).length, 1);
  assert.equal(fake.rows().filter(row => row.version === '0003').length, 1);
});

test('community audit migration is additive, repeatable and preserves existing rows', async () => {
  const migration = (await loadMigrations()).find(item => item.version === '0004');
  assert(migration);
  assert.doesNotMatch(migration.sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE /i);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS \"community_audit_events\"/);
  assert.match(migration.sql, /\"component_version_id\" TEXT REFERENCES/);
  assert.match(migration.sql, /\"publication_request_id\" TEXT REFERENCES/);
  const fake = fakeDatabase();
  const legacyRow = { version: '0001', name: first.name, checksum: first.checksum, legacy: true };
  fake.rows().push(legacyRow);
  await runMigrations(fake.database, [first, migration]);
  assert.equal(fake.rows().filter(row => row.legacy).length, 1);
  await runMigrations(fake.database, [first, migration]);
  assert.equal(fake.rows().filter(row => row.legacy).length, 1);
  assert.equal(fake.rows().filter(row => row.version === '0004').length, 1);
});

test('component attachment contents migration is additive, repeatable and preserves existing rows', async () => {
  const migration = (await loadMigrations()).find(item => item.version === '0005');
  assert(migration);
  assert.doesNotMatch(migration.sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE /i);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS \"component_attachment_contents\"/);
  assert.match(migration.sql, /PRIMARY KEY REFERENCES \"component_attachments\"/);
  assert.match(migration.sql, /octet_length\(\"content\"\) <= 262144/);
  const fake = fakeDatabase();
  const legacyRow = { version: '0001', name: first.name, checksum: first.checksum, legacy: true };
  fake.rows().push(legacyRow);
  await runMigrations(fake.database, [first, migration]);
  assert.equal(fake.rows().filter(row => row.legacy).length, 1);
  await runMigrations(fake.database, [first, migration]);
  assert.equal(fake.rows().filter(row => row.legacy).length, 1);
  assert.equal(fake.rows().filter(row => row.version === '0005').length, 1);
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
