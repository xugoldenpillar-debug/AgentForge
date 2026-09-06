import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ArenaService } from '../src/server/service.ts';
import { handleArena } from '../src/server/http.ts';
import { validateBody } from '../src/server/validation.ts';
import { AppError, ERROR_CODES } from '../src/shared/errors.ts';
import { MemoryRepository } from './helpers/memory-repository.ts';
import { seedTestArena } from './helpers/seed-arena.ts';
import type { User } from '../src/shared/types.ts';
import { isPiInvited, piInvitedEmails } from '../src/server/environment.ts';

const user: User = {
  id: 'pi-user',
  name: 'Pi Tester',
  email: 'pi-tester@example.invalid',
  emailVerified: false,
  image: null,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
  elo: 1000,
  reputation: 0,
  isSeed: false
};

async function fixture(env: Record<string, string | undefined> = {}) {
  const repo = new MemoryRepository();
  await seedTestArena(repo, user);
  const service = new ArenaService(repo, {
    demoMode: true,
    encryptionKey: randomBytes(32).toString('base64'),
    allowedHosts: ['api.deepseek.com'],
    env: { PI_RUNTIME_ENABLED: 'true', ...env }
  });
  return { repo, service };
}

test('invite list is exact emails and independent of DEMO_MODE', () => {
  assert.deepEqual(piInvitedEmails({}), []);
  assert.deepEqual(piInvitedEmails({ PI_RUNTIME_INVITED_EMAILS: ' A@x.com, b@x.com ' }), ['a@x.com', 'b@x.com']);
  assert.equal(isPiInvited('a@x.com', null, { PI_RUNTIME_INVITED_EMAILS: 'a@x.com' }), true);
  assert.equal(isPiInvited('a@x.com', 'applied', {}), false);
  assert.equal(isPiInvited('a@x.com', 'invited', {}), true);
});

test('uninvited users can apply but cannot run Pi self-test', async () => {
  const { service, repo } = await fixture();
  const boot = await service.boot();
  assert.equal(boot.piSelfTestEntry, true);
  const before = await service.piSelfTestStatus(user.id);
  assert.equal(before.invited, false);
  assert.equal(before.canRun, false);
  const applied = await service.applyPiSelfTest(user.id);
  assert.equal(applied.applied, true);
  assert.equal(applied.invited, false);
  assert.equal((await repo.read('users', { id: user.id }))[0].piRuntimeAccess, 'applied');
  await assert.rejects(
    () => service.runPiSelfTest(user.id, { intent: 'run', prompt: 'What is 2+3?' }, () => {}),
    (error: unknown) => error instanceof AppError && error.code === ERROR_CODES.RUNTIME_POLICY_DENIED && error.status === 403
  );
});

test('invited users can run a demo Pi self-test without writing submissions', async () => {
  const { service, repo } = await fixture({
    PI_RUNTIME_INVITED_EMAILS: 'pi-tester@example.invalid'
  });
  const status = await service.piSelfTestStatus(user.id);
  assert.equal(status.invited, true);
  assert.equal(status.canRun, true);
  const events: Array<{ type?: string; competitive?: boolean; output?: string }> = [];
  await service.runPiSelfTest(user.id, { intent: 'run', prompt: 'What is 2+3?' }, (event) => {
    events.push(event as { type?: string; competitive?: boolean; output?: string });
  });
  assert.equal(events.some((event) => event.type === 'start' && event.competitive === false), true);
  assert.equal(events.some((event) => event.type === 'completed' && event.output === '5'), true);
  assert.equal((await repo.read('submissions')).filter((row) => row.userId === user.id).length, 0);
});

test('HTTP apply is authenticated and run is invite-gated', async () => {
  const { service } = await fixture();
  const origin = 'http://localhost:3000';
  const denied = await handleArena(new Request(`${origin}/api/arena/pi-self-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ intent: 'apply' })
  }), { service, origin, validateBody });
  assert.equal(denied.status, 401);
  const applied = await handleArena(new Request(`${origin}/api/arena/pi-self-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ intent: 'apply' })
  }), { service, origin, userId: user.id, validateBody });
  assert.equal(applied.status, 200);
  const body = await applied.json() as { invited: boolean; applied: boolean };
  assert.equal(body.applied, true);
  assert.equal(body.invited, false);
});

test('unsupported Pi model returns a configuration error inside HTTP 200 NDJSON offline', async () => {
  const { service } = await fixture({ PI_RUNTIME_INVITED_EMAILS: user.email });
  const credential = await service.addProvider(user.id, {
    name: 'Offline unsupported model', baseUrl: 'https://api.deepseek.com',
    modelId: 'unsupported-private-model', apiKey: 'offline-dummy-key-never-valid'
  });
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('Network forbidden');
  };
  try {
    const origin = 'http://localhost:3000';
    const response = await handleArena(new Request(`${origin}/api/arena/pi-self-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ intent: 'run', prompt: 'offline', credentialId: credential.id, consent: true })
    }), { service, origin, userId: user.id, validateBody });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
    const body = await response.text();
    const events = body.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, 'error');
    assert.equal(events.at(-1).code, ERROR_CODES.PROVIDER_CONFIGURATION_INVALID);
    assert.equal(events.some((event) => event.type === 'completed'), false);
    assert.equal(body.includes('unsupported-private-model'), false);
    assert.equal(body.includes('offline-dummy-key-never-valid'), false);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
