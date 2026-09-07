import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Migration, MigrationTransaction } from './migration-runner.ts';

/** Catalog structure only: never read application data or credential values. */
export async function migrationSchemaDigest(transaction: MigrationTransaction): Promise<string> {
  const rows = await transaction.query(`
    SELECT kind, name, detail FROM (
      SELECT 'relation' AS kind, c.relname AS name,
        jsonb_build_array(c.relkind, c.relrowsecurity, c.relforcerowsecurity)::text AS detail
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname <> 'schema_migrations'
        AND c.relkind IN ('r','p','v','m','S','f')
      UNION ALL
      SELECT 'column', c.relname || '.' || a.attname,
        jsonb_build_array(format_type(a.atttypid,a.atttypmod), a.attnotnull,
          pg_get_expr(d.adbin,d.adrelid), a.attidentity, a.attgenerated)::text
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relname <> 'schema_migrations'
        AND c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'constraint', c.relname || '.' || p.conname,
        jsonb_build_array(pg_get_constraintdef(p.oid),p.convalidated)::text
      FROM pg_constraint p JOIN pg_class c ON c.oid = p.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname <> 'schema_migrations'
      UNION ALL
      SELECT 'index', c.relname || '.' || i.relname,
        jsonb_build_array(pg_get_indexdef(i.oid), x.indisvalid,x.indisready)::text
      FROM pg_index x JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname <> 'schema_migrations'
      UNION ALL
      SELECT 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'policy', tablename || '.' || policyname,
        jsonb_build_array(permissive,roles,cmd,qual,with_check)::text
      FROM pg_policies WHERE schemaname = 'public'
    ) objects ORDER BY kind COLLATE "C", name COLLATE "C", detail COLLATE "C"
  `);
  return createHash('sha256').update(JSON.stringify(Array.from(rows))).digest('hex');
}

export function migrationPrefixDigest(history: readonly Migration[]): string {
  return createHash('sha256').update(JSON.stringify(history.map(({version,name,checksum}) => ({version,name,checksum})))).digest('hex');
}

/** Frozen catalog fingerprints for the two audited histories; no ledger mutation. */
export async function assertHistoricalSchema(
  transaction: MigrationTransaction,
  history: readonly Migration[],
): Promise<void> {
  if (history.length === 0 || history.length > 9) return;
  const manifest: Record<string, string> = JSON.parse(await readFile(
    new URL('../src/db/migrations/historical/schema-fingerprints.json', import.meta.url), 'utf8'));
  const expected = manifest[migrationPrefixDigest(history)];
  if (!expected || await migrationSchemaDigest(transaction) !== expected) {
    throw new Error('Migration history mismatch; applied schema drift. Restore the audited schema before upgrading.');
  }
}
