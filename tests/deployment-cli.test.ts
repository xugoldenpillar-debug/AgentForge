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
    'DATABASE_URL=postgres://operator:secret@db.example.invalid/agentforge',
    'REDIS_URL=redis://worker:secret@redis.example.invalid:6379/0',
    'AGENTFORGE_WEB_DATABASE_URL=postgres://operator:secret@postgres:5432/agentforge',
    'AGENTFORGE_WEB_REDIS_URL=redis://worker:secret@redis:6379/0',
    'BETTER_AUTH_URL=https://arena.example.invalid',
    'BETTER_AUTH_SECRET=offline-test-secret-never-use-in-production',
    `CREDENTIAL_ENCRYPTION_KEY=${Buffer.alloc(32, 1).toString('base64')}`,
    'APP_ENV=production',
    'DEMO_MODE=false',
    'EVALUATION_SCHEDULER_MODE=outbox',
    'EVALUATION_QUEUE_NAME=agentforge-evaluations',
    'EVALUATION_QUEUE_PREFIX=agentforge-production',
    'EVALUATION_WORKER_ID=hubei-worker-1',
    'PI_RUNTIME_ENABLED=true',
    'ARTIFACT_ARENA_ENABLED=true',
    'ARTIFACT_ARENA_KILL_SWITCH=false',
    'SANDBOX_RUNSC_PATH=/usr/local/bin/runsc',
    'SANDBOX_ROOTFS=/opt/agentforge/rootfs',
    'SANDBOX_WORK_ROOT=/var/lib/agentforge/sandboxes',
    'SANDBOX_OCI_TEMPLATE=/opt/agentforge/oci-template.json',
    'SANDBOX_IMAGE_DIGEST=sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0',
    'ARTIFACT_STORAGE_ROOT=/var/lib/agentforge/artifacts',
    'ARTIFACT_STORAGE_GID=987',
    'PROVIDER_ALLOW_CUSTOM_HOSTS=true',
    'PROVIDER_ALLOWED_HOSTS=api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.deepseek.com,openrouter.ai',
    `AGENTFORGE_POSTGRES_IMAGE=postgres@sha256:${'a'.repeat(64)}`,
    `AGENTFORGE_REDIS_IMAGE=redis@sha256:${'b'.repeat(64)}`,
    'AGENTFORGE_POSTGRES_USER=agentforge',
    'AGENTFORGE_POSTGRES_PASSWORD=postgres-offline-test-password-1234567890',
    'AGENTFORGE_POSTGRES_DB=agentforge',
    'AGENTFORGE_POSTGRES_PORT=55432',
    'AGENTFORGE_REDIS_PASSWORD=redis-offline-test-password-123456789012',
    'AGENTFORGE_REDIS_PORT=56379',
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
    assert.doesNotMatch(calls, /prune|down|restart|docker\.sock/);
  } finally { rmSync(f.dir, { recursive: true }); }
});

test('deployment rollback reuses an existing immutable image and does not run migration', () => {
  const f = fixture();
  try {
    const result = spawnSync('bash', ['scripts/deploy/app.sh', 'rollback', f.envFile, 'agentforge:previous-release'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, PATH: `${f.dir}:${process.env.PATH}`, TEST_CALLS: f.calls, TEST_IMAGE_EXISTS: '0' },
    });
    assert.equal(result.status, 0);
    assert.match(f.readCalls(), /image inspect agentforge:previous-release/);
    assert.match(f.readCalls(), /up -d --no-build --wait/);
    assert.doesNotMatch(f.readCalls(), /build app|pnpm db|prune|down/);
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


test('dedicated dependency check is render-only and requires immutable images', () => {
  const f = fixture();
  try {
    const result = spawnSync('bash', ['scripts/deploy/data.sh', 'check', f.envFile], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, PATH: `${f.dir}:${process.env.PATH}`, TEST_CALLS: f.calls },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(f.readCalls(), /--project-name agentforge-data/);
    assert.match(f.readCalls(), /compose.dependencies.yml config --quiet/);
    assert.doesNotMatch(f.readCalls(), / pull| up |down|prune/);

    const invalid = readFileSync(f.envFile, 'utf8').replace(/@sha256:[a-f0-9]{64}/, ':latest');
    writeFileSync(f.envFile, invalid, { mode: 0o600 });
    const rejected = spawnSync('bash', ['scripts/deploy/data.sh', 'check', f.envFile], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, PATH: `${f.dir}:${process.env.PATH}`, TEST_CALLS: f.calls },
    });
    assert.notEqual(rejected.status, 0);
  } finally { rmSync(f.dir, { recursive: true }); }
});

test('deployment preflight and data bootstrap parse env without installed packages', () => {
  const preflight = readFileSync(new URL('../scripts/deploy/preflight.mjs', import.meta.url), 'utf8');
  const data = readFileSync(new URL('../scripts/deploy/data.sh', import.meta.url), 'utf8');
  assert.match(preflight, /node:util/);
  assert.match(data, /node:util/);
  assert.doesNotMatch(preflight, /from ['"]dotenv['"]/);
  assert.doesNotMatch(data, /requireFromRelease\('dotenv'\)/);
});

test('deployment scripts support the pinned portable Node path used on Hubei', () => {
  for (const path of ['scripts/deploy/app.sh', 'scripts/deploy/data.sh']) {
    const script = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(script, /AGENTFORGE_DEPLOY_NODE/);
    assert.match(script, /\/opt\/agentforge\/node-v22\.19\.0-linux-x64\/bin\/node/);
    assert.match(script, /\"\$node_bin\"/);
  }
});

test('dependency topology is isolated and backup script never destroys volumes', () => {
  const compose = readFileSync(new URL('../deploy/compose.dependencies.yml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../scripts/deploy/data.sh', import.meta.url), 'utf8');
  assert.match(compose, /agentforge-production-postgres-data/);
  assert.match(compose, /agentforge-production-redis-data/);
  assert.match(compose, /127\.0\.0\.1:\$\{AGENTFORGE_POSTGRES_PORT/);
  assert.match(compose, /127\.0\.0\.1:\$\{AGENTFORGE_REDIS_PORT/);
  assert.match(compose, /agentforge-production-backend/);
  assert.match(script, /pg_dump/);
  assert.match(script, /restore-check/);
  assert.doesNotMatch(script, /down\s+-v|volume\s+rm|prune/);
});
