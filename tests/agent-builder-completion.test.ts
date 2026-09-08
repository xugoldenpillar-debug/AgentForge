import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { discoverProviderModels, parseProviderDiscoveryInput } from '../src/server/provider-models.ts';
import { normalizeProviderBaseUrl } from '../src/shared/provider-models.ts';
import { PROVIDER_PROTOCOLS } from '../src/shared/provider-protocol.ts';
import { parseCreationSkillFile } from '../src/lib/creation-skill-file.ts';
import { importCreationSkill, listCreationSkills, resolveCreationSkills } from '../src/server/creation/skills.ts';
import { createCreationAgentBuildResolver } from '../src/server/creation/build-resolver.ts';
import { CREATION_AGENT_BUILD_CONTRACT } from '../src/server/creation/catalog.ts';
import { parseCreationSession, draftMatchesBuild } from '../src/features/builder/creation-session.ts';
import { AppError } from '../src/shared/errors.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { ArenaService } from '../src/server/service.ts';
import { handleArena } from '../src/server/http.ts';
import type { AgentBuildSkillRef } from '../src/shared/agent-build-contract.ts';

const KEY = 'offline-secret-do-not-reflect';
const HOST = 'gateway.example.com';
const input = { protocol: 'openai-chat' as const, baseUrl: `https://${HOST}/v1`, apiKey: KEY };
const options = (transport: typeof fetch) => ({ allowedHosts: [HOST], createFetch: () => transport });

for (const protocol of PROVIDER_PROTOCOLS) {
  test(`model discovery uses GET and the ${protocol} authentication format`, async () => {
    const result = await discoverProviderModels({ ...input, protocol }, options(async (url, init) => {
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.equal(init?.cache, 'no-store');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get(protocol === 'anthropic-messages' ? 'x-api-key' : protocol === 'google-generative-ai' ? 'x-goog-api-key' : 'authorization'),
        protocol === 'anthropic-messages' || protocol === 'google-generative-ai' ? KEY : `Bearer ${KEY}`);
      assert.ok(init?.signal);
      assert.equal(String(url).includes(KEY), false);
      return Response.json(protocol === 'google-generative-ai'
        ? { models: [{ name: 'models/test-model', displayName: 'Test', supportedGenerationMethods: ['generateContent'] }] }
        : { data: [{ id: 'test-model', display_name: 'Test' }] });
    }));
    assert.deepEqual(result, { models: [{ id: 'test-model', name: 'Test' }], truncated: false });
  });
}

test('provider normalization preserves proxy paths and does not strip security-sensitive URL parts', async () => {
  assert.equal(normalizeProviderBaseUrl(`https://${HOST}/`, 'openai-responses'), input.baseUrl);
  assert.equal(normalizeProviderBaseUrl(`https://${HOST}/proxy/v1/chat/completions/`, 'openai-chat'), `https://${HOST}/proxy/v1`);
  assert.equal(normalizeProviderBaseUrl(`https://${HOST}/`, 'google-generative-ai'), `https://${HOST}/v1beta`);
  for (const baseUrl of [`https://${HOST}/v1?key=unsafe`, `https://user:pass@${HOST}/v1`, `https://${HOST}/v1#fragment`, 'http://gateway.example.com/v1', 'https://127.0.0.1/v1', 'https://unlisted.example.com/v1', `https://${HOST}:8443/v1`]) {
    await assert.rejects(discoverProviderModels({ ...input, baseUrl: normalizeProviderBaseUrl(baseUrl, input.protocol) }, options(async () => {
      assert.fail('Rejected URLs must never reach a transport');
    })));
  }
  assert.throws(() => parseProviderDiscoveryInput({ ...input, headers: { authorization: 'overridden' } }));
  assert.throws(() => parseProviderDiscoveryInput({ ...input, apiKey: `${KEY}\r\nInjected: value` }));
  assert.throws(() => parseProviderDiscoveryInput({ ...input, protocol: 'automatic' }));
});

test('Anthropic pagination follows only bounded cursors on the original endpoint', async () => {
  let calls = 0;
  const result = await discoverProviderModels({ ...input, protocol: 'anthropic-messages' }, options(async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.origin, `https://${HOST}`);
    assert.equal(parsed.pathname, '/v1/models');
    assert.equal(parsed.searchParams.get('limit'), '100');
    if (calls++ === 0) return Response.json({ data: [{ id: 'z' }], has_more: true, last_id: 'https://evil.example.com/secret' });
    assert.equal(parsed.searchParams.get('after_id'), 'https://evil.example.com/secret');
    return Response.json({ data: [{ id: 'a' }, { id: 'z' }], has_more: false });
  }));
  assert.equal(calls, 2);
  assert.deepEqual(result.models.map((model) => model.id), ['a', 'z']);
});

test('Gemini pagination excludes embedding-only models and strips only the models prefix', async () => {
  let calls = 0;
  const result = await discoverProviderModels({ ...input, protocol: 'google-generative-ai' }, options(async (url) => {
    if (calls++ === 0) return Response.json({ models: [{ name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }, { name: 'models/generator' }], nextPageToken: 'next' });
    assert.equal(new URL(String(url)).searchParams.get('pageToken'), 'next');
    return Response.json({ models: [{ name: 'models/generator-two' }] });
  }));
  assert.deepEqual(result.models.map((model) => model.id), ['generator', 'generator-two']);
});

test('model lists are deduplicated, size-bounded, and explicitly marked when truncated', async () => {
  const result = await discoverProviderModels(input, options(async () => Response.json({ data: [
    { id: 'duplicate' }, { id: 'duplicate' }, null, { id: '\nunsafe' }, { id: 'with space' }, ...Array.from({ length: 1005 }, (_, i) => ({ id: `model-${i}` })),
  ] })));
  assert.equal(result.models.length, 1000);
  assert.equal(result.truncated, true);
  assert.equal(new Set(result.models.map((model) => model.id)).size, 1000);
  let pages = 0;
  const paginated = await discoverProviderModels({ ...input, protocol: 'anthropic-messages' }, options(async () => Response.json({ data: [{ id: `model-${++pages}` }], has_more: true, last_id: `cursor-${pages}` })));
  assert.equal(pages, 5);
  assert.equal(paginated.truncated, true);
});

test('malformed, oversized, cyclic and failed upstream responses never reflect private keys', async () => {
  const responses = [() => Response.json({ error: KEY }, { status: 401 }), () => Response.json({ data: KEY }),
    () => new Response(KEY), () => new Response('x'.repeat(2 * 1024 * 1024 + 1))];
  for (const response of responses) {
    await assert.rejects(discoverProviderModels(input, options(async () => response())), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.message.includes(KEY), false);
      return true;
    });
  }
  await assert.rejects(discoverProviderModels(input, options(async () => { throw new Error(KEY); })), (error: unknown) => error instanceof AppError && !error.message.includes(KEY));
  await assert.rejects(discoverProviderModels({ ...input, protocol: 'anthropic-messages' }, options(async () => Response.json({ data: [], has_more: true, last_id: 'repeat' }))));
  await assert.rejects(discoverProviderModels({ ...input, protocol: 'anthropic-messages' }, options(async () => Response.json({ data: [], has_more: true }))));
});

test('caller cancellation is forwarded to the provider transport', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(discoverProviderModels(input, { ...options(async (_url, init) => {
    assert.equal(init?.signal?.aborted, true);
    init?.signal?.throwIfAborted();
    return Response.json({ data: [] });
  }), signal: abort.signal }));
});

test('Skill parser accepts BOM, CRLF, metadata, text and self-contained JSON', () => {
  const skill = parseCreationSkillFile('SKILL.md', '\uFEFF---\r\nname: "Animation craft"\r\ndescription: >\r\n  Smooth movement\r\n  and timing\r\n---\r\nUse clear silhouettes. \u{1f680}');
  assert.equal(skill.name, 'Animation craft');
  assert.equal(skill.description, 'Smooth movement and timing');
  assert.equal(skill.instruction, 'Use clear silhouettes. \u{1f680}');
  assert.deepEqual(parseCreationSkillFile('skill.json', JSON.stringify(skill)), skill);
  assert.equal(parseCreationSkillFile('timing.txt', 'Keep motion readable.').name, 'timing');
});

test('Skill parser rejects binary, traversal, huge files, malformed JSON and executable dependencies', () => {
  for (const [name, content] of [['../SKILL.md', 'text'], ['skill.zip', 'text'], ['skill.md', '\u0000binary'], ['skill.txt', '\ud800'], ['skill.md', ''], ['skill.json', '{bad json'], ['skill.md', '---\nname: Missing closer'], ['skill.md', 'x'.repeat(65537)]]) {
    assert.throws(() => parseCreationSkillFile(name, content), AppError);
  }
  const skill = parseCreationSkillFile('skill.md', 'Use deliberate timing.');
  assert.throws(() => parseCreationSkillFile('skill.json', JSON.stringify({ ...skill, dependencies: ['npm:untrusted'] })));
  assert.throws(() => parseCreationSkillFile('skill.json', JSON.stringify({ ...skill, scripts: { install: 'run-me' } })));
});

async function fixture() {
  const repo = new MemoryRepository();
  const now = new Date().toISOString();
  for (const id of ['owner', 'other']) await repo.insert('users', [{ id, name: id, email: `${id}@example.invalid`, emailVerified: false,
    image: null, createdAt: now, updatedAt: now, elo: 1000, reputation: 0, isSeed: false }]);
  let requests = 0;
  const service = new ArenaService(repo, { demoMode: false, encryptionKey: randomBytes(32).toString('base64'), allowedHosts: [HOST],
    agentBuildResolver: createCreationAgentBuildResolver(repo), createProviderFetch: () => async () => { requests++; return Response.json({ data: [{ id: 'listed-model' }] }); } });
  const http = (path: string, body?: unknown, userId: string | undefined = 'owner', origin = 'http://localhost') => handleArena(new Request(`http://localhost/api/arena/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { service, userId, origin: 'http://localhost' });
  return { repo, service, http, requests: () => requests };
}

test('model discovery is authenticated, owner-scoped and transient while saved keys remain encrypted', async () => {
  const f = await fixture();
  const response = await f.http('providers/models', input);
  assert.equal(response.status, 200);
  assert.equal((await f.repo.read('credentials')).length, 0);
  assert.equal((await f.service.providers('owner')).ownerId, 'owner');
  assert.equal((await f.http('providers/models', input, 'owner', 'https://evil.example.com')).status, 403);
  const anonymous = await handleArena(new Request('http://localhost/api/arena/providers/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }), { service: f.service, origin: 'http://localhost' });
  assert.equal(anonymous.status, 401);
  const saved = await f.service.addProvider('owner', { ...input, name: 'Test', modelId: 'listed-model' });
  assert.equal((await f.http(`providers/${saved.id}/models`)).status, 200);
  assert.equal((await f.http(`providers/${saved.id}/models`, undefined, 'other')).status, 404);
  assert.equal(f.requests(), 2);
  assert.equal(JSON.stringify(await f.service.providers('owner')).includes(KEY), false);
  for (let index = 0; index < 19; index++) await f.http('providers/models', input);
  assert.equal((await f.http('providers/models', input)).status, 429);
});

test('Skill upload creates immutable private component versions and repeated imports reuse them', async () => {
  const { repo, http } = await fixture();
  const response = await http('agent-skills', { fileName: 'SKILL.md', content: '# Timing\nUse clear anticipation.' });
  assert.equal(response.status, 201);
  const first = await response.json();
  const second = await (await http('agent-skills', { fileName: 'SKILL.md', content: '# Timing\nUse clear anticipation.' })).json();
  assert.deepEqual(first.ref, second.ref);
  assert.equal((await repo.read('components')).length, 1);
  assert.equal((await repo.read('componentVersions')).length, 1);
  assert.equal((await repo.read('componentReleases')).length, 0);
  assert.equal((await listCreationSkills(repo, 'owner')).length, 1);
  assert.deepEqual(await listCreationSkills(repo, 'other'), []);
  await assert.rejects(resolveCreationSkills(repo, 'other', [first.ref]));
  const [resolved] = await resolveCreationSkills(repo, 'owner', [first.ref]);
  assert.equal(resolved.instruction, '# Timing\nUse clear anticipation.');
  assert.equal('instruction' in first, false);
  assert.equal((await http('agent-skills', { fileName: 'skill.md', content: 'text' }, 'owner', 'https://evil.example.com')).status, 403);
});

test('Skill resolution rejects tampering, duplicate refs and combined size overflow', async () => {
  const { repo } = await fixture();
  const first = await importCreationSkill(repo, 'owner', { fileName: 'first.md', content: 'a'.repeat(40000) });
  const second = await importCreationSkill(repo, 'owner', { fileName: 'second.md', content: 'b'.repeat(40000) });
  await assert.rejects(resolveCreationSkills(repo, 'owner', [first.ref, second.ref]));
  await assert.rejects(resolveCreationSkills(repo, 'owner', [first.ref, first.ref]));
  await assert.rejects(resolveCreationSkills(repo, 'owner', Array.from({ length: 17 }, (_, i) => ({ ...first.ref, componentId: `component-${i}` }))));
  await assert.rejects(resolveCreationSkills(repo, 'owner', [{ ...first.ref, contentDigest: `sha256:${'0'.repeat(64)}` }]));
  const [version] = await repo.read('componentVersions', { id: first.ref.versionId });
  await repo.update('componentVersions', { id: version.id }, { definition: { ...version.definition, instruction: 'tampered text' } });
  await assert.rejects(resolveCreationSkills(repo, 'owner', [first.ref]));
  assert.equal((await listCreationSkills(repo, 'owner')).some((skill) => skill.ref.versionId === first.ref.versionId), false);
});

test('the authoritative Build resolver loads owned Skills but refuses capability escalation', async () => {
  const { repo } = await fixture();
  const skill = await importCreationSkill(repo, 'owner', { fileName: 'skill.md', content: 'Use visible motion.' });
  const definition = { mode: 'agent' as const, definitionSchemaVersion: 1 as const, instructions: 'Make an animation.',
    ...CREATION_AGENT_BUILD_CONTRACT, skillRefs: [skill.ref], requestedCapabilities: [], profileRef: null };
  const resolver = createCreationAgentBuildResolver(repo);
  const request = { buildId: 'build', buildVersionId: 'build-v1', operation: 'save' as const, actorId: 'owner', ownerId: 'owner', definition };
  const resolved = await resolver.resolve(request);
  assert.deepEqual(resolved.definition.skillRefs, [skill.ref]);
  await assert.rejects(resolver.resolve({ ...request, actorId: 'other' }));
  await assert.rejects(createCreationAgentBuildResolver().resolve(request));
  await assert.rejects(resolver.resolve({ ...request, definition: { ...definition, profileRef: { id: 'arbitrary', versionId: 'v1', contentDigest: skill.ref.contentDigest } } }));
});

test('local sessions project only safe fields and dirty detection includes pinned Skill versions', () => {
  const ref: AgentBuildSkillRef = { kind: 'declarative', componentId: 'skill', versionId: 'v1', contentDigest: `sha256:${'a'.repeat(64)}` };
  const safe = parseCreationSession(JSON.stringify({ apiKey: KEY, ciphertext: 'secret', draftTitle: 'Title', draftInstructions: 'Prompt', runId: { invalid: true }, draftSkillRefs: [{ ...ref, apiKey: KEY }] }));
  assert.deepEqual(safe, { draftTitle: 'Title', draftInstructions: 'Prompt', draftSkillRefs: [ref] });
  for (const raw of ['bad json', 'null', '[]', 'x'.repeat(32001)]) assert.deepEqual(parseCreationSession(raw), {});
  const saved = { title: 'Title', instructions: 'Prompt', skillRefs: [ref] };
  assert.equal(draftMatchesBuild({ ...saved, title: ' Title ', instructions: 'Prompt\n' }, saved), true);
  assert.equal(draftMatchesBuild({ ...saved, skillRefs: [] }, saved), false);
  assert.equal(draftMatchesBuild(saved, null), false);
});
