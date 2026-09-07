import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateProductionEnvironment } from '../scripts/deploy/preflight.mjs';

function environment() {
  return {
    DATABASE_URL: 'postgres://operator:secret@db.example.invalid/agentforge',
    BETTER_AUTH_URL: 'https://arena.example.invalid',
    BETTER_AUTH_SECRET: 'test-only-auth-secret-not-for-production',
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    APP_ENV: 'production',
    DEMO_MODE: 'false',
    PI_RUNTIME_ENABLED: 'false',
    ARTIFACT_ARENA_ENABLED: 'false',
  };
}

test('production preflight accepts explicit safe shape without network or writes', () => {
  assert.deepEqual(validateProductionEnvironment(environment()), []);
});

test('production preflight refuses test mode and premature creation enablement', () => {
  for (const [key, value] of Object.entries({ APP_ENV: 'test', DEMO_MODE: 'true', PI_RUNTIME_ENABLED: 'true', ARTIFACT_ARENA_ENABLED: 'true' })) {
    assert.ok(validateProductionEnvironment({ ...environment(), [key]: value }).length);
  }
});

test('production preflight refuses invalid keys and auth origins without exposing values', () => {
  for (const key of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'CREDENTIAL_ENCRYPTION_KEY']) {
    const secret = 'DO-NOT-PRINT-PRIVATE-VALUE';
    const errors = validateProductionEnvironment({ ...environment(), [key]: secret });
    assert.ok(errors.length);
    assert.ok(!errors.join().includes(secret));
  }
  for (const origin of ['http://arena.example.invalid', 'https://user:password@arena.example.invalid', 'https://arena.example.invalid/path']) {
    assert.ok(validateProductionEnvironment({ ...environment(), BETTER_AUTH_URL: origin }).length);
  }
});

test('deployment image uses lockfile and production compose never mounts Docker socket', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY package\.json pnpm-lock\.yaml/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(dockerfile, /--no-frozen-lockfile/);
  const compose = readFileSync(new URL('../deploy/compose.production.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true/);
  assert.match(compose, /127\.0\.0\.1:/);
  assert.match(compose, /ARTIFACT_ARENA_ENABLED: "false"/);
});
