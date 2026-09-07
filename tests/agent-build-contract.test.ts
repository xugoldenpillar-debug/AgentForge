import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_BUILD_LIMITS,
  AGENT_BUILD_HTTP_MAX_BODY_BYTES,
  parseAgentBuildDefinition
} from '../src/shared/agent-build-contract.ts';
import { digestAgentBuildDefinition } from '../src/lib/agent-build/digest.ts';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';

const HASH = `sha256:${'a'.repeat(64)}`;
const OTHER_HASH = `sha256:${'b'.repeat(64)}`;
function pinned(id: string) {
  return { id, versionId: `${id}-v1`, contentDigest: HASH };
}
function definition() {
  return {
    mode: 'agent',
    definitionSchemaVersion: 1,
    instructions: 'Read the approved CSV.\nProduce the required artifacts.',
    modelSelection: pinned('model'),
    skillRefs: [{ kind: 'declarative', componentId: 'skill', versionId: 'skill-v1', contentDigest: HASH }],
    requestedCapabilities: [
      { kind: 'tool', toolId: 'calculator', versionId: 'calc-v1', contentDigest: HASH },
      { kind: 'mcp-read', serviceId: 'catalog', toolId: 'lookup', versionId: 'lookup-v1', contentDigest: HASH }
    ],
    outputContractRef: pinned('csv-json-report'),
    profileRef: pinned('benchmark-profile'),
    environmentRef: pinned('python-stdlib'),
    runtimeSelection: { kind: 'pi', adapterVersion: '0.85.1', policyVersion: 'policy-v1' }
  };
}
function invalid(value: unknown) {
  assert.throws(() => parseAgentBuildDefinition(value), (error: unknown) =>
    error instanceof AppError && error.code === ERROR_CODES.REQUEST_VALIDATION_FAILED &&
    error.status === 400 && error.message === 'Invalid Agent Build definition.');
}

test('valid versioned Agent definition retains pinned identities without becoming a RunDefinition', () => {
  const parsed = parseAgentBuildDefinition(definition());
  assert.equal(parsed.mode, 'agent');
  assert.equal(parsed.definitionSchemaVersion, 1);
  assert.deepEqual(parsed.profileRef, pinned('benchmark-profile'));
  assert.deepEqual(parsed.environmentRef, pinned('python-stdlib'));
  assert.equal(parsed.skillRefs[0].kind, 'declarative');
  assert.equal(Object.hasOwn(parsed, 'kind'), false);
  assert.equal(Object.hasOwn(parsed, 'grants'), false);
});

test('only absent reference arrays default; null and explicit undefined fail closed', () => {
  const { skillRefs: _skills, requestedCapabilities: _capabilities, ...minimal } = definition();
  const parsed = parseAgentBuildDefinition(minimal);
  assert.deepEqual(parsed.skillRefs, []);
  assert.deepEqual(parsed.requestedCapabilities, []);
  for (const field of ['skillRefs', 'requestedCapabilities']) {
    invalid({ ...minimal, [field]: null });
    invalid({ ...minimal, [field]: undefined });
    invalid({ ...minimal, [field]: {} });
  }
  assert.equal(digestAgentBuildDefinition(minimal), digestAgentBuildDefinition({ ...minimal, skillRefs: [], requestedCapabilities: [] }));
});

test('unconfigured drafts normalize to null references without inventing grants or runtime readiness', () => {
  const draft = { mode: 'agent', definitionSchemaVersion: 1, instructions: '' };
  const parsed = parseAgentBuildDefinition(draft);
  assert.deepEqual(parsed, {
    ...draft, modelSelection: null, skillRefs: [], requestedCapabilities: [],
    outputContractRef: null, profileRef: null, environmentRef: null, runtimeSelection: null
  });
  assert.equal(digestAgentBuildDefinition(draft), digestAgentBuildDefinition(parsed));
  assert.equal(AGENT_BUILD_HTTP_MAX_BODY_BYTES, 128 * 1024);
  assert.equal(parseAgentBuildDefinition({ ...draft, instructions: '   ' }).instructions, '   ');
  for (const field of ['modelSelection', 'outputContractRef', 'profileRef', 'environmentRef', 'runtimeSelection']) {
    assert.deepEqual(parseAgentBuildDefinition({ ...draft, [field]: null }), parsed);
    invalid({ ...draft, [field]: undefined });
    invalid({ ...draft, [field]: {} });
  }
});

test('schema/mode/runtime discriminators and required fields never coerce or fall back', () => {
  for (const version of [0, 2, '1', null, NaN, Infinity, 1n]) invalid({ ...definition(), definitionSchemaVersion: version });
  for (const mode of ['workflow', 'dag', 'pi', '', null]) invalid({ ...definition(), mode });
  for (const kind of ['dag', 'shell', '', null]) invalid({ ...definition(), runtimeSelection: { ...definition().runtimeSelection, kind } });
  for (const field of ['mode', 'definitionSchemaVersion', 'instructions']) {
    const input: Record<string, unknown> = definition();
    delete input[field];
    invalid(input);
  }
  for (const input of [null, [], true, 'agent', 12]) invalid(input);
});

test('unknown fields and privilege-bearing payloads are rejected at every object boundary', () => {
  for (const field of ['workflow', 'task', 'credentialId', 'apiKey', 'bindings', 'grants', 'budget', 'limits', 'inputRefs', 'judge']) {
    invalid({ ...definition(), [field]: 'private-value' });
  }
  for (const field of ['modelSelection', 'outputContractRef', 'environmentRef', 'profileRef', 'runtimeSelection'] as const) {
    invalid({ ...definition(), [field]: { ...definition()[field], credentialId: 'private-value' } });
  }
  invalid({ ...definition(), skillRefs: [{ ...definition().skillRefs[0], attachments: ['run.py'] }] });
  invalid({ ...definition(), requestedCapabilities: [{ ...definition().requestedCapabilities[0], command: 'bash' }] });
  invalid({ ...definition(), requestedCapabilities: [{ ...definition().requestedCapabilities[1], endpoint: 'https://example.com' }] });
  invalid({ ...definition(), profileRef: { ...pinned('profile'), agentCompatible: true } });
});

test('references reject URLs, paths, mutable aliases, wrong digest encodings and unbounded IDs', () => {
  for (const value of ['', 'latest', 'LATEST', 'current', 'HEAD', '../private', '/tmp/key', 'https://example.com', 'x%2Fy', 'a b', 'a\n', 'a'.repeat(81), 1]) {
    invalid({ ...definition(), modelSelection: { ...pinned('model'), id: value } });
    invalid({ ...definition(), modelSelection: { ...pinned('model'), versionId: value } });
  }
  for (const value of ['', 'a'.repeat(64), `sha256:${'A'.repeat(64)}`, 'sha256:abc', OTHER_HASH + '0', 1]) {
    invalid({ ...definition(), outputContractRef: { ...pinned('output'), contentDigest: value } });
  }
  for (const value of ['latest', '../version', 'https://example.com', 'x'.repeat(81)]) {
    invalid({ ...definition(), runtimeSelection: { ...definition().runtimeSelection, adapterVersion: value } });
  }
});

test('declarative skills and closed native tool vocabulary exclude executable grants', () => {
  for (const kind of ['executable', 'python', 'npm', 'remote', 'skill']) {
    invalid({ ...definition(), skillRefs: [{ ...definition().skillRefs[0], kind }] });
  }
  for (const toolId of ['bash', 'shell', 'python', 'exec', 'fetch', 'install']) {
    invalid({ ...definition(), requestedCapabilities: [{ ...definition().requestedCapabilities[0], toolId }] });
  }
  invalid({ ...definition(), requestedCapabilities: [{ ...definition().requestedCapabilities[1], kind: 'mcp-write' }] });
  invalid({ ...definition(), requestedCapabilities: [{ ...definition().requestedCapabilities[0], serviceId: 'extra' }] });
  invalid({ ...definition(), requestedCapabilities: [{ ...definition().requestedCapabilities[0], kind: 'mcp-read' }] });
});

test('duplicate identity is rejected even when its version/digest differ', () => {
  const skill = definition().skillRefs[0];
  for (const duplicate of [skill, { ...skill, versionId: 'v2', contentDigest: OTHER_HASH }]) {
    invalid({ ...definition(), skillRefs: [skill, duplicate] });
  }
  for (const capability of definition().requestedCapabilities) {
    invalid({ ...definition(), requestedCapabilities: [capability, capability] });
    invalid({ ...definition(), requestedCapabilities: [capability, { ...capability, versionId: 'v2', contentDigest: OTHER_HASH }] });
  }
});

test('text/count bounds reject oversized input, controls and invalid Unicode', () => {
  for (const instructions of ['x'.repeat(8001), 'bad\u0000text', '\ud800', '\udfff', 1]) {
    invalid({ ...definition(), instructions });
  }
  const input = definition();
  assert.equal(parseAgentBuildDefinition({ ...input, instructions: 'x'.repeat(8000) }).instructions.length, 8000);
  assert.equal(parseAgentBuildDefinition({ ...input, instructions: '🤖' }).instructions, '🤖');
  const skills = Array.from({ length: AGENT_BUILD_LIMITS.maxSkills }, (_, index) => ({ ...input.skillRefs[0], componentId: `skill-${index}` }));
  assert.equal(parseAgentBuildDefinition({ ...input, skillRefs: skills }).skillRefs.length, 16);
  invalid({ ...input, skillRefs: [...skills, { ...skills[0], componentId: 'one-more' }] });
  const capabilities = Array.from({ length: 16 }, (_, index) => ({ ...input.requestedCapabilities[1], toolId: `tool-${index}` }));
  assert.equal(parseAgentBuildDefinition({ ...input, requestedCapabilities: capabilities }).requestedCapabilities.length, 16);
  invalid({ ...input, requestedCapabilities: [...capabilities, { ...capabilities[0], toolId: 'one-more' }] });
});

test('unsafe JS shapes, prototype pollution, hidden keys and getters are rejected without executing getters', () => {
  invalid(Object.assign(Object.create({ injected: true }), definition()));
  invalid(JSON.parse(JSON.stringify(definition()).replace('"mode":', '"__proto__":{},"mode":')));
  invalid({ ...definition(), constructor: {} });
  invalid({ ...definition(), [Symbol('hidden')]: true });
  let called = false;
  const getter = Object.defineProperty(definition(), 'instructions', { enumerable: true, get() { called = true; return 'private'; } });
  invalid(getter);
  assert.equal(called, false);
  invalid(Object.defineProperty(definition(), 'hidden', { value: 'secret', enumerable: false }));
  const nestedGetter = Object.defineProperty(pinned('model'), 'id', { enumerable: true, get() { called = true; return 'private'; } });
  invalid({ ...definition(), modelSelection: nestedGetter });
  assert.equal(called, false);
  invalid({ ...definition(), modelSelection: new Date() });
  invalid({ ...definition(), skillRefs: new Array(1) });
  invalid({ ...definition(), skillRefs: Object.assign([], { private: 'secret' }) });
  const cyclic: Record<string, unknown> = definition();
  cyclic.modelSelection = cyclic;
  invalid(cyclic);
  let deep: unknown = {};
  for (let index = 0; index < 100; index++) deep = { nested: deep };
  invalid({ ...definition(), modelSelection: deep });
  assert.equal(parseAgentBuildDefinition(Object.assign(Object.create(null), definition())).mode, 'agent');
});

test('normalization and digest are deterministic across property order, line endings and capability permutation', () => {
  const input = definition();
  const shuffled: Record<string, unknown> = Object.fromEntries(Object.entries(input).reverse());
  shuffled.modelSelection = Object.fromEntries(Object.entries(input.modelSelection).reverse());
  shuffled.instructions = input.instructions.replace(/\n/g, '\r\n');
  shuffled.requestedCapabilities = [...input.requestedCapabilities].reverse();
  assert.deepEqual(parseAgentBuildDefinition(input), parseAgentBuildDefinition(shuffled));
  assert.equal(digestAgentBuildDefinition(input), digestAgentBuildDefinition(shuffled));
  assert.match(digestAgentBuildDefinition(input), /^sha256:[a-f0-9]{64}$/);
  assert.equal(digestAgentBuildDefinition(parseAgentBuildDefinition(input)), digestAgentBuildDefinition(input));
});

test('v1 golden digest pins domain separation, normalization and serialization protocol', () => {
  // Changing this vector is a protocol change, not a routine snapshot refresh.
  const draft = { mode: 'agent', definitionSchemaVersion: 1, instructions: '' };
  assert.equal(
    digestAgentBuildDefinition(draft),
    'sha256:eedf8770d162b060d57a7aa1a91cdc7b71e4cbfabaf1834512483c64d52edb6b'
  );
});

test('digest changes with every execution-relevant identity, text, version and ordered skill change', () => {
  const input = definition();
  const original = digestAgentBuildDefinition(input);
  const changed: unknown[] = [
    { ...input, instructions: input.instructions + ' ' },
    { ...input, skillRefs: [] },
    { ...input, requestedCapabilities: [] },
    { ...input, skillRefs: [{ ...input.skillRefs[0], contentDigest: OTHER_HASH }] },
    { ...input, skillRefs: [{ ...input.skillRefs[0], versionId: 'v2' }] },
    { ...input, requestedCapabilities: [{ ...input.requestedCapabilities[0], contentDigest: OTHER_HASH }] },
    { ...input, runtimeSelection: { ...input.runtimeSelection, adapterVersion: '0.85.2' } },
    { ...input, runtimeSelection: { ...input.runtimeSelection, policyVersion: 'policy-v2' } }
  ];
  for (const field of ['modelSelection', 'environmentRef', 'profileRef', 'outputContractRef'] as const) {
    for (const change of [{ id: 'other' }, { versionId: 'v2' }, { contentDigest: OTHER_HASH }]) {
      changed.push({ ...input, [field]: { ...input[field], ...change } });
    }
  }
  for (const value of changed) assert.notEqual(digestAgentBuildDefinition(value), original);
  const skills = [...input.skillRefs, { ...input.skillRefs[0], componentId: 'another' }];
  assert.notEqual(digestAgentBuildDefinition({ ...input, skillRefs: skills }), digestAgentBuildDefinition({ ...input, skillRefs: [...skills].reverse() }));
});

test('parser is detached, deeply frozen, pure and mutation-isolated', () => {
  const input = definition();
  const before = structuredClone(input);
  const parsed = parseAgentBuildDefinition(input);
  const original = digestAgentBuildDefinition(parsed);
  assert.deepEqual(input, before);
  assert.notEqual(parsed.modelSelection, input.modelSelection);
  assert.notEqual(parsed.skillRefs[0], input.skillRefs[0]);
  input.modelSelection.id = 'changed';
  input.skillRefs[0].componentId = 'changed';
  input.requestedCapabilities.pop();
  assert.equal(digestAgentBuildDefinition(parsed), original);
  function frozen(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) frozen(child);
  }
  frozen(parsed);
  assert.equal(Reflect.defineProperty(parsed.modelSelection!, 'id', { value: 'changed' }), false);
  assert.equal(digestAgentBuildDefinition(parsed), original);
  assert.notEqual(parseAgentBuildDefinition(parsed), parsed);
});

test('no binding survives validation; structural copying is deliberately not a public/Fork projection', () => {
  for (const binding of ['credentialRef', 'credentialId', 'ownerId', 'grantId', 'apiKey', 'headers', 'url', 'path']) {
    invalid({ ...definition(), modelSelection: { ...pinned('model'), [binding]: 'private' } });
    invalid({ ...definition(), requestedCapabilities: [{ ...definition().requestedCapabilities[1], [binding]: 'private' }] });
    invalid({ ...definition(), skillRefs: [{ ...definition().skillRefs[0], [binding]: 'private' }] });
  }
  const input = { ...definition(), instructions: 'Private author prompt: never automatically publish.' };
  assert.equal(parseAgentBuildDefinition(input).instructions, input.instructions);
  assert.equal(parseAgentBuildDefinition(input).skillRefs[0].componentId, input.skillRefs[0].componentId);
  // B2 must reject an unauthorized Fork, not silently strip a private dependency
  // or mistake this detached clone for permission to expose its prompt.
  assert.equal(JSON.stringify(parseAgentBuildDefinition(definition())).includes('credential'), false);
});

test('browser contract has no native hashing or runtime/server import dependency', () => {
  const source = readFileSync(new URL('../src/shared/agent-build-contract.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"](?:node:|.*server\/|.*lib\/)/);
  assert.match(source, /import type \{ ExecutionIdentity \}/);
});
