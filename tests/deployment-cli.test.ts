import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agentforge-deployment-cli-'));
  const envFile = join(dir, 'production.env');
  const calls = join(dir, 'calls');
  writeFileSync(envFile, [
    'DATABASE_URL=postgres://db.example.invalid/agentforge',
    'BETTER_AUTH_URL=https://arena.example.invalid',
    'BETTER_AUTH_SECRET=offline-test-secret-never-use-in-production',
    `CREDENTIAL_ENCRYPTION_KEY=${Buffer.alloc(32, 1).toString('base64')}`,
    'APP_ENV=production', 'DEMO_MODE=false', 'PI_RUNTIME_ENABLED=false', 'ARTIFACT_ARENA_ENABLED=false',
  ].join('\n'), { mode: 0o600 });
  // This command spy never builds images, connects to databases or changes Docker.
  writeFileSync(join(dir, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_CALLS"\nif [ "$1 $2" = "image inspect" ]; then exit "${TEST_IMAGE_EXISTS:-1}"; fi\nexit 0\n', { mode: 0o700 });
  function invoke(mode: string, ...args: string[]) {
    return spawnSync('bash', ['scripts/deploy/app.sh', mode, envFile, 'agentforge:test-release', ...args], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TEST_CALLS: calls },
    });
  }
  return { dir, envFile, calls, invoke, readCalls: () => existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
}

test('deployment check only renders config; release requires backup confirmation before build', () => {
  const f = fixture();
  try {
    assert.equal(f.invoke('check').status, 0);
    assert.match(f.readCalls(), /config --quiet/);
    assert.doesNotMatch(f.readCalls(), /build app|pnpm db|up -d/);
    assert.notEqual(f.invoke('release').status, 0);
    assert.doesNotMatch(f.readCalls(), /build app|pnpm db|up -d/);
  } finally { rmSync(f.dir, { recursive: true }); }
});

test('deployment release orders build, migration and health wait without restart or prune', () => {
  const f = fixture();
  try {
    assert.equal(f.invoke('release', '--backup-confirmed').status, 0);
    const calls = f.readCalls();
    assert.ok(calls.indexOf('build app') < calls.indexOf('run --rm --no-deps app pnpm db'));
    assert.ok(calls.indexOf('pnpm db') < calls.indexOf('up -d --no-build --wait'));
    assert.doesNotMatch(calls, /prune|down|restart|docker.sock/);
  } finally { rmSync(f.dir, { recursive: true }); }
});

test('deployment rejects group-readable secrets before any Docker invocation', () => {
  const f = fixture();
  try {
    chmodSync(f.envFile, 0o644);
    const result = f.invoke('check');
    assert.notEqual(result.status, 0);
    assert.equal(f.readCalls(), '');
    assert.ok(!result.stderr.includes('offline-test-secret'));
  } finally { rmSync(f.dir, { recursive: true }); }
});
