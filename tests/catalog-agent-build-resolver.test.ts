import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogAgentBuildResolver, type CatalogAgentBuildResolverPorts, type CatalogLookupContext } from '../src/server/catalog-agent-build-resolver.ts';
import { parseAgentBuildDefinition, type AgentBuildDefinition } from '../src/shared/agent-build-contract.ts';
import type { AgentBuildResolutionOperation } from '../src/server/agent-build-resolver.ts';

type DigestLetter = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
const digest = (letter: DigestLetter | string) => `sha256:${letter.repeat(64)}`;

function definition(overrides: Record<string, unknown> = {}): AgentBuildDefinition {
  return parseAgentBuildDefinition({
    mode: 'agent',
    definitionSchemaVersion: 1,
    instructions: 'Return the declared artifact.',
    modelSelection: { id: 'model', versionId: 'model-v1', contentDigest: digest('a') },
    outputContractRef: { id: 'output', versionId: 'output-v1', contentDigest: digest('b') },
    profileRef: { id: 'profile', versionId: 'profile-v1', contentDigest: digest('c') },
    environmentRef: { id: 'environment', versionId: 'environment-v1', contentDigest: digest('d') },
    skillRefs: [{ kind: 'declarative', componentId: 'skill', versionId: 'skill-v1', contentDigest: digest('e') }],
    requestedCapabilities: [{ kind: 'tool', toolId: 'calculator', versionId: 'tool-v1', contentDigest: digest('f') }],
    runtimeSelection: { kind: 'pi', adapterVersion: 'pi-v1', policyVersion: 'policy-v1' },
    ...overrides,
  });
}

function release(overrides: Record<string, unknown> = {}) {
  return { versionId: 'model-v1', contentDigest: digest('a'), ownerId: null, visibility: 'public' as const, revoked: false, modelId: 'model', ...overrides };
}

function portsFor(contexts: CatalogLookupContext[], overrides: Partial<CatalogAgentBuildResolverPorts> = {}): CatalogAgentBuildResolverPorts {
  return {
    models: { lookupModel: async (_ref, context) => { contexts.push(context); return release(); } },
    outputContracts: { lookupOutputContract: async (_ref, context) => { contexts.push(context); return { ...release(), outputContractId: 'output', versionId: 'output-v1', contentDigest: digest('b') }; } },
    profiles: { lookupProfile: async (_ref, context) => { contexts.push(context); return { ...release(), profileId: 'profile', versionId: 'profile-v1', contentDigest: digest('c') }; } },
    environments: { lookupEnvironment: async (_ref, context) => { contexts.push(context); return { ...release(), environmentId: 'environment', versionId: 'environment-v1', contentDigest: digest('d') }; } },
    skills: { lookupSkill: async (_ref, context) => { contexts.push(context); return { ...release(), componentId: 'skill', versionId: 'skill-v1', contentDigest: digest('e') }; } },
    capabilities: { lookupCapability: async (_ref, context) => { contexts.push(context); return { ...release(), kind: 'tool' as const, toolId: 'calculator', versionId: 'tool-v1', contentDigest: digest('f') }; } },
    ...overrides,
  };
}

function request(operation: AgentBuildResolutionOperation, input: AgentBuildDefinition = definition()) {
  return {
    actorId: 'actor',
    ownerId: 'owner',
    buildId: 'build-1',
    buildVersionId: 'version-1',
    operation,
    definition: input,
  } as const;
}

async function errorCode(action: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await action();
    return undefined;
  } catch (error) {
    return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  }
}

test('save requires the actor to own the build and passes operation context to every lookup port', async () => {
  const contexts: CatalogLookupContext[] = [];
  const resolver = new CatalogAgentBuildResolver(portsFor(contexts));
  const result = await resolver.resolve({ ...request('save'), actorId: 'owner', ownerId: 'owner' });
  assert.equal(result.definition.modelSelection?.id, 'model');
  assert.equal(contexts.length, 6);
  assert(contexts.every((context) => context.operation === 'save' && context.actorId === 'owner' && context.ownerId === 'owner'));
});

test('read re-authorizes pinned releases without rewriting the historical definition', async () => {
  const contexts: CatalogLookupContext[] = [];
  const input = definition({ instructions: 'Historical instructions stay unchanged.' });
  const result = await new CatalogAgentBuildResolver(portsFor(contexts)).resolve({ ...request('read', input), actorId: 'owner' });
  assert.deepEqual(result.definition, input);
  assert(contexts.every((context) => context.operation === 'read'));
});

test('fork permits public releases for another actor but private releases require the source owner', async () => {
  const contexts: CatalogLookupContext[] = [];
  const publicResult = await new CatalogAgentBuildResolver(portsFor(contexts)).resolve({ ...request('fork'), actorId: 'forker' });
  assert.equal(publicResult.definition.mode, 'agent');

  const privatePorts = portsFor([], {
    models: { lookupModel: async () => ({ ...release(), ownerId: 'owner', visibility: 'private' as const }) },
  });
  assert.equal(await errorCode(() => new CatalogAgentBuildResolver(privatePorts).resolve({ ...request('fork'), actorId: 'forker' })), 'OWNERSHIP_FORBIDDEN');
  await new CatalogAgentBuildResolver(privatePorts).resolve({ ...request('fork'), actorId: 'owner' });
});

test('revoked, missing, and mismatched catalog releases fail closed', async () => {
  const revoked = portsFor([], { models: { lookupModel: async () => ({ ...release(), revoked: true }) } });
  assert.equal(await errorCode(() => new CatalogAgentBuildResolver(revoked).resolve({ ...request('read'), actorId: 'owner' })), 'RUNTIME_POLICY_DENIED');

  const missing = portsFor([], { models: { lookupModel: async () => null } });
  assert.equal(await errorCode(() => new CatalogAgentBuildResolver(missing).resolve({ ...request('read'), actorId: 'owner' })), 'RUNTIME_UNAVAILABLE');

  const mismatched = portsFor([], { models: { lookupModel: async () => ({ ...release(), contentDigest: digest('b') }) } });
  assert.equal(await errorCode(() => new CatalogAgentBuildResolver(mismatched).resolve({ ...request('read'), actorId: 'owner' })), 'RUNTIME_POLICY_DENIED');
});

test('all dependency classes require exact identity and digest matching', async () => {
  const cases: Array<keyof CatalogAgentBuildResolverPorts> = ['models', 'outputContracts', 'profiles', 'environments', 'skills', 'capabilities'];
  for (const key of cases) {
    const base = portsFor([]);
    const port = base[key];
    const broken = { ...base, [key]: Object.fromEntries(Object.keys(port).map((method) => [method, async (...args: [unknown, CatalogLookupContext][]) => {
      const value = await (port as Record<string, (ref: unknown, context: CatalogLookupContext) => Promise<unknown>>)[method](...args);
      return { ...(value as Record<string, unknown>), contentDigest: digest('z') };
    }])) } as CatalogAgentBuildResolverPorts;
    assert.equal(await errorCode(() => new CatalogAgentBuildResolver(broken).resolve({ ...request('read'), actorId: 'owner' })), 'RUNTIME_POLICY_DENIED', key);
  }
});

test('catalog ports cannot be used to smuggle URLs or secrets into the resolved definition', async () => {
  const ports = portsFor([]);
  const unsafe = { ...definition(), modelSelection: { id: 'model', versionId: 'model-v1', contentDigest: digest('a'), url: 'https://attacker.invalid', apiKey: 'secret' } };
  assert.equal(await errorCode(() => new CatalogAgentBuildResolver(ports).resolve({ ...request('save', unsafe as unknown as AgentBuildDefinition), actorId: 'owner', ownerId: 'owner' })), 'REQUEST_VALIDATION_FAILED');
});
