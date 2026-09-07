import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { classifyProviderLane } from '../src/lib/ai/provider-lane.ts';
import { ArenaService } from '../src/server/service.ts';
import type { AIProvider } from '../src/lib/ai/types.ts';
import type { Tier, User } from '../src/shared/types.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import { testWorkflow } from './helpers/workflow.ts';

interface Scenario {
  name: string;
  providerId: 'platform' | 'demo' | 'custom';
  inputPrice: number | null;
  outputPrice: number | null;
  tier: Tier;
}
const scenarios: Scenario[] = [
  {name: 'platform missing input price', providerId: 'platform', inputPrice: null, outputPrice: 2, tier: 'byok'},
  {name: 'platform missing output price', providerId: 'platform', inputPrice: 1, outputPrice: null, tier: 'byok'},
  {name: 'platform missing both prices', providerId: 'platform', inputPrice: null, outputPrice: null, tier: 'byok'},
  {name: 'platform both prices known', providerId: 'platform', inputPrice: 1, outputPrice: 2, tier: 'verified'},
  {name: 'platform zero prices known', providerId: 'platform', inputPrice: 0, outputPrice: 0, tier: 'verified'},
  {name: 'Demo with priced platform available', providerId: 'demo', inputPrice: 1, outputPrice: 2, tier: 'demo'},
  {name: 'custom credential with priced platform available', providerId: 'custom', inputPrice: 1, outputPrice: 2, tier: 'byok'},
];

test('pure provider lane classifier preserves the existing platform pricing policy', () => {
  for (const scenario of scenarios) {
    assert.equal(classifyProviderLane(scenario.providerId, scenario), scenario.tier, scenario.name);
  }
  assert.equal(classifyProviderLane('platform'), 'byok');
  assert.equal(classifyProviderLane('demo'), 'demo');
  assert.equal(classifyProviderLane('custom'), 'byok');
});

async function fixture(scenario: Scenario) {
  const repo = new MemoryRepository();
  const date = new Date().toISOString();
  const user: User = {id: 'lane-owner', name: 'Lane owner', email: 'lane-owner@example.invalid',
    emailVerified: false, image: null, createdAt: date, updatedAt: date, elo: 1000, reputation: 0, isSeed: false};
  await seedTestArena(repo, user);
  let constructions = 0;
  let executions = 0;
  const makeProvider = (): AIProvider => {
    constructions++;
    return {
      id: 'offline-lane-provider', pricing: {inputPrice: scenario.inputPrice, outputPrice: scenario.outputPrice},
      execute: async () => {
        executions++;
        return {text: '{"name":null,"age":null,"city":null}', inputTokens: 1, outputTokens: 1,
          reasoningTokens: 0, toolCalls: 0, latency: 1, cost: null, estimated: true};
      }
    };
  };
  const service = new ArenaService(repo, {
    demoMode: true, encryptionKey: randomBytes(32).toString('base64'), allowedHosts: ['api.example.com'],
    platform: {model: 'offline-platform', inputPrice: scenario.inputPrice, outputPrice: scenario.outputPrice},
    createPlatformProvider: makeProvider, createRealProvider: makeProvider
  });
  let providerId: string = scenario.providerId;
  if (providerId === 'custom') {
    const credential = await service.addProvider(user.id, {name: 'Offline credential', baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-offline-lane-test-not-a-real-key', modelId: 'offline-custom', inputPrice: 1, outputPrice: 2});
    providerId = credential.id;
  }
  return {repo, service, user, providerId, counts: () => ({constructions, executions})};
}

for (const scenario of scenarios) {
  test(`run and hunt agree on lane: ${scenario.name}`, async () => {
    const {repo, service, user, providerId, counts} = await fixture(scenario);
    // The only leaderboard candidate is the submission produced by this actual service run.
    await repo.remove('submissions', {problemId: 'messy-json'});
    const workflow = testWorkflow('json');
    for (const node of workflow.nodes.filter(node => node.kind === 'model')) node.config.credentialId = providerId;
    const build = await service.saveBuild(user.id, {problemId: 'messy-json', title: scenario.name, visibility: 'public', workflow});
    const run = await service.run(user.id, {buildId: build.id, kind: 'hidden', consent: true}, () => {});
    assert.equal(run.summary.tier, scenario.tier);
    const submission = (await repo.read('submissions', {buildId: build.id}))[0];
    assert.equal(submission.tier, scenario.tier);
    const before = counts();
    const hunt = await service.hunt(user.id, {problemId: 'messy-json', providerId, consent: true,
      input: 'Offline lane regression candidate', reason: 'Check provider lane consistency before selecting the leader.'});
    assert.equal(hunt.tier, scenario.tier);
    const failure = (await repo.read('failureCases', {id: hunt.id}))[0];
    assert.equal(failure.buildId, build.id);
    assert.equal(failure.versionId, submission.versionId);
    if (scenario.providerId === 'demo') {
      assert.deepEqual(counts(), {constructions: 0, executions: 0});
    } else {
      assert.equal(counts().constructions, before.constructions + 1);
      assert(counts().executions > before.executions);
    }
  });

  test(`Agent historical hunt rejected before provider construction: ${scenario.name}`, async () => {
    const {repo, service, user, providerId, counts} = await fixture(scenario);
    const build = await service.saveBuild(user.id, {mode: 'agent', problemId: 'messy-json', title: 'Agent lane guard',
      visibility: 'private', agentDefinition: {mode: 'agent', definitionSchemaVersion: 1, instructions: ''}});
    const sample = (await repo.read('submissions'))[0];
    await repo.remove('submissions', {problemId: 'messy-json'});
    // Simulate a corrupt/future historical submission to exercise the explicit execution boundary.
    await repo.insert('submissions', [{...sample, id: 'agent-lane-submission', buildId: build.id,
      versionId: build.version.id, problemId: 'messy-json', tier: scenario.tier}]);
    const failureCount = (await repo.read('failureCases')).length;
    await assert.rejects(service.hunt(user.id, {problemId: 'messy-json', providerId, consent: true,
      input: 'Agent must not execute', reason: 'Agent lane guard before provider construction.'}), {code: 'RUNTIME_POLICY_DENIED'});
    assert.deepEqual(counts(), {constructions: 0, executions: 0});
    assert.equal((await repo.read('failureCases')).length, failureCount);
  });
}
