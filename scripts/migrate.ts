import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { database } from '../src/db/index.ts';

export async function migrate() {
  const raw = await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
  const ddl = raw.replace(/^\s*BEGIN\s*;/im, '').replace(/^\s*COMMIT\s*;/im, '').trim();
  await database().sql.begin(async tx => {
    await tx.unsafe(ddl);
  });
  console.log('Database schema is ready.');
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  try {
    await migrate();
  } finally {
    await database().sql.end();
  }
}
