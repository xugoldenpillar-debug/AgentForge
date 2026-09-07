import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ArenaService } from '../src/server/service.ts';
import { handleArena } from '../src/server/http.ts';
import { validateBody } from '../src/server/validation.ts';
import { parseAgentBuildDefinition, type AgentBuildDefinition } from '../src/shared/agent-build-contract.ts';
import type { AgentBuildResolutionRequest, AgentBuildResolver } from '../src/server/agent-build-resolver.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import type { User } from '../src/shared/types.ts';

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

function configuredDefinition(overrides: Record<string, unknown> = {}): AgentBuildDefinition {
  return parseAgentBuildDefinition({
    mode: 'agent',
    definitionSchemaVersion: 1,
    instructions: 'Use only the approved environment and return the declared artifact.',
    modelSelection: { id: 'client-model', versionId: 'client-model-v1', contentDigest: digest('a') },
    skillRefs: [{ kind: 'declarative', componentId: 'skill-structured', versionId: 'skill-v1', contentDigest: digest('b') }],
    requestedCapabilities: [{ kind: 'tool', toolId: 'calculator', versionId: 'tool-v1', contentDigest: digest('c') }],
    outputContractRef: { id: 'json-output', versionId: 'output-v1', contentDigest: digest('d') },
    profileRef: { id: 'agent-profile', versionId: 'profile-v1', contentDigest: digest('e') },
    environmentRef: { id: 'client-environment', versionId: 'environment-v1', contentDigest: digest('f') },
    runtimeSelection: { kind: 'pi', adapterVersion: 'pi-client-v1', policyVersion: 'policy-client-v1' },
    ...overrides,
  });
}

function canonicalDefinition(input: AgentBuildDefinition): AgentBuildDefinition {
  return parseAgentBuildDefinition({
    ...input,
    modelSelection: { id: 'catalog-model', versionId: 'model-release-7', contentDigest: digest('1') },
    skillRefs: [{ kind: 'declarative', componentId: 'skill-structured', versionId: 'skill-release-3', contentDigest: digest('2') }],
    requestedCapabilities: [{ kind: 'tool', toolId: 'calculator', versionId: 'tool-release-4', contentDigest: digest('3') }],
    outputContractRef: { id: 'json-output', versionId: 'output-release-2', contentDigest: digest('4') },
    profileRef: { id: 'agent-profile', versionId: 'profile-release-5', contentDigest: digest('5') },
    environmentRef: { id: 'approved-pi-static', versionId: 'environment-release-9', contentDigest: digest('6') },
    runtimeSelection: { kind: 'pi', adapterVersion: 'pi-approved-v2', policyVersion: 'policy-approved-v3' },
  });
}

async function fixture(resolver?: AgentBuildResolver) {
  const repo = new MemoryRepository();
  const user: User = {
    id: 't1-resolver-owner',
    name: 'Resolver Owner',
    email: 't1-resolver@example.invalid',
    emailVerified: false,
    image: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    elo: 1000,
    reputation: 0,
    isSeed: false,
  };
  await seedTestArena(repo, user);
  const service = new ArenaService(repo, {
    demoMode: true,
    encryptionKey: randomBytes(32).toString('base64'),
    allowedHosts: [],
    agentBuildResolver: resolver,
  });
  const http = (path: string, value?: unknown, userId: string | undefined = user.id) => handleArena(
    new Request(`http://localhost/api/arena/${path}`, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    }),
    { service, userId, origin: 'http://localhost', validateBody },
  );
  return { repo, user, service, http };
}

function buildBody(agentDefinition: unknown = configuredDefinition()) {
  return {
    mode: 'agent',
    problemId: 'messy-json',
    title: 'Configured resolver test',
    visibility: 'private',
    agentDefinition,
  };
}

function resolverFor(calls: AgentBuildResolutionRequest[]): AgentBuildResolver {
  return {
    async resolve(request) {
      calls.push(request);
      return { definition: canonicalDefinition(request.definition) };
    },
  };
}

test('configured Agent Save/Read/Fork use server-canonical resolver output, never client refs', async () => {
  const calls: AgentBuildResolutionRequest[] = [];
  const { service, user } = await fixture(resolverFor(calls));

  const saved = await service.saveBuild(user.id, buildBody());
  assert.equal(saved.mode, 'agent');
  assert.equal(saved.version.agentDefinition?.modelSelection?.id, 'catalog-model');
  assert.equal(saved.version.agentDefinition?.environmentRef?.id, 'approved-pi-static');
  assert.equal(saved.version.agentDefinition?.runtimeSelection?.adapterVersion, 'pi-approved-v2');
  assert.deepEqual(calls.map(({ operation }) => operation), ['save', 'read']);
  assert(calls.every((request) => !Object.hasOwn(request, 'url')));
  assert.equal(calls[0]?.definition.modelSelection?.id, 'client-model');

  const reread = await service.build(saved.id, user.id, saved.version.id);
  assert.equal(reread.version.agentDefinition?.modelSelection?.versionId, 'model-release-7');
  assert.equal(calls.at(-1)?.operation, 'read');

  const fork = await service.fork(user.id, saved.id, saved.version.id);
  assert.equal(fork.mode, 'agent');
  assert.equal(fork.version.agentDefinition?.environmentRef?.versionId, 'environment-release-9');
  assert.equal(calls.filter(({ operation }) => operation === 'fork').length, 1);
});

test('configured Agent HTTP Save is structurally accepted only when the service has a resolver', async () => {
  const calls: AgentBuildResolutionRequest[] = [];
  const withResolver = await fixture(resolverFor(calls));
  const accepted = await (await withResolver.http('builds', buildBody())).json();
  assert.equal(accepted.mode, 'agent');
  assert.equal(accepted.version.agentDefinition.modelSelection.id, 'catalog-model');

  const withoutResolver = await fixture();
  const existingBuilds = (await withoutResolver.repo.read('builds')).length;
  const rejected = await withoutResolver.http('builds', buildBody());
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error.code, 'REQUEST_VALIDATION_FAILED');
  assert.equal((await withoutResolver.repo.read('builds')).length, existingBuilds);
});

test('configured Agent Save fails closed without a resolver and does not leave a partial build', async () => {
  const { service, user, repo } = await fixture();
  const existingBuilds = (await repo.read('builds')).length;
  const existingVersions = (await repo.read('buildVersions')).length;
  await assert.rejects(service.saveBuild(user.id, buildBody()), (error: unknown) => {
    return typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === 'RUNTIME_UNAVAILABLE';
  });
  assert.equal((await repo.read('builds')).length, existingBuilds);
  assert.equal((await repo.read('buildVersions')).length, existingVersions);
});

test('client URL/model/environment fields are not a resolver authority', async () => {
  const calls: AgentBuildResolutionRequest[] = [];
  const { service, user } = await fixture(resolverFor(calls));
  const definition = {
    ...configuredDefinition(),
    modelSelection: {
      ...configuredDefinition().modelSelection,
      url: 'https://attacker.example.invalid/model',
    },
  };
  await assert.rejects(service.saveBuild(user.id, buildBody(definition)), (error: unknown) => {
    return typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === 'REQUEST_VALIDATION_FAILED';
  });
  assert.equal(calls.length, 0);
});

test('stored configured Agent integrity is checked before Read/Fork resolution', async () => {
  const calls: AgentBuildResolutionRequest[] = [];
  const { service, user, repo } = await fixture(resolverFor(calls));
  const saved = await service.saveBuild(user.id, buildBody());
  await repo.update('buildVersions', { id: saved.version.id }, { definitionDigest: digest('9') });

  await assert.rejects(service.build(saved.id, user.id, saved.version.id), (error: unknown) => {
    return typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === 'RUNTIME_POLICY_DENIED';
  });
  await assert.rejects(service.fork(user.id, saved.id, saved.version.id), (error: unknown) => {
    return typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === 'RUNTIME_POLICY_DENIED';
  });
  assert.equal(calls.filter(({ operation }) => operation === 'read').length, 1);
  assert.equal(calls.filter(({ operation }) => operation === 'fork').length, 0);
});

test('Read/Fork fail closed if resolver output drifts from the immutable canonical version', async () => {
  let historicalReads = 0;
  const resolver: AgentBuildResolver = {
    async resolve(request) {
      const canonical = canonicalDefinition(request.definition);
      if (request.operation === 'save' || historicalReads++ === 0) return { definition: canonical };
      return {
        definition: parseAgentBuildDefinition({
          ...canonical,
          environmentRef: { id: 'approved-pi-drifted', versionId: 'environment-release-10', contentDigest: digest('7') },
        }),
      };
    },
  };
  const { service, user } = await fixture(resolver);
  const saved = await service.saveBuild(user.id, buildBody());

  await assert.rejects(service.build(saved.id, user.id, saved.version.id), (error: unknown) => {
    return typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === 'RUNTIME_UNAVAILABLE';
  });
  await assert.rejects(service.fork(user.id, saved.id, saved.version.id), (error: unknown) => {
    return typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === 'RUNTIME_UNAVAILABLE';
  });
});

test('resolver cannot silently downgrade a configured Agent to an unconfigured draft', async () => {
  const resolver: AgentBuildResolver = {
    async resolve() {
      return { definition: parseAgentBuildDefinition({ mode: 'agent', definitionSchemaVersion: 1, instructions: 'downgraded' }) };
    },
  };
  const { service, user, repo } = await fixture(resolver);
  const existingBuilds = (await repo.read('builds')).length;
  await assert.rejects(service.saveBuild(user.id, buildBody()), (error: unknown) => {
    return typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === 'RUNTIME_UNAVAILABLE';
  });
  assert.equal((await repo.read('builds')).length, existingBuilds);
});
