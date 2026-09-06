import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationTransaction {
  query(sql: string, parameters?: string[]): Promise<readonly Record<string, unknown>[]>;
}

export interface MigrationResult {
  applied: string[];
  skipped: number;
}

export interface MigrationDatabase {
  transaction(work: (transaction: MigrationTransaction) => Promise<MigrationResult>): Promise<MigrationResult>;
}

export const migrationDirectory = new URL('../src/db/migrations/', import.meta.url);

export function parseMigration(name: string, sql: string): Migration {
  const match = /^(\d{4})_([a-z][a-z0-9_]*)\.sql$/.exec(name);
  if (!match || match[1] === '0000' || !sql.trim()) {
    throw new Error(`Invalid migration: ${name}`);
  }
  // Trusted, reviewed repository SQL only, not an arbitrary SQL sandbox. This
  // deliberately conservative guard also rejects keywords in comments/literals
  // and procedural bodies; migration authors must not manage transactions.
  if (/\b(?:BEGIN|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE|START|TRANSACTION)\b/i.test(sql)) {
    throw new Error(`Transaction control is forbidden in migration: ${name}`);
  }
  return {
    version: match[1],
    name,
    sql,
    checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
  };
}

export async function loadMigrations(directory: URL = migrationDirectory): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations = await Promise.all(entries.filter(entry => entry.name.endsWith('.sql')).map(async entry => {
    if (!entry.isFile()) throw new Error(`Migration is not a regular file: ${entry.name}`);
    return parseMigration(entry.name, await readFile(new URL(entry.name, directory), 'utf8'));
  }));
  return validateMigrations(migrations);
}

function validateMigrations(migrations: readonly Migration[]): Migration[] {
  if (migrations.length === 0) throw new Error('No migrations found; refusing to mark schema ready.');
  const ordered = [...migrations].sort((a, b) => a.version.localeCompare(b.version));
  for (const [index, migration] of ordered.entries()) {
    const parsed = parseMigration(migration.name, migration.sql);
    if (parsed.version !== migration.version || parsed.checksum !== migration.checksum) {
      throw new Error(`Invalid migration metadata: ${migration.name}`);
    }
    if (ordered[index - 1]?.version === migration.version) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
  }
  return ordered;
}

export async function runMigrations(database: MigrationDatabase, migrations: readonly Migration[]) {
  const ordered = validateMigrations(migrations);
  // One pinned transaction makes the complete batch atomic and releases the lock on
  // both rollback and commit. Never run BEGIN or session locks on pooled queries.
  return database.transaction(async transaction => {
    await transaction.query("SET LOCAL search_path TO public, pg_catalog");
    await transaction.query("SET LOCAL lock_timeout TO '30s'");
    await transaction.query('SELECT pg_catalog.pg_advisory_xact_lock(1095124551, 1)');
    // Lock before ledger creation: simultaneous first boots must not race in pg_type.
    await transaction.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = await transaction.query('SELECT version, name, checksum FROM public.schema_migrations ORDER BY version');
    // Applied history must be an exact prefix, including files from newer releases.
    // Fail closed on deletion, renaming, modification, or retroactive insertion.
    for (const [index, row] of applied.entries()) {
      const expected = ordered[index];
      if (!expected || row.version !== expected.version || row.name !== expected.name || row.checksum !== expected.checksum) {
        throw new Error('Migration history mismatch; restore the original files and append a new migration.');
      }
    }
    const newlyApplied: string[] = [];
    for (const migration of ordered.slice(applied.length)) {
      await transaction.query(migration.sql);
      await transaction.query(
        'INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      );
      newlyApplied.push(migration.name);
    }
    return { applied: newlyApplied, skipped: applied.length };
  });
}

// Never serialize driver errors: they may contain SQL, connection URLs or values.
// Cleanup runs after failure but cannot replace the primary failure diagnostic.
export async function runMigrationCommand(
  work: () => Promise<unknown>,
  cleanup: () => Promise<unknown>,
  reportError: (message: string) => void,
): Promise<boolean> {
  let succeeded = true;
  try {
    await work();
  } catch {
    succeeded = false;
    reportError('Database migration failed. Check configuration and migration history; error details are suppressed to protect secrets.');
  } finally {
    try {
      await cleanup();
    } catch {
      succeeded = false;
      reportError('Database migration connection cleanup failed; error details are suppressed to protect secrets.');
    }
  }
  return succeeded;
}
