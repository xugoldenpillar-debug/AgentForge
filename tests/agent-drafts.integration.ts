import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DrizzleRepository } from '../src/db/repository.ts';
import { ArenaService } from '../src/server/service.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import { loadMigrations, runMigrations } from '../scripts/migration-runner.ts';
import type { Repository, User } from '../src/shared/types.ts';

const testUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!testUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(testUrl).hostname)) {
  throw new Error('Explicit local MIGRATION_TEST_DATABASE_URL required.');
}

test('PostgreSQL Agent saves overlap: exactly one CAS winner, stable conflict, no partial version', {timeout: 60000}, async () => {
  const name = `agentforge_b2_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(testUrl, {max: 2, onnotice: () => {}});
  let sql: ReturnType<typeof postgres> | undefined;
  let created = false;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(testUrl);
    url.pathname = `/${name}`;
    sql = postgres(url.toString(), {max: 6, onnotice: () => {}});
    const connection = sql;
    await runMigrations({transaction: work => connection.begin(async tx => work({query: async (statement, values = []) => tx.unsafe(statement, values)}))}, await loadMigrations());
    const repo = new DrizzleRepository(drizzle(connection), connection);
    const timestamp = new Date().toISOString();
    const user: User = {id: randomUUID(), name: 'B2 concurrency', email: `${randomUUID()}@example.invalid`,
      emailVerified: false, image: null, createdAt: timestamp, updatedAt: timestamp, elo: 1000, reputation: 0, isSeed: false};
    await seedTestArena(repo, user);
    const options = {demoMode: true, encryptionKey: randomBytes(32).toString('base64'), allowedHosts: []};
    const service = new ArenaService(repo, options);
    const body = {mode: 'agent', problemId: 'messy-json', title: 'Concurrent draft', visibility: 'private',
      agentDefinition: {mode: 'agent', definitionSchemaVersion: 1, instructions: 'Original'}};
    const saved = await service.saveBuild(user.id, body);
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => {release = resolve;});
    const gated = new Proxy(repo, {
      get(target, key) {
        if (key === 'transaction') return <T>(work: (tx: Repository) => Promise<T>) => target.transaction(tx => work(new Proxy(tx, {
          get(transaction, property) {
            if (property === 'read') return async (...args: Parameters<Repository['read']>) => {
              const rows = await transaction.read(...args);
              if (args[0] === 'builds' && args[1]?.id === saved.id && arrivals < 2) {
                arrivals++;
                if (arrivals === 2) release();
                await barrier;
              }
              return rows;
            };
            const value = Reflect.get(transaction, property);
            return typeof value === 'function' ? value.bind(transaction) : value;
          }
        })));
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const concurrentService = new ArenaService(gated, options);
    const update = {...body, buildId: saved.id, currentVersionId: saved.version.id};
    const results = await Promise.allSettled([
      concurrentService.saveBuild(user.id, {...update, title: 'Winner A'}),
      concurrentService.saveBuild(user.id, {...update, title: 'Winner B'})
    ]);
    assert.equal(arrivals, 2, 'Both transactions read the same old pointer before either writes');
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert(rejected?.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    assert(['BUILD_VERSION_CONFLICT', 'CONCURRENT_SAVE'].includes(rejected.reason.code));
    const versions = await repo.read('buildVersions', {buildId: saved.id});
    assert.deepEqual(versions.map(version => version.revision).sort(), [1, 2]);
    assert.equal(versions.find(version => version.revision === 1)?.agentDefinition?.instructions, 'Original');
    const current = await service.build(saved.id, user.id);
    assert.equal(current.version.revision, 2);
    assert.equal(current.title, current.version.title);
    await assert.rejects(service.saveBuild(user.id, update), {status: 409});
    assert.equal((await repo.read('buildVersions', {buildId: saved.id})).length, 2);
    const fork = await service.fork(user.id, saved.id, saved.version.id);
    assert.equal((await repo.read('forkRelations', {childBuildId: fork.id}))[0].sourceVersionId, saved.version.id);
    assert.equal((await repo.read('workflowNodes', {versionId: fork.version.id})).length, 0);
    await assert.rejects(connection`UPDATE build_versions SET agent_definition = '{}'::jsonb WHERE id = ${saved.version.id}`);
    await assert.rejects(connection`UPDATE build_versions SET visibility = 'public' WHERE id = ${saved.version.id}`);
    const repeated = await runMigrations({transaction: work => connection.begin(async tx => work({query: async (statement, values = []) => tx.unsafe(statement, values)}))}, await loadMigrations());
    assert.equal(repeated.skipped, 5);
    assert.equal((await service.build(saved.id, user.id)).version.id, current.version.id);
  } finally {
    await sql?.end({timeout: 5});
    if (created) await admin.unsafe(`DROP DATABASE "${name}"`);
    await admin.end({timeout: 5});
  }
});
