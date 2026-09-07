import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  nodeMeetsPiEngine,
  piRuntimeEnabled,
  resolvePiRuntimeGate,
  testModelsEnabled,
} from '../src/server/environment.ts';
import { seedCore } from '../src/server/seed-core.ts';
import { ArenaService } from '../src/server/service.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import { starterWorkflow } from '../src/shared/catalog.ts';
import { testWorkflow } from './helpers/workflow.ts';

test('test models require explicit test environment and opt-in', () => {
  for (const APP_ENV of [undefined, 'development', 'production']) {
    assert.equal(testModelsEnabled({ APP_ENV, DEMO_MODE: 'true' }), false);
  }
  assert.equal(testModelsEnabled({ APP_ENV: 'test' }), false);
  assert.equal(testModelsEnabled({ APP_ENV: 'test', DEMO_MODE: 'true' }), true);
});

test('Pi runtime flag is the exact string true and ignores DEMO_MODE', () => {
  assert.equal(piRuntimeEnabled({}), false);
  assert.equal(piRuntimeEnabled({ PI_RUNTIME_ENABLED: undefined }), false);
  assert.equal(piRuntimeEnabled({ PI_RUNTIME_ENABLED: 'TRUE' }), false);
  assert.equal(piRuntimeEnabled({ PI_RUNTIME_ENABLED: '1' }), false);
  assert.equal(piRuntimeEnabled({ PI_RUNTIME_ENABLED: 'yes' }), false);
  assert.equal(piRuntimeEnabled({ PI_RUNTIME_ENABLED: 'true' }), true);
  assert.equal(piRuntimeEnabled({ PI_RUNTIME_ENABLED: 'true', DEMO_MODE: 'false' }), true);
  assert.equal(piRuntimeEnabled({ PI_RUNTIME_ENABLED: 'TRUE', DEMO_MODE: 'true' }), false);
  assert.equal(piRuntimeEnabled({ DEMO_MODE: 'true', APP_ENV: 'test' }), false);
});

test('Pi runtime Node engine compares against 22.19.0 without raising the app baseline', () => {
  assert.equal(nodeMeetsPiEngine('22.16.0'), false);
  assert.equal(nodeMeetsPiEngine('22.18.9'), false);
  assert.equal(nodeMeetsPiEngine('22.19.0'), true);
  assert.equal(nodeMeetsPiEngine('v22.19.0'), true);
  assert.equal(nodeMeetsPiEngine('22.19.1'), true);
  assert.equal(nodeMeetsPiEngine('23.0.0'), true);

  assert.deepEqual(resolvePiRuntimeGate({}, '22.19.0'), { ok: false, reason: 'flag_off' });
  assert.deepEqual(resolvePiRuntimeGate({ PI_RUNTIME_ENABLED: 'TRUE' }, '22.19.0'), { ok: false, reason: 'flag_off' });
  assert.deepEqual(resolvePiRuntimeGate({ PI_RUNTIME_ENABLED: '1', DEMO_MODE: 'true' }, '22.19.0'), { ok: false, reason: 'flag_off' });
  assert.deepEqual(
    resolvePiRuntimeGate({ PI_RUNTIME_ENABLED: 'true' }, '22.16.0'),
    { ok: false, reason: 'node_engine' }
  );
  assert.deepEqual(resolvePiRuntimeGate({ PI_RUNTIME_ENABLED: 'true' }, '22.19.0'), { ok: true });
  assert.deepEqual(
    resolvePiRuntimeGate({ PI_RUNTIME_ENABLED: 'true', DEMO_MODE: 'false', APP_ENV: 'production' }, 'v22.19.0'),
    { ok: true }
  );
});

test('reference initialization is idempotent, repairs partial catalogs and preserves existing records', async () => {
  const repo = new MemoryRepository();
  await seedCore(repo);
  for (const table of ['users', 'builds', 'runs', 'submissions', 'failureCases', 'reputations'] as const) {
    assert.equal((await repo.read(table)).length, 0);
  }
  const before = structuredClone(repo.state);
  await seedCore(repo);
  assert.deepEqual(repo.state, before);
  const skill = before.skills[0];
  await repo.remove('skills', { id: skill.id });
  await repo.update('problems', { id: 'messy-json' }, { title: 'Existing edited title' });
  await seedCore(repo);
  assert.deepEqual((await repo.read('skills', { id: skill.id }))[0], skill);
  assert.equal((await repo.read('problems', { id: 'messy-json' }))[0].title, 'Existing edited title');
});

test('unconfigured builds save but cannot execute, including in test mode', async () => {
  const repo = new MemoryRepository();
  await seedTestArena(repo);
  const service = new ArenaService(repo, {
    demoMode: true, encryptionKey: randomBytes(32).toString('base64'), allowedHosts: [],
  });
  const build = await service.saveBuild('seed-user-1', {
    problemId: 'messy-json', title: 'Unconfigured draft', visibility: 'private', workflow: starterWorkflow('json'),
  });
  await assert.rejects(service.run('seed-user-1', { buildId: build.id, kind: 'public' }, () => {}), /Select a provider/);
});

test('old Demo builds remain intact and cannot run when Demo is disabled', async () => {
  const repo = new MemoryRepository();
  await seedTestArena(repo);
  const before = structuredClone(repo.state);
  const service = new ArenaService(repo, {
    demoMode: false, encryptionKey: randomBytes(32).toString('base64'), allowedHosts: [],
  });
  await assert.rejects(service.run('seed-user-1', { buildId: 'seed-build-01', kind: 'public' }, () => {}), /Demo mode is disabled/);
  assert.deepEqual(repo.state, before);
  assert.equal((await service.boot()).runtime, 'next');
  assert.deepEqual(await service.leaderboard({}), []);
  const overview = await service.overview();
  assert.equal(overview.stats.runs, 0);
  assert.equal(overview.stats.builders, 0);
  assert.equal(overview.stats.builds, 0);
  assert(overview.problems.every(problem => problem.stats.bestScore === 0));
  assert(overview.skills.every(skill => skill.successRate === null));
});

test('explicit test workflow executes offline in the shared service', async () => {
  const repo = new MemoryRepository();
  await seedTestArena(repo);
  const service = new ArenaService(repo, {
    demoMode: true, encryptionKey: randomBytes(32).toString('base64'), allowedHosts: [],
  });
  const build = await service.saveBuild('seed-user-1', {
    problemId: 'messy-json', title: 'Offline regression', visibility: 'private', workflow: testWorkflow('json'),
  });
  const run = await service.run('seed-user-1', { buildId: build.id, kind: 'public' }, () => {});
  assert.equal(run.summary.tier, 'demo');
  assert.equal(run.summary.total, 4);
});
