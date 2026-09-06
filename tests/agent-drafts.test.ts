import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ArenaService } from '../src/server/service.ts';
import { handleArena } from '../src/server/http.ts';
import { validateBody } from '../src/server/validation.ts';
import { parseAgentBuildDefinition } from '../src/shared/agent-build-contract.ts';
import { digestAgentBuildDefinition } from '../src/lib/agent-build/digest.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import { testWorkflow } from './helpers/workflow.ts';
import type { User } from '../src/shared/types.ts';

const definition = {mode: 'agent', definitionSchemaVersion: 1, instructions: 'Private draft instructions'};
const body = {mode: 'agent', problemId: 'messy-json', title: 'Agent draft', visibility: 'private', agentDefinition: definition};
async function fixture() {
  const repo = new MemoryRepository();
  const user: User = {id: 'b2-owner', name: 'Owner', email: 'b2@example.invalid', emailVerified: false,
    image: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), elo: 1000, reputation: 0, isSeed: false};
  await seedTestArena(repo, user);
  let providerCalls = 0;
  const service = new ArenaService(repo, {demoMode: true, encryptionKey: randomBytes(32).toString('base64'),
    allowedHosts: ['api.example.com'], createRealProvider: () => {providerCalls++; throw new Error('Unexpected provider creation');}});
  const http = (path: string, value?: unknown, userId: string | undefined = user.id) => handleArena(new Request(`http://localhost/api/arena/${path}`, {
    method: value === undefined ? 'GET' : 'POST', headers: {'content-type': 'application/json', origin: 'http://localhost'},
    ...(value === undefined ? {} : {body: JSON.stringify(value)})
  }), {service, userId, origin: 'http://localhost', validateBody});
  return {repo, user, service, http, calls: () => providerCalls};
}

test('Agent draft versions store normalized digest, metadata-only history and exact private Fork lineage', async () => {
  const {service, repo, user} = await fixture();
  const first = await service.saveBuild(user.id, body);
  assert.equal(first.mode, 'agent');
  assert(!Object.hasOwn(first, 'workflow'));
  assert.equal(first.version.definitionDigest, digestAgentBuildDefinition(definition));
  const second = await service.saveBuild(user.id, {...body, buildId: first.id, currentVersionId: first.version.id,
    agentDefinition: {...definition, instructions: 'New private instructions'}});
  assert.equal(second.version.revision, 2);
  assert(!JSON.stringify(second.history).includes('instructions'));
  assert(!JSON.stringify(second.history).includes('agentDefinition'));
  assert(!JSON.stringify(second.history).includes('definitionDigest'));
  const selected = await service.build(first.id, user.id, first.version.id);
  assert.equal(selected.version.agentDefinition?.instructions, definition.instructions);
  const fork = await service.fork(user.id, first.id, first.version.id);
  assert.equal(fork.version.revision, 1);
  assert.equal(fork.visibility, 'private');
  assert.equal(fork.version.agentDefinition?.instructions, definition.instructions);
  assert.equal((await repo.read('forkRelations', {childBuildId: fork.id}))[0].sourceVersionId, first.version.id);
  assert.equal((await repo.read('workflowNodes', {versionId: fork.version.id})).length, 0);
  assert(!JSON.stringify(fork).includes('credentialId'));
  assert.equal((await service.build(first.id, user.id)).version.id, second.version.id);
});

test('Agent persistence fails closed for references, bindings, public, malformed and mixed payloads', async () => {
  const {service, user, repo, http} = await fixture();
  const ref = {id: 'pinned', versionId: 'v1', contentDigest: `sha256:${'a'.repeat(64)}`};
  const invalid: Record<string, unknown>[] = [
    {...body, visibility: 'public'}, {...body, mode: null}, {...body, mode: 'pi'}, {...body, mode: undefined},
    {...body, workflow: testWorkflow('json')}, {...body, definitionDigest: 'forged'}, {...body, credentialId: 'other'},
    {...body, agentDefinition: {...definition, definitionSchemaVersion: 2}},
    {...body, agentDefinition: {...definition, grant: {allow: true}}},
    ...['modelSelection', 'profileRef', 'environmentRef', 'outputContractRef'].map(key => ({...body, agentDefinition: {...definition, [key]: ref}})),
    {...body, agentDefinition: {...definition, runtimeSelection: {kind: 'pi', adapterVersion: 'v1', policyVersion: 'v1'}}},
    {...body, agentDefinition: {...definition, skillRefs: [{kind: 'declarative', componentId: 'x', versionId: 'v1', contentDigest: ref.contentDigest}]}},
    {...body, agentDefinition: {...definition, requestedCapabilities: [{kind: 'tool', toolId: 'calculator', versionId: 'v1', contentDigest: ref.contentDigest}]}}
  ];
  const count = (await repo.read('buildVersions')).length;
  for (const value of invalid) await assert.rejects(service.saveBuild(user.id, value));
  assert.equal((await repo.read('buildVersions')).length, count);
  for (const value of invalid.filter(value => value.mode !== undefined)) assert.equal((await http('builds', value)).status, 400);
});

test('Mode mismatch, unauthorized updates and CAS conflict never append partial history', async () => {
  const {service, user, repo} = await fixture();
  const first = await service.saveBuild(user.id, body);
  const update = {...body, buildId: first.id, currentVersionId: first.version.id};
  await assert.rejects(service.saveBuild('seed-user-1', update), {status: 403});
  await assert.rejects(service.saveBuild(user.id, {mode: 'workflow', buildId: first.id, currentVersionId: first.version.id, problemId: 'messy-json', title: 'Switch', visibility: 'private', workflow: testWorkflow('json')}), {status: 409});
  const workflow = await service.saveBuild(user.id, {problemId: 'messy-json', title: 'Legacy', visibility: 'private', workflow: testWorkflow('json')});
  await assert.rejects(service.saveBuild(user.id, {...body, buildId: workflow.id, currentVersionId: workflow.version.id}), {status: 409});
  const results = await Promise.allSettled([service.saveBuild(user.id, update), service.saveBuild(user.id, update)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await repo.read('buildVersions', {buildId: first.id})).length, 2);
  await assert.rejects(service.saveBuild(user.id, update), {status: 409});
  assert.equal((await repo.read('buildVersions', {buildId: first.id})).length, 2);
});

test('Agent HTTP requires mode-aware client, enforces private selected history and strict Fork', async () => {
  const {http, service, user, repo} = await fixture();
  const response = await http('builds', body);
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.equal((await http(`builds/${saved.id}`)).status, 409);
  assert.equal((await http(`builds/${saved.id}?mode=agent`)).status, 200);
  assert.equal((await http(`builds/${saved.id}?mode=agent`, undefined, 'seed-user-1')).status, 403);
  assert.equal((await http(`builds/${saved.id}/fork`, {})).status, 409);
  assert.equal((await http(`builds/${saved.id}/fork`, {mode: 'agent', versionId: null})).status, 400);
  assert.equal((await http(`builds/${saved.id}/fork`, {mode: 'agent', credentialId: 'x'})).status, 400);
  assert.equal((await http(`builds/${saved.id}/fork`, {mode: 'agent'})).status, 201);
  await assert.rejects(service.build(saved.id, user.id, 'unrelated'), {status: 404});
  // Corrupt/public metadata must not turn private Agent history into a disclosure.
  await repo.update('builds', {id: saved.id}, {visibility: 'public'});
  await assert.rejects(service.build(saved.id, 'seed-user-1', saved.version.id), {status: 403});
  await assert.rejects(service.fork('seed-user-1', saved.id, saved.version.id), {status: 403});
});

test('Agent run and historical hunt reject before provider construction, run records or leases', async () => {
  const {service, user, repo, calls, http} = await fixture();
  const saved = await service.saveBuild(user.id, body);
  const runCount = (await repo.read('runs')).length;
  let executionRateWrites = 0;
  const rateLimit = repo.rateLimit.bind(repo);
  repo.rateLimit = async (key, limit, window) => {
    if (key.includes('run:') || key.includes('hunt:')) executionRateWrites++;
    return rateLimit(key, limit, window);
  };
  for (const kind of ['public', 'hidden']) await assert.rejects(service.run(user.id, {buildId: saved.id, kind, consent: true}, () => {}), {code: 'RUNTIME_POLICY_DENIED'});
  const streamed = await http('runs', {buildId: saved.id, kind: 'public'});
  assert((await streamed.text()).includes('RUNTIME_POLICY_DENIED'));
  const sample = (await repo.read('submissions'))[0];
  await repo.insert('submissions', [{...sample, id: 'agent-invalid-submission', tier: 'byok', problemId: 'messy-json',
    buildId: saved.id, versionId: saved.version.id, score: 999999}]);
  await assert.rejects(service.hunt(user.id, {problemId: 'messy-json', input: 'candidate', reason: 'Long enough explanation', providerId: 'missing-provider', consent: true}), {code: 'RUNTIME_POLICY_DENIED'});
  assert.equal(calls(), 0);
  assert.equal(executionRateWrites, 0);
  assert.equal((await repo.read('runs')).length, runCount);
});

test('A failed pointer CAS rolls back an already inserted Agent version', async () => {
  const {service, repo, user} = await fixture();
  const first = await service.saveBuild(user.id, body);
  const transaction = repo.transaction.bind(repo);
  repo.transaction = work => transaction(async tx => {
    const update = tx.update.bind(tx);
    tx.update = async (table, where, values) => table === 'builds' ? [] : update(table, where, values);
    return work(tx);
  });
  await assert.rejects(service.saveBuild(user.id, {...body, buildId: first.id, currentVersionId: first.version.id}), {code: 'CONCURRENT_SAVE'});
  assert.equal((await repo.read('buildVersions', {buildId: first.id})).length, 1);
  assert.equal((await repo.read('builds', {id: first.id}))[0].currentVersionId, first.version.id);
});

test('Public Workflow history cannot expose stored definitions and Fork rechecks source visibility inside transaction', async () => {
  const {service, repo, user, http} = await fixture();
  const workflowBody = {problemId: 'messy-json', title: 'Workflow history', visibility: 'private', workflow: testWorkflow('json')};
  const first = await service.saveBuild(user.id, workflowBody);
  const second = await service.saveBuild(user.id, {...workflowBody, visibility: 'public', buildId: first.id, currentVersionId: first.version.id});
  // Simulate future payload additions to a private historical row. DTO must remain an allowlist.
  const legacyDefinition = {...definition, instructions: 'History secret must never leak'};
  await repo.update('buildVersions', {id: first.version.id}, {agentDefinition: parseAgentBuildDefinition(legacyDefinition)});
  const publicDetail = await service.build(first.id, 'seed-user-1');
  assert(!JSON.stringify(publicDetail).includes(legacyDefinition.instructions));
  assert(!JSON.stringify(publicDetail.history).includes('agentDefinition'));
  const selected = await service.build(first.id, 'seed-user-1', first.version.id);
  assert.equal(selected.promptVisible, false);
  assert(selected.workflow?.nodes.every(node => Object.keys(node.config).length === 0));
  await assert.rejects(service.fork('seed-user-1', first.id, first.version.id), {status: 403});
  const count = (await repo.read('builds')).length;
  const transaction = repo.transaction.bind(repo);
  repo.transaction = work => transaction(async tx => {
    await tx.update('builds', {id: first.id}, {visibility: 'private'});
    return work(tx);
  });
  assert.equal((await http(`builds/${first.id}/fork`, {versionId: second.version.id}, 'seed-user-1')).status, 403);
  assert.equal((await repo.read('builds')).length, count);
});

test('GET mode is strict and legacy Workflow requests remain compatible', async () => {
  const {http} = await fixture();
  const saved = await (await http('builds', {problemId: 'messy-json', title: 'Legacy mode', visibility: 'public', workflow: testWorkflow('json')})).json();
  assert.equal((await http(`builds/${saved.id}`)).status, 200);
  assert.equal((await http(`builds/${saved.id}?mode=workflow`)).status, 200);
  assert.equal((await http(`builds/${saved.id}?mode=agent`)).status, 409);
  assert.equal((await http(`builds/${saved.id}?mode=pi`)).status, 409);
  assert.equal((await http(`builds/${saved.id}?version=`)).status, 400);
});
