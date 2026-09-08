import { seedAnimationChallenges } from './animation-challenges.ts';
import type { Repository, TableName, Tables } from '../shared/types.ts';
import { SKILLS, TOOLS, BADGES } from '../shared/catalog.ts';
import { PROBLEMS, TEST_CASES } from './fixtures.ts';
import { CREATION_ENVIRONMENT_DIGEST, CREATION_ENVIRONMENT_TEMPLATE } from './creation/catalog.ts';

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
    await insertMissing('environmentTemplates', [{
      id: CREATION_ENVIRONMENT_TEMPLATE.templateId,
      ownerId: null,
      scope: 'platform',
      name: CREATION_ENVIRONMENT_TEMPLATE.name,
      description: CREATION_ENVIRONMENT_TEMPLATE.description,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }]);
    await insertMissing('environmentTemplateVersions', [{
      id: CREATION_ENVIRONMENT_TEMPLATE.versionId,
      templateId: CREATION_ENVIRONMENT_TEMPLATE.templateId,
      versionNumber: CREATION_ENVIRONMENT_TEMPLATE.versionNumber,
      name: CREATION_ENVIRONMENT_TEMPLATE.name,
      description: CREATION_ENVIRONMENT_TEMPLATE.description,
      runtimeKind: 'pi',
      runtimeAdapterVersion: CREATION_ENVIRONMENT_TEMPLATE.runtime.adapterVersion,
      runtimePolicyVersion: CREATION_ENVIRONMENT_TEMPLATE.runtime.policyVersion,
      capabilities: CREATION_ENVIRONMENT_TEMPLATE.capabilities,
      limits: CREATION_ENVIRONMENT_TEMPLATE.limits,
      artifactPolicy: CREATION_ENVIRONMENT_TEMPLATE.artifactPolicy,
      contentDigest: CREATION_ENVIRONMENT_DIGEST,
      createdAt: '2026-09-07T00:00:00.000Z',
    }]);
    await seedAnimationChallenges(tx);
  });
}
