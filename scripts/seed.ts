import 'dotenv/config';
import { database } from '../src/db/index.ts';
import { DrizzleRepository } from '../src/db/repository.ts';
import { seedCore } from '../src/server/seed-core.ts';

export async function seed() {
  await seedCore(new DrizzleRepository());
  console.log('Reference catalog initialized. No accounts or simulated activity created.');
}
if (process.argv[1]?.endsWith('seed.ts')) {
  try {
    await seed();
  } finally {
    await database().sql.end();
  }
}
