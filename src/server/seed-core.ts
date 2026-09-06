import type { Repository, TableName, Tables } from '../shared/types.ts';
import { SKILLS, TOOLS, BADGES } from '../shared/catalog.ts';
import { PROBLEMS, TEST_CASES } from './fixtures.ts';

/** Only reference content belongs in application initialization, never simulated activity. */
export async function seedCore(repo: Repository): Promise<void> {
  await repo.transaction(async tx => {
    async function insertMissing<K extends TableName>(table: K, rows: Tables[K][]) {
      const existing = new Set((await tx.read(table)).map(row => (row as Tables[K] & { id: string }).id));
      const missing = rows.filter(row => !existing.has((row as Tables[K] & { id: string }).id));
      if (missing.length) await tx.insert(table, missing);
    }
    await insertMissing('problems', PROBLEMS);
    await insertMissing('testCases', TEST_CASES);
    await insertMissing('skills', SKILLS);
    await insertMissing('tools', TOOLS);
    await insertMissing('badges', BADGES);
  });
}
