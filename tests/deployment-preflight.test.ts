import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateProductionEnvironment } from '../scripts/deploy/preflight.mjs';

function environment() {
  return {
    DATABASE_URL: 'postgres://operator:secret@db.example.invalid/agentforge?sslmode=require',
    REDIS_URL: 'rediss://worker:secret@redis.example.invalid:6380/0',
    AGENTFORGE_WEB_DATABASE_URL: 'postgres://operator:secret@postgres:5432/agentforge?sslmode=require',
    AGENTFORGE_WEB_REDIS_URL: 'rediss://worker:secret@redis:6379/0',
    BETTER_AUTH_URL: 'https://arena.example.invalid',
    BETTER_AUTH_SECRET: 'test-only-auth-secret-not-for-production',
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    APP_ENV: 'production',
    DEMO_MODE: 'false',
    EVALUATION_SCHEDULER_MODE: 'outbox',
    EVALUATION_QUEUE_NAME: 'agentforge-evaluations',
    EVALUATION_QUEUE_PREFIX: 'agentforge-production',
    EVALUATION_WORKER_ID: 'hubei-worker-1',
    PI_RUNTIME_ENABLED: 'true',
    ARTIFACT_ARENA_ENABLED: 'true',
    ARTIFACT_ARENA_KILL_SWITCH: 'false',
    SANDBOX_RUNSC_PATH: '/usr/local/bin/runsc',
    SANDBOX_ROOTFS: '/opt/agentforge/rootfs',
    SANDBOX_WORK_ROOT: '/var/lib/agentforge/sandboxes',
    SANDBOX_OCI_TEMPLATE: '/opt/agentforge/oci-template.json',
    SANDBOX_IMAGE_DIGEST: 'sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0',
    ARTIFACT_STORAGE_ROOT: '/var/lib/agentforge/artifacts',
    ARTIFACT_STORAGE_GID: '987',
    PROVIDER_ALLOWED_HOSTS: 'api.openai.com,api.anthropic.com,generativelanguage.googleapis.com,api.deepseek.com,openrouter.ai',
  };
}

test('production preflight accepts the explicit public BYOK launch shape without network or writes', () => {
  assert.deepEqual(validateProductionEnvironment(environment()), []);
});

test('production preflight refuses disabled launch, kill switch, test mode and non-durable scheduling', () => {
  for (const [key, value] of Object.entries({
    APP_ENV: 'test',
    DEMO_MODE: 'true',
    EVALUATION_SCHEDULER_MODE: 'memory',
    PI_RUNTIME_ENABLED: 'false',
    ARTIFACT_ARENA_ENABLED: 'false',
    ARTIFACT_ARENA_KILL_SWITCH: 'true',
  })) {
    assert.ok(validateProductionEnvironment({ ...environment(), [key]: value }).length, key);
  }
});

test('production preflight refuses incomplete sandbox, storage, queue and provider configuration', () => {
  for (const key of [
    'REDIS_URL',
    'AGENTFORGE_WEB_DATABASE_URL',
    'AGENTFORGE_WEB_REDIS_URL',
    'EVALUATION_QUEUE_NAME',
    'SANDBOX_RUNSC_PATH',
    'SANDBOX_ROOTFS',
    'SANDBOX_WORK_ROOT',
    'SANDBOX_OCI_TEMPLATE',
    'SANDBOX_IMAGE_DIGEST',
    'ARTIFACT_STORAGE_ROOT',
    'ARTIFACT_STORAGE_GID',
    'PROVIDER_ALLOWED_HOSTS',
  ]) {
    assert.ok(validateProductionEnvironment({ ...environment(), [key]: '' }).length, key);
  }
  assert.ok(validateProductionEnvironment({ ...environment(), SANDBOX_ROOTFS: 'relative/rootfs' }).length);
  assert.ok(validateProductionEnvironment({ ...environment(), ARTIFACT_STORAGE_GID: 'root' }).length);
  assert.ok(validateProductionEnvironment({ ...environment(), PROVIDER_ALLOWED_HOSTS: 'localhost,api.openai.com' }).length);
  assert.ok(validateProductionEnvironment({ ...environment(), PROVIDER_ALLOWED_HOSTS: 'api.openai.com,api.openai.com' }).length);
});

test('production preflight refuses invalid keys and auth origins without exposing values', () => {
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'AGENTFORGE_WEB_DATABASE_URL', 'AGENTFORGE_WEB_REDIS_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'CREDENTIAL_ENCRYPTION_KEY']) {
    const secret = 'DO-NOT-PRINT-PRIVATE-VALUE';
    const errors = validateProductionEnvironment({ ...environment(), [key]: secret });
    assert.ok(errors.length);
    assert.ok(!errors.join().includes(secret));
  }
  for (const origin of ['http://arena.example.invalid', 'https://user:password@arena.example.invalid', 'https://arena.example.invalid/path']) {
    assert.ok(validateProductionEnvironment({ ...environment(), BETTER_AUTH_URL: origin }).length);
  }
  assert.ok(validateProductionEnvironment({
    ...environment(),
    AGENTFORGE_WEB_DATABASE_URL: 'postgres://different:credentials@postgres:5432/other',
  }).length);
  assert.ok(validateProductionEnvironment({
    ...environment(),
    AGENTFORGE_WEB_REDIS_URL: 'rediss://different:credentials@redis:6379/1',
  }).length);
});

test('production topology keeps runsc off the web container and mounts artifacts read-only by shared GID', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY package\.json pnpm-lock\.yaml/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.doesNotMatch(dockerfile, /--no-frozen-lockfile/);

  const compose = readFileSync(new URL('../deploy/compose.production.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true|SANDBOX_RUNSC_PATH|SANDBOX_ROOTFS/);
  assert.match(compose, /127\.0\.0\.1:/);
  assert.match(compose, /ARTIFACT_ARENA_ENABLED: "true"/);
  assert.match(compose, /PI_RUNTIME_ENABLED: "true"/);
  assert.match(compose, /ARTIFACT_STORAGE_ROOT[^\n]+:ro/);
  assert.match(compose, /group_add:[\s\S]+ARTIFACT_STORAGE_GID/);
  assert.match(compose, /AGENTFORGE_WEB_DATABASE_URL/);
  assert.match(compose, /AGENTFORGE_WEB_REDIS_URL/);
  assert.match(compose, /agentforge-production-backend/);
  assert.doesNotMatch(compose, /network_mode:\s*host/);
});

test('trusted worker unit and installer are bounded to dedicated AgentForge resources', () => {
  const unit = readFileSync(new URL('../deploy/agentforge-evaluation-worker.service', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../scripts/deploy/worker.sh', import.meta.url), 'utf8');
  assert.match(unit, /User=root/);
  assert.match(unit, /Group=agentforge-artifacts/);
  assert.match(unit, /TimeoutStopSec=180s/);
  assert.match(unit, /KillSignal=SIGTERM/);
  assert.match(worker, /install -d -o root -g "\$artifact_group" -m 2750/);
  assert.match(worker, /install -d -o root -g root -m 0700/);
  assert.match(worker, /systemctl enable/);
  assert.match(worker, /start\|restart[\s\S]+render_service_unit[\s\S]+systemctl "\$mode"/);
  assert.match(worker, /createRequire\(path\.join\(release, 'package\.json'\)\)/);
  assert.match(worker, /requireFromRelease\('dotenv'\)/);
  assert.match(worker, /\\\( -type f -o -type d \\\) -perm \/0222/);
  assert.doesNotMatch(worker, /import \{ parse \} from 'dotenv'/);
  assert.doesNotMatch(worker, /docker\s+(?:system\s+)?prune|docker\s+compose\s+down|docker\.sock|daemon\.json|systemctl\s+restart\s+docker/);
});


test('sandbox rootfs preparation creates the output mountpoint before removing write bits', () => {
  const script = readFileSync(new URL('../scripts/deploy/prepare-sandbox-rootfs.sh', import.meta.url), 'utf8');
  const createOutput = script.indexOf('mkdir -p \"$stage/rootfs/output\"');
  const hardenDirectories = script.indexOf('find \"$stage/rootfs\" -type d -exec chmod a-w');
  assert.ok(createOutput >= 0);
  assert.ok(hardenDirectories > createOutput);
});
