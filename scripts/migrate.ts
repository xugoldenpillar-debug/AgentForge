import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { database } from '../src/db/index.ts';
import { loadMigrations, runMigrations, runMigrationCommand } from './migration-runner.ts';

let openedSql: ReturnType<typeof database>['sql'] | undefined;

export async function migrate() {
  const migrations = await loadMigrations();
  const result = await runMigrations({
    async transaction(work) {
      // postgres.js reserves a connection for this callback; the pool stays unchanged.
      openedSql = database().sql;
      return openedSql.begin(async tx => work({
        async query(sql, parameters = []) {
          return await tx.unsafe(sql, parameters);
        },
      }));
    },
  }, migrations);
  console.log(`Database schema is ready (${result.applied.length} applied, ${result.skipped} unchanged).`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const succeeded = await runMigrationCommand(
    migrate,
    async () => { await openedSql?.end(); },
    message => console.error(message),
  );
  if (!succeeded) process.exitCode = 1;
}
