import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMigrations, parseMigration } from '../scripts/migration-runner.ts';
import { CANONICAL_HISTORY, PI_HISTORICAL_NAMES, assertGoldenMigrationSources, selectMigrationHistory, assertPendingHistoryObjectsAbsent } from '../scripts/migration-history.ts';

const physical = (migration: {version: string; name: string; checksum: string}) => ({
  version: migration.version, name: migration.name, checksum: migration.checksum,
});

test('golden sources retain both original identities and bytes', async () => {
  const canonical = await loadMigrations();
  await assertGoldenMigrationSources(canonical);
  for (const [index, identity] of CANONICAL_HISTORY.entries()) {
    assert.equal(canonical[index].checksum, identity.checksum);
  }
  const changed = [...canonical];
  changed[0] = parseMigration(changed[0].name, `${changed[0].sql}\n`);
  await assert.rejects(assertGoldenMigrationSources(changed), /source drift/);
});

test('only exact Pi prefixes select the audited alternate sequence; ledger input stays untouched', async () => {
  const canonical = await loadMigrations();
  const pi = PI_HISTORICAL_NAMES.map((name, index) => parseMigration(name, canonical[index + 6].sql));
  const history = [...canonical.slice(0, 2), ...pi];
  for (let size = 3; size <= 5; size++) {
    const rows = history.slice(0, size).map(physical);
    const before = structuredClone(rows);
    const selected = await selectMigrationHistory(canonical, rows);
    assert.deepEqual(rows, before);
    assert.deepEqual(selected.slice(0, 5).map(physical), history.map(physical));
    assert.deepEqual(selected.slice(5).map(row => row.name), [
      '0006_community_component_library.sql', '0007_community_audit_events.sql',
      '0008_component_attachment_contents.sql', '0009_evaluation_foundation.sql',
      '0010_artifact_arena_foundation.sql', '0011_artifact_arena_showcase.sql', '0012_animation_challenge_catalog.sql',
    ]);
    assert.equal(selected[5].checksum, canonical[2].checksum);
    assert.equal(selected.filter(row => row.sql.includes('ADD CONSTRAINT build_versions_mode_payload')).length, 1);
  }
  for (const bad of [
    [history[0], ...history.slice(2)],
    [history[0], history[1], history[2], canonical[3]],
    [...history, parseMigration('0006_unrecognized.sql', 'SELECT 1;')],
    [...history.slice(0, 4), parseMigration(history[4].name, `${history[4].sql}\n`)],
  ]) {
    const rows = bad.map(physical);
    // A hole before the distinguishing third row remains canonical and is rejected
    // by the ordinary runner prefix check; never activate compatibility loosely.
    if (rows[2]?.name === PI_HISTORICAL_NAMES[0]) {
      await assert.rejects(selectMigrationHistory(canonical, rows), /history mismatch/);
    } else assert.equal(await selectMigrationHistory(canonical, rows), canonical);
  }
});


test('pending EF indexes reject any existing relation with the reserved name', async () => {
  const canonical = await loadMigrations();
  for (const collision of ['evaluation_jobs_one_active_user_idx', 'evaluation_jobs_association_unique']) {
    await assert.rejects(assertPendingHistoryObjectsAbsent({
      async query(statement, values = []) {
        return statement.includes('to_regclass') && values[0] === `public.${collision}`
          ? [{object: collision}] : [];
      },
    }, canonical[5]), /pre-created reconciliation index/);
  }
});
