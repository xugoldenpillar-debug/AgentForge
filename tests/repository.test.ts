import assert from 'node:assert/strict';
import test from 'node:test';
import { DrizzleRepository } from '../src/db/repository.ts';

test('DrizzleRepository converts all nullable lifecycle timestamps to Date values', async () => {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const orm = {
    insert() {
      return {
        values(values: Record<string, unknown>[]) {
          inserts.push(...values);
          return Promise.resolve();
        },
      };
    },
    update() {
      return {
        set(values: Record<string, unknown>) {
          updates.push(values);
          return {
            where() {
              return { returning: async () => [] };
            },
          };
        },
      };
    },
  };
  const repository = new DrizzleRepository(orm, {} as never);
  const timestamp = '2026-09-08T00:00:00.000Z';

  await repository.insert('artifactBundles', [{ sealedAt: timestamp } as never]);
  await repository.update('artifactBundles', { id: 'bundle-1' }, { sealedAt: timestamp });
  await repository.update('workPublications', { id: 'publication-1' }, {
    reviewedAt: timestamp,
    withdrawnAt: timestamp,
  });
  await repository.update('showcaseBallots', { id: 'ballot-1' }, { issuedAt: timestamp });

  assert.equal(inserts.length, 1);
  assert.ok(inserts[0].sealedAt instanceof Date);
  assert.equal((inserts[0].sealedAt as Date).toISOString(), timestamp);
  assert.equal(updates.length, 3);
  assert.ok(updates[0].sealedAt instanceof Date);
  assert.ok(updates[1].reviewedAt instanceof Date);
  assert.ok(updates[1].withdrawnAt instanceof Date);
  assert.ok(updates[2].issuedAt instanceof Date);
  assert.equal((updates[0].sealedAt as Date).toISOString(), timestamp);
  assert.equal((updates[1].reviewedAt as Date).toISOString(), timestamp);
  assert.equal((updates[1].withdrawnAt as Date).toISOString(), timestamp);
  assert.equal((updates[2].issuedAt as Date).toISOString(), timestamp);
});
