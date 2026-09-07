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
    const expectedMigrationVersions = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012'];
    assert.deepEqual(migrations.map(migration => migration.version), expectedMigrationVersions);
    const expectedMigrationCount = expectedMigrationVersions.length;
    assert.ok(migrations.some(migration => migration.name === '0006_evaluation_foundation.sql'));
    await runMigrations(database, migrations);
    assert.equal((await runMigrations(database, migrations)).skipped, expectedMigrationCount);
    assert.equal((await sql`SELECT * FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'issuer'`).length, 1);
    assert.equal((await sql`SELECT * FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'community_audit_events'`).length, 1);
    assert.equal((await sql`SELECT * FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'component_attachment_contents'`).length, 1);
    assert.equal((await sql`SELECT 1 FROM pg_constraint WHERE conname = 'component_attachment_contents_content_size_check'`).length, 1);
    const durableTables = [
      'evaluation_jobs',
      'evaluation_attempts',
      'evaluation_invocations',
      'evaluation_usage_records',
      'evaluation_idempotency_keys',
      'evaluation_budget_reservations',
      'evaluation_outbox',
      'work_publications',
      'showcase_entries',
      'showcase_ballots',
      'showcase_votes',
      'showcase_audit_events',
      'animation_challenges',
      'animation_challenge_versions',
    ];
    const freshTables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ${sql(durableTables)}
      ORDER BY table_name
    `;
    assert.deepEqual(freshTables.map(row => row.table_name), [...durableTables].sort());
    const { ANIMATION_CHALLENGES, ANIMATION_CHALLENGE_VERSIONS } = await import('../src/server/animation-challenges.ts');
    for (const challenge of ANIMATION_CHALLENGES) {
      await sql`INSERT INTO animation_challenges(id, slug, position, status)
        VALUES (${challenge.id}, ${challenge.slug}, ${challenge.position}, ${challenge.status})`;
    }
    for (const version of ANIMATION_CHALLENGE_VERSIONS) {
      await sql`INSERT INTO animation_challenge_versions
        (id, challenge_id, version_number, title, title_en, instructions, instructions_en, output_policy_version, content_digest)
        VALUES (${version.id}, ${version.challengeId}, ${version.versionNumber}, ${version.title},
          ${version.titleEn}, ${version.instructions}, ${version.instructionsEn}, ${version.outputPolicyVersion}, ${version.contentDigest})`;
    }
    const catalogBefore = await sql`SELECT * FROM animation_challenge_versions ORDER BY id`;
    // Replaying this additive DDL preserves both versions and all original bytes.
    await sql.unsafe(migrations.at(-1)!.sql);
    assert.deepEqual(await sql`SELECT * FROM animation_challenge_versions ORDER BY id`, catalogBefore);
    await assert.rejects(sql`INSERT INTO animation_challenges(id, slug, position, status)
      VALUES ('duplicate-slug', 'pelican-bike', 3, 'published')`, { code: '23505' });
    await assert.rejects(sql`DELETE FROM animation_challenges WHERE slug = 'pelican-bike'`, { code: '23503' });
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
    const legacyBuildBefore = await connection.unsafe(`SELECT id, problem_id, user_id, title, visibility, current_version_id, parent_build_id, created_at, updated_at FROM public.builds WHERE id = 'migration-build'`);
    const legacyBuildVersionBefore = await connection.unsafe(`SELECT id, build_id, revision, title, visibility, created_at FROM public.build_versions WHERE id = 'migration-version'`);
    const concurrent = await Promise.all([runMigrations(database, migrations), runMigrations(database, migrations)]);
    assert.deepEqual(concurrent.map(result => result.applied.length).sort(), [0, expectedMigrationCount]);
    assert.equal(await snapshot(), before);
    assert.deepEqual(await connection.unsafe(`SELECT id, problem_id, user_id, title, visibility, current_version_id, parent_build_id, created_at, updated_at FROM public.builds WHERE id = 'migration-build'`), legacyBuildBefore);
    assert.deepEqual(await connection.unsafe(`SELECT id, build_id, revision, title, visibility, created_at FROM public.build_versions WHERE id = 'migration-version'`), legacyBuildVersionBefore);
    assert.equal((await runMigrations(database, migrations)).skipped, expectedMigrationCount);
    assert.equal(await snapshot(), before);
    const recoveryVersion = String(Number(migrations.at(-1)!.version) + 1).padStart(4, '0');
    const bad = parseMigration(`${recoveryVersion}_failure.sql`, 'CREATE TABLE public.rollback_probe (id TEXT); SELECT 1/0;');
    await assert.rejects(runMigrations(database, [...migrations, bad]));
    assert.equal((await sql`SELECT to_regclass('public.rollback_probe') AS name`)[0].name, null);
    assert.equal((await sql`SELECT * FROM public.schema_migrations`).length, expectedMigrationCount);
    const good = parseMigration(`${recoveryVersion}_recovery.sql`, 'CREATE TABLE public.rollback_probe (id TEXT);');
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
