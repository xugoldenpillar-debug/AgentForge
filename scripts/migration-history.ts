// Audited integration of main 04a53c8a400404a38d9c35240b4204a5ba9ed629
// and Pi 8b5d19faeada98748537c8f6a55a4143d21e1908. Never rewrite
// physical ledger records: each recognized lineage remains an exact prefix.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Migration, MigrationTransaction } from './migration-runner.ts';

export const CANONICAL_HISTORY = [
  {
    "name": "0001_initial_schema.sql",
    "checksum": "dfc41fc5847c24de08c560e1dcb08d6b3a0f8cbb7ffd7b05143858dec97b4276"
  },
  {
    "name": "0002_accounts_issuer.sql",
    "checksum": "e164a8291f6585edf5d54e8fab214988d685119fefefe0253d44ad34ee9536d9"
  },
  {
    "name": "0003_community_component_library.sql",
    "checksum": "d190ab5f87fd0422b37d812ffadc247f19bda93c9cc206beb1053d228fc1bbe7"
  },
  {
    "name": "0004_community_audit_events.sql",
    "checksum": "61059013190bc2eeaffb8ca2f7ed34a32bdcf1d9045a5ad4e60dbf1e967df002"
  },
  {
    "name": "0005_component_attachment_contents.sql",
    "checksum": "3bde34e78a9fca478ce4e7ad92fe4a013eec55cb00adc9af8dd798a8d440fc92"
  },
  {
    "name": "0006_evaluation_foundation.sql",
    "checksum": "83909b3229705d2dfc6eeb74a0138bd0e1bc16b2753806345cace0bfe2a19b89"
  },
  {
    "name": "0007_runs_runtime_identity.sql",
    "checksum": "92bdb302cf816ee14afd73e87aab830651a85e37ac681c71a39200ebc1ea022c"
  },
  {
    "name": "0008_users_pi_runtime_access.sql",
    "checksum": "80d716f01b2307fdd4d39dff686f4906904c55f6820787c7ee8b48e5749145e9"
  },
  {
    "name": "0009_agent_build_drafts.sql",
    "checksum": "c663a23cb0b27e201ae1f8567a278230485c18304f834a6ddb1045ad625e7d61"
  }
] as const;

export const PI_SOURCE_COMMIT = '8b5d19faeada98748537c8f6a55a4143d21e1908';
export const MAIN_SOURCE_COMMIT = '04a53c8a400404a38d9c35240b4204a5ba9ed629';
export const PI_HISTORICAL_NAMES = [
  "0003_runs_runtime_identity.sql",
  "0004_users_pi_runtime_access.sql",
  "0005_agent_build_drafts.sql"
] as const;

function matches(row: Record<string, unknown>, migration: Migration): boolean {
  return row.version === migration.version && row.name === migration.name && row.checksum === migration.checksum;
}

/** The compatibility exception is restricted to the entire golden integration release. */
export async function selectMigrationHistory(
  canonical: readonly Migration[],
  rows: readonly Record<string, unknown>[],
): Promise<readonly Migration[]> {
  if (rows[2]?.name !== PI_HISTORICAL_NAMES[0]) return canonical;
  if (CANONICAL_HISTORY.some((identity, index) => {
    const entry = canonical[index];
    return !entry || entry.name !== identity.name || entry.checksum !== identity.checksum;
  })) {
    throw new Error('Migration history mismatch; unrecognized integration source.');
  }
  const pi = await Promise.all(PI_HISTORICAL_NAMES.map(async (name, index) => {
    const source = canonical[index + 6];
    const sql = await readFile(new URL(`../src/db/migrations/historical/pi-runtime-poc/${name}`, import.meta.url), 'utf8');
    if (createHash('sha256').update(sql).digest('hex') !== source.checksum) {
      throw new Error('Migration history mismatch; historical source drift.');
    }
    return { ...source, sql, name, version: name.slice(0, 4) };
  }));
  // These community/EF migrations were NOT applied in Pi history. They are
  // executed once under new physical IDs, not aliases of old ledger rows.
  const remainingMain = canonical.slice(2, 6).map((migration, index) => {
    const version = String(index + 6).padStart(4, '0');
    return { ...migration, version, name: `${version}${migration.name.slice(4)}` };
  });
  const ordered = [...canonical.slice(0, 2), ...pi, ...remainingMain, ...canonical.slice(9)];
  if (rows.some((row, index) => !ordered[index] || !matches(row, ordered[index]))) {
    throw new Error('Migration history mismatch; unrecognized Pi prefix.');
  }
  return ordered;
}

/** IF NOT EXISTS must not adopt pre-created objects during branch reconciliation. */
export async function assertPendingHistoryObjectsAbsent(
  transaction: MigrationTransaction,
  migration: Migration,
): Promise<void> {
  const tablePattern = /CREATE TABLE IF NOT EXISTS\s+(?:public\.)?"?([a-z_]+)"?\s*\(/g;
  for (const match of migration.sql.matchAll(tablePattern)) {
    const rows = await transaction.query('SELECT to_regclass($1) AS object', [`public.${match[1]}`]);
    if (rows[0]?.object != null) {
      throw new Error('Migration history mismatch; pre-created reconciliation table.');
    }
  }
  // Index names share pg_class's namespace with tables. IF NOT EXISTS must
  // never silently accept an index on another table or a different definition.
  const indexPattern = /CREATE\s+(?:UNIQUE\s+)?INDEX IF NOT EXISTS\s+(?:public\.)?"?([a-z_]+)"?/g;
  for (const match of migration.sql.matchAll(indexPattern)) {
    const rows = await transaction.query('SELECT to_regclass($1) AS object', [`public.${match[1]}`]);
    if (rows[0]?.object != null) {
      throw new Error('Migration history mismatch; pre-created reconciliation index.');
    }
  }
  const columnPattern = /ALTER TABLE\s+(?:public\.)?"?([a-z_]+)"?\s+ADD COLUMN IF NOT EXISTS\s+"?([a-z_]+)"?/g;
  for (const match of migration.sql.matchAll(columnPattern)) {
    const rows = await transaction.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
      [match[1], match[2]],
    );
    if (rows.length) throw new Error('Migration history mismatch; pre-created reconciliation column.');
  }
}

/** Validate immutable release sources even on a fresh database with no ledger. */
export async function assertGoldenMigrationSources(canonical: readonly Migration[]): Promise<void> {
  if (CANONICAL_HISTORY.some((identity, index) => {
    const entry = canonical[index];
    return !entry || entry.name !== identity.name || entry.checksum !== identity.checksum;
  })) throw new Error('Migration history mismatch; frozen canonical source drift.');
  for (const [index, name] of PI_HISTORICAL_NAMES.entries()) {
    const bytes = await readFile(new URL(`../src/db/migrations/historical/pi-runtime-poc/${name}`, import.meta.url));
    if (createHash('sha256').update(bytes).digest('hex') !== CANONICAL_HISTORY[index + 6].checksum) {
      throw new Error('Migration history mismatch; frozen historical source drift.');
    }
  }
}
