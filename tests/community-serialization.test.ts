import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DrizzleRepository } from '../src/db/repository.ts';
import { tableRegistry } from '../src/db/schema.ts';
import type {
  Build,
  BuildVersion,
  CommunityAuditEventRow,
  Component,
  ComponentVersion,
  PublicationRequest,
  Repository,
  TableName,
  Tables,
} from '../src/shared/types.ts';

type FakeOrm = {
  rows: Map<object, unknown[]>;
  insert(table: object): { values(rows: Record<string, unknown>[]): Promise<void> };
  select(): { from(table: object): { where(condition: unknown): Promise<unknown[]> } };
};

function fakeOrm(): FakeOrm {
  const rows = new Map<object, unknown[]>();
  return {
    rows,
    insert(table) {
      return {
        values: async (values) => {
          rows.set(table, structuredClone(values));
        },
      };
    },
    select() {
      return {
        from(table) {
          return {
            where: async (_condition) => structuredClone(rows.get(table) ?? []),
          };
        },
      };
    },
  };
}

const now = '2026-09-06T00:00:00.000Z';

const component: Component = {
  id: 'component-serialization',
  ownerId: 'owner-serialization',
  name: 'Serialization component',
  description: 'A component with nested JSONB values.',
  kind: 'instruction-skill',
  visibility: 'private',
  draftRevision: 3,
  draftDefinition: {
    formatVersion: 1,
    kind: 'instruction-skill',
    instruction: 'Keep nested values unchanged.',
    metadata: { labels: ['community', 'serialization'] },
  },
  currentVersionId: 'component-version-serialization',
  createdAt: now,
  updatedAt: now,
};

const version: ComponentVersion = {
  id: 'component-version-serialization',
  ownerId: component.ownerId,
  componentId: component.id,
  versionNumber: 2,
  contractVersion: 1,
  definition: {
    formatVersion: 1,
    kind: 'instruction-skill',
    instruction: 'Keep nested values unchanged.',
    references: [{ path: 'references/guide.txt', content: 'plain text' }],
  },
  definitionDigest: 'sha256:definition',
  dependencies: [{ id: 'structured', version: '1' }],
  publicMaterial: {
    kind: 'instruction-skill',
    instruction: 'Keep nested values unchanged.',
    examples: [{ id: 'example-1', visibility: 'public' }],
  },
  licenseSpdx: 'MIT',
  provenance: { sourceType: 'original', declaration: 'Created for serialization regression coverage.' },
  frozenAt: now,
  createdAt: now,
};

const publicationRequest: PublicationRequest = {
  id: 'publication-request-serialization',
  componentVersionId: version.id,
  requesterId: component.ownerId,
  status: 'submitted',
  requestRevision: 1,
  publicMaterialSnapshot: {
    kind: 'instruction-skill',
    instruction: 'Keep nested values unchanged.',
    references: ['references/guide.txt'],
  },
  declaration: 'I have the right to publish this component.',
  createdAt: now,
  updatedAt: now,
  decidedAt: null,
};

const auditEvent: CommunityAuditEventRow = {
  id: 'audit-event-serialization',
  action: 'publication.requested',
  actorId: component.ownerId,
  componentId: component.id,
  componentVersionId: version.id,
  publicationRequestId: publicationRequest.id,
  occurredAt: now,
  metadata: {
    requestRevision: 1,
    public: false,
    reason: null,
  },
};

const legacyBuild: Build = {
  id: 'legacy-build-serialization',
  problemId: 'legacy-problem',
  userId: component.ownerId,
  title: 'Legacy Build',
  visibility: 'private',
  currentVersionId: 'legacy-build-version-serialization',
  parentBuildId: null,
  createdAt: now,
  updatedAt: now,
};

const legacyBuildVersion: BuildVersion = {
  id: legacyBuild.currentVersionId,
  buildId: legacyBuild.id,
  revision: 4,
  title: legacyBuild.title,
  visibility: legacyBuild.visibility,
  createdAt: now,
};

async function insertAndRead<K extends TableName>(repository: Repository, table: K, row: Tables[K]): Promise<Tables[K]> {
  await repository.insert(table, [row]);
  return (await repository.read(table))[0];
}

test('Drizzle repository round-trips community JSONB, nullable fields and every community timestamp', async () => {
  const orm = fakeOrm();
  const repository = new DrizzleRepository(orm, null as never);

  const storedComponent = await insertAndRead(repository, 'components', component);
  const storedVersion = await insertAndRead(repository, 'componentVersions', version);
  const storedRequest = await insertAndRead(repository, 'publicationRequests', publicationRequest);
  const storedAudit = await insertAndRead(repository, 'communityAuditEvents', auditEvent);

  assert.deepEqual(storedComponent, component);
  assert.deepEqual(storedVersion, version);
  assert.deepEqual(storedRequest, publicationRequest);
  assert.deepEqual(storedAudit, auditEvent);

  const rawComponent = orm.rows.get(tableRegistry.components)?.[0] as Record<string, unknown>;
  const rawVersion = orm.rows.get(tableRegistry.componentVersions)?.[0] as Record<string, unknown>;
  const rawRequest = orm.rows.get(tableRegistry.publicationRequests)?.[0] as Record<string, unknown>;
  const rawAudit = orm.rows.get(tableRegistry.communityAuditEvents)?.[0] as Record<string, unknown>;
  assert(rawComponent.createdAt instanceof Date);
  assert(rawComponent.updatedAt instanceof Date);
  assert(rawVersion.frozenAt instanceof Date);
  assert(rawVersion.createdAt instanceof Date);
  assert(rawRequest.createdAt instanceof Date);
  assert(rawRequest.updatedAt instanceof Date);
  assert(rawAudit.occurredAt instanceof Date);

  (storedVersion.definition as { references: Array<{ content: string }> }).references[0].content = 'mutated after read';
  assert.deepEqual(await repository.read('componentVersions'), [version]);
});

test('repository serialization keeps legacy Build records unchanged alongside community records', async () => {
  const orm = fakeOrm();
  const repository = new DrizzleRepository(orm, null as never);

  await insertAndRead(repository, 'builds', legacyBuild);
  await insertAndRead(repository, 'buildVersions', legacyBuildVersion);
  await insertAndRead(repository, 'components', component);
  await insertAndRead(repository, 'componentVersions', version);
  await insertAndRead(repository, 'publicationRequests', publicationRequest);
  await insertAndRead(repository, 'communityAuditEvents', auditEvent);

  assert.deepEqual(await repository.read('builds'), [legacyBuild]);
  assert.deepEqual(await repository.read('buildVersions'), [legacyBuildVersion]);
  assert.equal((await repository.read('builds'))[0].currentVersionId, legacyBuildVersion.id);
  assert.equal((await repository.read('buildVersions'))[0].revision, legacyBuildVersion.revision);
});
