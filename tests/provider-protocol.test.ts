import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PROVIDER_FIELD_LIMITS, PROVIDER_PROTOCOLS, parseProviderProtocol } from '../src/shared/provider-protocol.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { ArenaService } from '../src/server/service.ts';
import { decryptCredential } from '../src/lib/crypto/credentials.ts';
import { publicCredential } from '../src/server/serializers.ts';
import { validateBody } from '../src/server/validation.ts';

const key = 'offline-protocol-key-not-valid';
const body = { name: 'Test', baseUrl: 'https://gateway.example.com/v1', apiKey: key, modelId: 'custom' };
async function fixture() {
  const repo = new MemoryRepository();
  const encryptionKey = randomBytes(32).toString('base64');
  const now = new Date().toISOString();
  for (const id of ['owner', 'other']) {
    await repo.insert('users', [{ id, name: id, email: `${id}@example.invalid`, emailVerified: false,
      image: null, createdAt: now, updatedAt: now, elo: 1000, reputation: 0, isSeed: false }]);
  }
  const service = new ArenaService(repo, { demoMode: false, encryptionKey, allowedHosts: ['gateway.example.com'] });
  return { repo, encryptionKey, service };
}

test('protocols are explicit; omitted legacy protocol preserves Chat Completions', () => {
  assert.equal(parseProviderProtocol(undefined), 'openai-chat');
  for (const protocol of PROVIDER_PROTOCOLS) assert.equal(parseProviderProtocol(protocol), protocol);
  for (const invalid of ['auto', 'OPENAI', '', null, {}, 42]) assert.throws(() => parseProviderProtocol(invalid));
});

test('every protocol persists encrypted and remains owner-scoped without exposing key material', async () => {
  const { service, repo, encryptionKey } = await fixture();
  for (const protocol of PROVIDER_PROTOCOLS) {
    validateBody('providers', { ...body, protocol });
    const result = await service.addProvider('owner', { ...body, protocol });
    assert.equal(result.protocol, protocol);
    if (protocol === 'anthropic-messages' || protocol === 'google-generative-ai') {
      assert.equal(result.keyMask, `••••${key.slice(-4)}`);
    }
    assert.equal(JSON.stringify(result).includes(key), false);
    const [stored] = await repo.read('credentials', { id: result.id });
    assert.equal(stored.protocol, protocol);
    assert.notEqual(stored.ciphertext, key);
    assert.equal(decryptCredential(stored.ciphertext, encryptionKey, 'owner', stored.id), key);
    assert.throws(() => decryptCredential(stored.ciphertext, encryptionKey, 'other', stored.id));
    assert.deepEqual((await service.providers('other')).credentials, []);
    await service.deleteProvider('other', stored.id);
    assert.equal((await repo.read('credentials', { id: stored.id })).length, 1);
    await service.deleteProvider('owner', stored.id);
    assert.equal((await repo.read('credentials', { id: stored.id })).length, 0);
  }
});

test('unrecognized protocol and network/authentication overrides fail at API and service boundaries', async () => {
  const { service, repo } = await fixture();
  assert.throws(() => validateBody('providers', { ...body, protocol: 'auto' }));
  assert.throws(() => validateBody('providers', { ...body, headers: { authorization: 'override' } }));
  await assert.rejects(service.addProvider('owner', { ...body, protocol: 'auto' }));
  for (const protocol of PROVIDER_PROTOCOLS) {
    await assert.rejects(service.addProvider('owner', { ...body, protocol, baseUrl: 'https://unapproved.example.com/v1' }));
  }
  assert.equal((await repo.read('credentials')).length, 0);
});

test('public custom provider mode accepts opaque keys and public HTTPS gateway hostnames', async () => {
  const { repo, encryptionKey } = await fixture();
  const service = new ArenaService(repo, { demoMode: false, encryptionKey, allowedHosts: [], allowCustomProviderHosts: true });
  const result = await service.addProvider('owner', { ...body, baseUrl: 'https://custom-gateway.example.net/v1', apiKey: 'AIzaSyOpaqueKeyShape1234567890' });
  assert.equal(result.baseUrl, 'https://custom-gateway.example.net/v1');
});

test('old clients and old in-memory records default to Chat Completions', async () => {
  const { service, repo } = await fixture();
  const result = await service.addProvider('owner', body);
  assert.equal(result.protocol, 'openai-chat');
  const [stored] = await repo.read('credentials', { id: result.id });
  const { protocol: _protocol, ...legacy } = stored;
  assert.equal(publicCredential(legacy).protocol, 'openai-chat');
});

test('API keys are opaque non-empty strings with one shared upper bound', async () => {
  const { repo, service } = await fixture();
  const shapes = ['x', 'sk-short', 'AIza', 'token.with:provider_specific/chars+='];
  for (const [index, apiKey] of shapes.entries()) {
    const candidate = { ...body, name: `Shape ${index}`, apiKey };
    validateBody('providers', candidate);
    const saved = await service.addProvider('owner', candidate);
    assert.ok(saved.keyMask.length >= 5);
    assert.notEqual(saved.keyMask, apiKey);
  }
  assert.equal((await repo.read('credentials', { userId: 'owner' })).length, shapes.length);

  const oversized = 'k'.repeat(PROVIDER_FIELD_LIMITS.apiKey + 1);
  assert.throws(() => validateBody('providers', { ...body, apiKey: oversized }));
  await assert.rejects(() => service.addProvider('owner', { ...body, apiKey: oversized }));
  assert.throws(() => validateBody('providers', { ...body, apiKey: '   ' }));
  await assert.rejects(() => service.addProvider('owner', { ...body, apiKey: '   ' }));
});
